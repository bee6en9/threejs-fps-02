// Bot AI: waypoint routes, hold positions, perception and fire discipline.
// A bot is a state machine — advance, hold, engage, plant, defuse, fetch,
// retreat — over a nav graph, with line-of-sight checks against the map's
// colliders, a reaction delay before its first shot, and burst fire with aim
// error that grows with distance and movement. Bots hear gunfire too: a shot
// within 20 m turns the nearest bots toward the shooter.
import { WEAPONS, actorAlive } from './state.js';
import { findPath, losBlocked, moveCircle } from './world.js';

const FRIEND_NAMES = ['Mako', 'Rook', 'Sable'];
const ENEMY_NAMES = ['Vex', 'Harrow', 'Grim', 'Onyx'];
const FRIEND_WEAPONS = ['mastiff', 'mastiff', 'riptide'];
const ENEMY_WEAPONS = ['mastiff', 'mastiff', 'longeye', 'riptide'];
const HOLD_NODES = { them: ['siteA', 'siteB', 'whW', 'whE', 'midN', 'coverWN', 'coverEN'] };
const LANE_NODES = {
  A: [['westS', 'westM', 'westN', 'siteA'], ['midS', 'mid', 'midN', 'westN', 'siteA']],
  B: [['eastS', 'eastM', 'eastN', 'siteB'], ['midS', 'mid', 'midN', 'eastN', 'siteB']],
};

function angleTo(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function makeBot(state, team, index, spawn) {
  const names = team === 'us' ? FRIEND_NAMES : ENEMY_NAMES;
  const weapons = team === 'us' ? FRIEND_WEAPONS : ENEMY_WEAPONS;
  const weapon = weapons[index % weapons.length];
  const def = WEAPONS[weapon];
  return {
    isBot: true,
    name: names[index % names.length],
    team,
    pos: { x: spawn[0], y: 0, z: spawn[1] },
    vel: { x: 0, z: 0 },
    vy: 0,
    yaw: team === 'us' ? 0 : Math.PI,
    pitch: 0,
    eye: { x: spawn[0], y: 1.62, z: spawn[1] },
    hp: 100, armor: 0,
    weapon, mag: def.mag, reserve: def.reserveMax,
    grenades: { frag: 0, flash: 0 },
    bloom: 0, recoilPitch: 0, moving: false, crouch: false,
    blindUntil: 0, lastDamageAt: -99, lastAttacker: null, deadAt: 0,
    shotsFired: 0, stepPhase: Math.random() * 10,
    // AI
    ai: {
      state: 'advance', path: [], pathIndex: 0, holdUntil: 0,
      target: null, lastSeen: null, lastSeenAt: -99, reactionUntil: 0,
      burstLeft: 0, burstPauseUntil: 0, fireAt: 0, aimErr: 0.02,
      site: index % 2 === 0 ? 'A' : 'B', scanYaw: 0, scanDir: 1,
      stuckAt: 0, stuckPos: { x: spawn[0], z: spawn[1] },
      plantAt: 0, defuseAt: 0, thinkAt: Math.random() * 0.15,
    },
  };
}

export function createBots(state, world, combat, rng) {
  function visibleEnemy(bot) {
    let best = null;
    let bestDist = 55;
    for (const other of state.actors) {
      if (other.team === bot.team || !actorAlive(other)) continue;
      const dx = other.pos.x - bot.pos.x;
      const dz = other.pos.z - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > bestDist) continue;
      const toTarget = Math.atan2(-dx, -dz);
      if (Math.abs(angleDiff(toTarget, bot.yaw)) > 1.1 && dist > 4) continue;
      const p0 = { x: bot.eye.x, y: bot.eye.y, z: bot.eye.z };
      const p1 = { x: other.pos.x, y: other.pos.y + 1.2, z: other.pos.z };
      if (losBlocked(p0, p1, world.colliders)) continue;
      best = other;
      bestDist = dist;
    }
    return best;
  }

  function setPath(bot, targetNode) {
    const nearest = nearestNode(bot.pos);
    bot.ai.path = findPath(world.edges, nearest, targetNode);
    bot.ai.pathIndex = 0;
  }

  function nearestNode(pos) {
    let best = 'mid';
    let bestD = Infinity;
    for (const [id, [x, z]] of Object.entries(world.nodes)) {
      const d = (x - pos.x) ** 2 + (z - pos.z) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  function moveToward(bot, tx, tz, speed, dt) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const step = Math.min(dist, speed * dt);
    const mx = (dx / dist) * step;
    const mz = (dz / dist) * step;
    moveCircle(bot.pos, mx, mz, bot.pos.y, bot.crouch ? 1.15 : 1.7, 0.35, world.colliders);
    bot.vel.x = (dx / dist) * speed;
    bot.vel.z = (dz / dist) * speed;
    bot.moving = true;
    bot.yaw = angleTo(bot.pos, { x: tx, z: tz });
    return dist - step < 0.15;
  }

  function alertBots(shooter, pos) {
    for (const bot of state.actors) {
      if (!bot.isBot || !actorAlive(bot) || bot === shooter) continue;
      const dist = Math.hypot(bot.pos.x - pos.x, bot.pos.z - pos.z);
      if (dist > 20) continue;
      if (!bot.ai.target) {
        bot.ai.lastSeen = { x: pos.x, z: pos.z };
        bot.ai.lastSeenAt = state.phaseTime;
      }
    }
  }

  function assignRound(bot) {
    const ai = bot.ai;
    ai.state = 'advance';
    ai.path = [];
    ai.pathIndex = 0;
    ai.target = null;
    ai.lastSeen = null;
    ai.burstLeft = 0;
    ai.plantAt = 0;
    ai.defuseAt = 0;
    if (bot.team === 'us') {
      const lanes = LANE_NODES[ai.site];
      const lane = lanes[Math.floor(rng() * lanes.length)];
      ai.path = lane.slice();
      ai.pathIndex = 0;
    } else {
      const holds = HOLD_NODES.them;
      const node = holds[Math.floor(rng() * holds.length)];
      setPath(bot, node);
      ai.holdNode = node;
    }
  }

  function stepBot(bot, dt) {
    const ai = bot.ai;
    if (!actorAlive(bot)) return;
    const now = state.phaseTime;
    bot.moving = false;
    bot.bloom = Math.max(0, bot.bloom - dt * 0.05);
    bot.recoilPitch = Math.max(0, bot.recoilPitch - dt * 0.09);

    // Perception, staggered every 0.15 s per bot.
    if (now >= ai.thinkAt) {
      ai.thinkAt = now + 0.15;
      const seen = now < bot.blindUntil ? null : visibleEnemy(bot);
      if (seen) {
        if (ai.target !== seen) ai.reactionUntil = now + 0.35 + rng() * 0.35;
        ai.target = seen;
        ai.lastSeen = { x: seen.pos.x, z: seen.pos.z };
        ai.lastSeenAt = now;
        ai.state = 'engage';
      } else if (ai.target && now - ai.lastSeenAt > 2) {
        ai.target = null;
        if (ai.state === 'engage') ai.state = 'advance';
      }
    }

    // Planted bomb pulls defenders to the site and attackers into a guard.
    if (state.bomb.state === 'planted') {
      if (bot.team === 'them' && ai.state !== 'defuse' && ai.state !== 'engage') {
        ai.state = 'defuse';
        setPath(bot, state.bomb.site === 'A' ? 'siteA' : 'siteB');
      } else if (bot.team === 'us' && ai.state !== 'engage' && ai.state !== 'hold') {
        ai.state = 'hold';
        ai.holdUntil = now + 6;
        ai.holdNode = state.bomb.site === 'A' ? 'westN' : 'eastN';
        setPath(bot, ai.holdNode);
      }
    }

    if (now < bot.blindUntil) {
      bot.yaw += dt * 0.7;
      return;
    }

    if (ai.state === 'engage' && ai.target && actorAlive(ai.target)) {
      const t = ai.target;
      const dx = t.pos.x - bot.pos.x;
      const dz = t.pos.z - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      const wantYaw = angleTo(bot.pos, t.pos);
      bot.yaw += angleDiff(wantYaw, bot.yaw) * Math.min(1, dt * 10);
      bot.pitch = Math.max(-0.4, Math.min(0.4, Math.atan2(1.2 - bot.eye.y, dist)));
      const def = WEAPONS[bot.weapon];
      if (now >= ai.reactionUntil && now >= ai.fireAt) {
        if (ai.burstLeft <= 0) {
          ai.burstLeft = bot.weapon === 'longeye' ? 1 : 3 + Math.floor(rng() * 3);
          ai.burstPauseUntil = now + 0.45 + rng() * 0.4;
        }
        if (now < ai.burstPauseUntil && ai.burstLeft > 0) {
          const err = 0.022 + dist * 0.0011 + (bot.moving ? 0.02 : 0) + (t.moving ? 0.012 : 0);
          const aimYaw = bot.yaw + (rng() * 2 - 1) * err;
          const aimPitch = bot.pitch + (rng() * 2 - 1) * err * 0.6;
          const dir = {
            x: -Math.sin(aimYaw) * Math.cos(aimPitch),
            y: Math.sin(aimPitch),
            z: -Math.cos(aimYaw) * Math.cos(aimPitch),
          };
          const result = combat.fire(bot, dir, rng);
          if (result.fired) {
            ai.burstLeft -= 1;
            ai.fireAt = now + def.interval;
            if (bot.mag <= 0) ai.fireAt = now + def.reload;
          } else if (result.dry) {
            ai.fireAt = now + def.reload;
          }
        }
      }
      // Strafe while engaging, sometimes crouch for the shot.
      bot.crouch = rng() < 0.002 || (dist > 18 && rng() < 0.01);
      if (rng() < 0.01) {
        const side = rng() < 0.5 ? 1 : -1;
        const px = bot.pos.x + Math.cos(bot.yaw) * side * 1.2;
        const pz = bot.pos.z - Math.sin(bot.yaw) * side * 1.2;
        moveToward(bot, px, pz, 2.4, dt);
      }
      return;
    }

    if (ai.state === 'defuse') {
      const site = state.bomb.site === 'A' ? 'siteA' : 'siteB';
      const [sx, sz] = world.nodes[site];
      const dist = Math.hypot(sx - bot.pos.x, sz - bot.pos.z);
      if (dist > 1.6) {
        const target = ai.path[ai.pathIndex];
        if (target) {
          const [nx, nz] = world.nodes[target];
          if (moveToward(bot, nx, nz, 4.2, dt)) ai.pathIndex += 1;
        }
      } else if (state.bomb.state === 'planted') {
        bot.ai.defuseAt += dt;
        if (bot.ai.defuseAt >= 5) {
          state.bomb.state = 'defused';
          state.bomb.defuser = bot;
        }
      }
      return;
    }

    if (ai.state === 'hold') {
      const target = ai.path[ai.pathIndex];
      if (target) {
        const [nx, nz] = world.nodes[target];
        if (moveToward(bot, nx, nz, 3.4, dt)) ai.pathIndex += 1;
      } else {
        ai.scanYaw += dt * 0.5 * ai.scanDir;
        if (ai.scanYaw > 0.9 || ai.scanYaw < -0.9) ai.scanDir *= -1;
        bot.yaw += ai.scanDir * dt * 0.4;
        if (now > ai.holdUntil) {
          ai.state = 'advance';
          if (bot.team === 'them') {
            const holds = HOLD_NODES.them;
            const node = holds[Math.floor(rng() * holds.length)];
            setPath(bot, node);
            ai.holdNode = node;
          } else if (bot.team === 'us') {
            setPath(bot, ai.site === 'A' ? 'siteA' : 'siteB');
          }
        }
      }
      return;
    }

    // advance: walk the path; attackers plant when their site is reached.
    const target = ai.path[ai.pathIndex];
    if (!target) {
      if (bot.team === 'us') {
        const site = ai.site === 'A' ? 'siteA' : 'siteB';
        const [sx, sz] = world.nodes[site];
        if (Math.hypot(sx - bot.pos.x, sz - bot.pos.z) < 2.5) {
          const carrier = state.bomb.carrier === bot;
          const planted = state.bomb.state === 'planted';
          const enemiesNear = state.actors.some(
            (a) => a.team === 'them' && actorAlive(a) && Math.hypot(a.pos.x - bot.pos.x, a.pos.z - bot.pos.z) < 12,
          );
          if (carrier && !planted && !enemiesNear) {
            ai.state = 'plant';
            ai.plantAt = 0;
            return;
          }
          ai.state = 'hold';
          ai.holdUntil = now + 4 + rng() * 4;
          return;
        }
        setPath(bot, site);
      } else {
        ai.state = 'hold';
        ai.holdUntil = now + 4 + rng() * 4;
      }
      return;
    }
    const [nx, nz] = world.nodes[target];
    if (moveToward(bot, nx, nz, 3.6, dt)) ai.pathIndex += 1;

    // Stuck detection: barely moved in a second while trying to walk.
    const moved = Math.hypot(bot.pos.x - ai.stuckPos.x, bot.pos.z - ai.stuckPos.z);
    if (moved < 0.15) {
      if (now - ai.stuckAt > 1) {
        ai.pathIndex += 1;
        ai.stuckAt = now;
        ai.stuckPos = { x: bot.pos.x, z: bot.pos.z };
      }
    } else {
      ai.stuckAt = now;
      ai.stuckPos = { x: bot.pos.x, z: bot.pos.z };
    }
  }

  function stepPlant(bot, dt) {
    const ai = bot.ai;
    ai.plantAt += dt;
    if (ai.plantAt >= 3) {
      state.bomb.state = 'planted';
      state.bomb.site = ai.site;
      state.bomb.fuse = 35;
      state.bomb.position = { x: bot.pos.x, y: 0.1, z: bot.pos.z };
      state.bomb.planter = bot;
      ai.state = 'hold';
      ai.holdUntil = state.phaseTime + 8;
    }
  }

  function step(dt) {
    for (const actor of state.actors) {
      if (!actor.isBot) continue;
      if (actor.ai.state === 'plant') stepPlant(actor, dt);
      else stepBot(actor, dt);
    }
  }

  return { step, assignRound, alertBots, setPath };
}
