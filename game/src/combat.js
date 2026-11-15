// Combat: hitscan shooting, damage with headshots and falloff, and grenades.
// One ray per shot, tested against the world boxes and each actor's body-part
// boxes (head, torso, legs); the nearest hit wins, so a crate between you and
// a target saves the target. No allocations per shot beyond the result object.
import { WEAPONS, falloff, actorAlive } from './state.js';
import { segmentAABB, losBlocked } from './world.js';
import * as audio from './audio.js';

const _p0 = { x: 0, y: 0, z: 0 };
const _p1 = { x: 0, y: 0, z: 0 };

export function bodyParts(actor) {
  const h = actor.crouch ? 1.15 : 1.7;
  const y = actor.pos.y;
  return [
    { part: 'head', minX: actor.pos.x - 0.16, maxX: actor.pos.x + 0.16, minY: y + h - 0.32, maxY: y + h, minZ: actor.pos.z - 0.16, maxZ: actor.pos.z + 0.16 },
    { part: 'torso', minX: actor.pos.x - 0.26, maxX: actor.pos.x + 0.26, minY: y + 0.55, maxY: y + h - 0.32, minZ: actor.pos.z - 0.26, maxZ: actor.pos.z + 0.26 },
    { part: 'legs', minX: actor.pos.x - 0.24, maxX: actor.pos.x + 0.24, minY: y, maxY: y + 0.55, minZ: actor.pos.z - 0.24, maxZ: actor.pos.z + 0.24 },
  ];
}

export function createCombat(state, world, onEvent) {
  const grenades = [];

  function rayHit(origin, dir, maxDist, ignore) {
    _p0.x = origin.x; _p0.y = origin.y; _p0.z = origin.z;
    _p1.x = origin.x + dir.x * maxDist; _p1.y = origin.y + dir.y * maxDist; _p1.z = origin.z + dir.z * maxDist;
    let best = null;
    let bestT = 1;
    for (const b of world.colliders) {
      const t = segmentAABB(_p0, _p1, b);
      if (t >= 0 && t < bestT) { bestT = t; best = { kind: 'world', point: null, dist: t * maxDist }; }
    }
    if (dir.y < -1e-6) {
      const t = -origin.y / dir.y / maxDist;
      if (t >= 0 && t < bestT) { bestT = t; best = { kind: 'world', point: null, dist: t * maxDist }; }
    }
    for (const actor of state.actors) {
      if (actor === ignore || !actorAlive(actor)) continue;
      for (const part of bodyParts(actor)) {
        const t = segmentAABB(_p0, _p1, part);
        if (t >= 0 && t < bestT) {
          bestT = t;
          best = { kind: 'actor', actor, part: part.part, point: null, dist: t * maxDist };
        }
      }
    }
    if (best) {
      best.point = {
        x: origin.x + dir.x * best.dist,
        y: origin.y + dir.y * best.dist,
        z: origin.z + dir.z * best.dist,
      };
    }
    return best;
  }

  function damageActor(target, raw, attacker, part) {
    if (!actorAlive(target)) return false;
    let dmg = raw;
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, dmg * 0.5);
      target.armor -= absorbed;
      dmg -= absorbed;
    }
    target.hp -= dmg;
    target.lastDamageAt = state.phaseTime;
    target.lastAttacker = attacker;
    if (target.hp <= 0) {
      target.hp = 0;
      target.deadAt = state.phaseTime;
      onEvent('kill', { attacker, target, part });
      return true;
    }
    return false;
  }

  function fire(shooter, dir, rng) {
    const def = WEAPONS[shooter.weapon];
    if (shooter.mag <= 0) return { fired: false, dry: true };
    shooter.mag -= 1;
    shooter.shotsFired = (shooter.shotsFired ?? 0) + 1;
    state.stats.shots += shooter === state.player ? 1 : 0;
    const spread = def.spread + (shooter.moving ? def.moveSpread : 0) + shooter.bloom;
    const dx = dir.x + (rng() * 2 - 1) * spread;
    const dy = dir.y + (rng() * 2 - 1) * spread;
    const dz = dir.z + (rng() * 2 - 1) * spread;
    const len = Math.hypot(dx, dy, dz) || 1;
    const origin = { x: shooter.eye.x, y: shooter.eye.y, z: shooter.eye.z };
    const hit = rayHit(origin, { x: dx / len, y: dy / len, z: dz / len }, 90, shooter);
    shooter.bloom = Math.min(0.03, shooter.bloom + def.recoil * 0.35);
    shooter.recoilPitch = (shooter.recoilPitch ?? 0) + def.recoil;
    if (!hit) return { fired: true, hit: null, origin, dir: { x: dx / len, y: dy / len, z: dz / len } };
    if (hit.kind === 'actor') {
      const head = hit.part === 'head';
      const dmg = falloff(def.damage, hit.dist, def.range) * (head ? def.headMult : 1) * (hit.part === 'legs' ? 0.8 : 1);
      const killed = damageActor(hit.actor, dmg, shooter, hit.part);
      if (shooter === state.player) {
        state.stats.hits += 1;
        if (killed) state.stats.kills += 1;
      }
      return { fired: true, hit, origin, dir: { x: dx / len, y: dy / len, z: dz / len }, killed, head };
    }
    return { fired: true, hit, origin, dir: { x: dx / len, y: dy / len, z: dz / len } };
  }

  function throwGrenade(owner, kind, dir) {
    if (owner.grenades[kind] <= 0) return false;
    owner.grenades[kind] -= 1;
    grenades.push({
      kind, owner,
      pos: { x: owner.eye.x + dir.x * 0.5, y: owner.eye.y + dir.y * 0.5 - 0.1, z: owner.eye.z + dir.z * 0.5 },
      vel: { x: dir.x * 13 + owner.vel.x * 0.5, y: dir.y * 13 + 3.5, z: dir.z * 13 + owner.vel.z * 0.5 },
      fuse: kind === 'frag' ? 1.6 : 1.1, bounced: false,
    });
    return true;
  }

  function explodeFrag(g) {
    onEvent('explosion', { pos: g.pos });
    audio.playExplosion();
    for (const actor of state.actors) {
      if (!actorAlive(actor)) continue;
      const dx = actor.pos.x - g.pos.x;
      const dy = actor.pos.y + 0.9 - g.pos.y;
      const dz = actor.pos.z - g.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 7) continue;
      _p0.x = g.pos.x; _p0.y = g.pos.y; _p0.z = g.pos.z;
      _p1.x = actor.pos.x; _p1.y = actor.pos.y + 0.9; _p1.z = actor.pos.z;
      if (losBlocked(_p0, _p1, world.colliders)) continue;
      const dmg = 115 * (1 - dist / 7.5);
      if (damageActor(actor, dmg, g.owner, 'frag')) {
        if (g.owner === state.player) state.stats.kills += 1;
      }
    }
  }

  function explodeFlash(g) {
    onEvent('flash', { pos: g.pos });
    audio.playFlash();
    for (const actor of state.actors) {
      if (!actorAlive(actor)) continue;
      const dx = g.pos.x - actor.eye.x;
      const dy = g.pos.y - actor.eye.y;
      const dz = g.pos.z - actor.eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 24) continue;
      _p0.x = g.pos.x; _p0.y = g.pos.y; _p0.z = g.pos.z;
      _p1.x = actor.eye.x; _p1.y = actor.eye.y; _p1.z = actor.eye.z;
      if (losBlocked(_p0, _p1, world.colliders)) continue;
      const facing = (dx * Math.sin(actor.yaw) * -1 + dz * Math.cos(actor.yaw) * -1) / (dist || 1);
      const facingFactor = Math.max(0.25, facing);
      actor.blindUntil = state.phaseTime + (1.7 - dist * 0.05) * facingFactor;
    }
  }

  function stepGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= 13 * dt;
      const oldX = g.pos.x;
      const oldY = g.pos.y;
      const oldZ = g.pos.z;
      g.pos.x += g.vel.x * dt;
      g.pos.y += g.vel.y * dt;
      g.pos.z += g.vel.z * dt;
      if (g.pos.y < 0.08) {
        g.pos.y = 0.08;
        g.vel.y = Math.abs(g.vel.y) * 0.45;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      for (const b of world.colliders) {
        if (g.pos.x > b.minX - 0.08 && g.pos.x < b.maxX + 0.08 &&
            g.pos.y > b.minY - 0.08 && g.pos.y < b.maxY + 0.08 &&
            g.pos.z > b.minZ - 0.08 && g.pos.z < b.maxZ + 0.08) {
          g.pos.x = oldX; g.pos.y = oldY; g.pos.z = oldZ;
          if (Math.abs(g.vel.x) >= Math.abs(g.vel.z)) g.vel.x *= -0.45;
          else g.vel.z *= -0.45;
          g.vel.y *= 0.5;
          break;
        }
      }
      if (g.fuse <= 0) {
        if (g.kind === 'frag') explodeFrag(g);
        else explodeFlash(g);
        grenades.splice(i, 1);
      }
    }
  }

  return { fire, rayHit, damageActor, throwGrenade, stepGrenades, grenades };
}
