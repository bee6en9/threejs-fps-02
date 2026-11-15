// HARBOURFALL — boot and the one loop. A fixed 60 Hz simulation feeds a
// render at the display's rate; the simulation (movement, shooting, bots,
// rounds, economy) never touches three.js or the DOM directly.
// ?shot=1|2|3|4&seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
// ?selftest=1 runs the simulation headlessly for 30 s and writes a JSON report
// into #selftest (and window.__selftest).
import { createState, STEP, ROUND_TIME, BUY_TIME, WIN_ROUNDS, WEAPONS, GEAR, teamAlive, actorAlive } from './state.js';
import { createWorld, moveCircle, losBlocked } from './world.js';
import { createTextures } from './textures.js';
import * as audio from './audio.js';
import { createInput } from './input.js';
import { createCombat } from './combat.js';
import { createBots, makeBot } from './bots.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const selftest = params.get('selftest') === '1';
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = shot || selftest ? mulberry32(seed) : Math.random;
const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

const state = createState();
state.seed = seed;
const textures = createTextures();
const render = createRenderer(document.getElementById('game'));
const { scene, camera } = render;
const world = createWorld(scene, textures);
const combat = createCombat(state, world, onCombatEvent);
const bots = createBots(state, world, combat, rng);
const hud = createHud({ onPlay, onBuy, onBuyClose });
const input = createInput(render.renderer.domElement, onLockChange);

let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let shake = 0;
let teamStatusAt = 0;
let footAt = 0;

function makePlayer(spawn) {
  return {
    isBot: false, name: 'You', team: 'us',
    pos: { x: spawn[0], y: 0, z: spawn[1] },
    vel: { x: 0, z: 0 }, vy: 0,
    yaw: 0, pitch: 0,
    eye: { x: spawn[0], y: 1.62, z: spawn[1] },
    hp: 100, armor: 0,
    weapon: 'kestrel', mag: WEAPONS.kestrel.mag, reserve: WEAPONS.kestrel.reserveMax,
    owned: { kestrel: true },
    grenades: { frag: 0, flash: 0 },
    selectedThrowable: 'frag',
    bloom: 0, recoilPitch: 0, moving: false, crouch: false,
    blindUntil: 0, lastDamageAt: -99, lastAttacker: null, deadAt: 0,
    shotsFired: 0, stepPhase: 0, reloadUntil: 0, reloadDip: 0,
  };
}

function resetActors() {
  state.actors = [];
  const p = makePlayer(world.spawns.us[0]);
  state.player = p;
  state.actors.push(p);
  world.spawns.us.slice(1).forEach((s, i) => state.actors.push(makeBot(state, 'us', i, s)));
  world.spawns.them.forEach((s, i) => state.actors.push(makeBot(state, 'them', i, s)));
  for (const a of state.actors) {
    a.hp = 100;
    a.armor = a === p ? (p.armorKept ?? 0) : 0;
    a.mag = WEAPONS[a.weapon].mag;
    a.reserve = WEAPONS[a.weapon].reserveMax;
    a.deadAt = 0;
    a.blindUntil = 0;
    a.bloom = 0;
    a.recoilPitch = 0;
    if (a.isBot) bots.assignRound(a);
  }
  state.bomb = {
    state: 'carried', site: null, carrier: p, plantProgress: 0, defuseProgress: 0,
    fuse: 0, position: null, defuser: null, planter: null,
  };
}

function startMatch() {
  state.wins = { us: 0, them: 0 };
  state.round = 1;
  state.money = 800;
  state.stats = { shots: 0, hits: 0, kills: 0, roundsPlayed: 0 };
  startRound();
}

function startRound() {
  const keepArmor = state.player ? state.player.armor : 0;
  const keepOwned = state.player ? state.player.owned : { kestrel: true };
  const keepWeapon = state.player ? state.player.weapon : 'kestrel';
  const keepGrenades = state.player ? state.player.grenades : { frag: 0, flash: 0 };
  resetActors();
  render.clearActors();
  state.player.armorKept = keepArmor;
  state.player.armor = keepArmor;
  state.player.owned = keepOwned;
  state.player.weapon = keepWeapon;
  state.player.grenades = keepGrenades;
  state.player.mag = WEAPONS[keepWeapon].mag;
  state.player.reserve = WEAPONS[keepWeapon].reserveMax;
  state.phase = 'buy';
  state.timeLeft = BUY_TIME;
  state.phaseTime = 0;
  hud.hideBanner();
  hud.showBuy(state);
  hud.setScore(state.wins.us, state.wins.them, state.round);
  hud.banner(`ROUND ${state.round}`, state.round === 1 ? 'Tidebreakers attack — plant the charge.' : 'Buy up. First to 5 rounds takes the pier.', '');
}

function endRound(winner, reason) {
  if (state.phase !== 'live' && state.phase !== 'buy') return;
  state.phase = 'roundEnd';
  state.phaseTime = 0;
  state.stats.roundsPlayed += 1;
  state.wins[winner] += 1;
  const playerWon = winner === 'us';
  state.money += playerWon ? 3250 : 1900;
  hud.setMoney(state.money);
  hud.hideBuy();
  if (playerWon) audio.playRoundWin();
  else audio.playRoundLose();
  hud.banner(
    playerWon ? 'ROUND WON' : 'ROUND LOST',
    `${reason} — Tidebreakers ${state.wins.us} : ${state.wins.them} Dockwardens`,
    playerWon ? 'win' : 'lose',
  );
  if (input.state.locked) input.releaseLock();
}

function endMatch() {
  state.phase = 'matchEnd';
  state.matchWinner = state.wins.us > state.wins.them ? 'us' : 'them';
  const won = state.matchWinner === 'us';
  hud.showOverlay('match', {
    title: won ? 'PIER TAKEN' : 'PIER LOST',
    sub: `Final score Tidebreakers ${state.wins.us} : ${state.wins.them} Dockwardens. ${won ? 'Harbourfall is yours.' : 'The Dockwardens keep the yard — run it back.'}`,
  });
  if (input.state.locked) input.releaseLock();
}

function onCombatEvent(kind, data) {
  if (kind === 'kill') {
    const { attacker, target, part } = data;
    const aTeam = attacker.team === 'us' ? 'us' : 'them';
    const tTeam = target.team === 'us' ? 'us' : 'them';
    const label = part === 'head' ? ' ✕ HEADSHOT' : part === 'frag' ? ' ✕ FRAG' : '';
    hud.killfeed(`<span class="${aTeam}">${attacker.name}</span> ▸ <span class="${tTeam}">${target.name}</span>${label}`);
    if (attacker === state.player) {
      state.money += 300;
      hud.setMoney(state.money);
      audio.playKill();
    }
    if (target === state.player) {
      audio.playHurt();
      hud.damageFlash();
      dropBomb(target);
    }
    if (target.isBot && target.team === 'them' && attacker === state.player) hud.hitmarker(true);
  } else if (kind === 'explosion') {
    render.spawnSparks(data.pos, 26, [1, 0.62, 0.15], 6);
    render.flashAt(data.pos);
    if (state.player && actorAlive(state.player)) {
      const d = Math.hypot(state.player.pos.x - data.pos.x, state.player.pos.z - data.pos.z);
      if (d < 14) shake = Math.min(0.5, 0.5 - d * 0.03);
    }
  } else if (kind === 'flash') {
    render.flashAt(data.pos);
    if (state.player && state.phaseTime < state.player.blindUntil) {
      hud.flashWhite(0.9);
    }
  }
}

function dropBomb(actor) {
  if (state.bomb.carrier !== actor || state.bomb.state !== 'carried') return;
  state.bomb.state = 'dropped';
  state.bomb.carrier = null;
  state.bomb.position = { x: actor.pos.x, y: 0.1, z: actor.pos.z };
}

function onLockChange(locked) {
  if (shot || selftest) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.hideBuy();
    audio.initAudio();
  } else if (state.phase === 'live' || state.phase === 'buy') {
    if (state.phase === 'matchEnd') return;
    hud.showOverlay('paused');
  }
}

function onPlay() {
  audio.initAudio();
  if (state.phase === 'menu' || state.phase === 'matchEnd') {
    hud.hideOverlay();
    startMatch();
    input.requestLock();
  } else if (state.phase === 'roundEnd') {
    hud.hideOverlay();
    nextRound();
    if (state.phase !== 'matchEnd') input.requestLock();
  } else {
    hud.hideOverlay();
    input.requestLock();
  }
}

function onBuyClose() {
  hud.hideBuy();
  input.requestLock();
}

function nextRound() {
  if (state.wins.us >= WIN_ROUNDS || state.wins.them >= WIN_ROUNDS) { endMatch(); return; }
  if (state.round >= 9 && state.wins.us !== state.wins.them) { endMatch(); return; }
  state.round += 1;
  startRound();
}

function onBuy(id) {
  const p = state.player;
  if (state.phase !== 'buy' || !p) return;
  const item = WEAPONS[id] ?? GEAR[id];
  if (!item) return;
  if (id === 'armor') {
    if (p.armor >= 50 || state.money < item.price) return;
    state.money -= item.price;
    p.armor = 50;
  } else if (WEAPONS[id]) {
    if (p.owned[id] || state.money < item.price) return;
    state.money -= item.price;
    p.owned[id] = true;
    p.weapon = id;
    p.mag = item.mag;
    p.reserve = item.reserveMax;
  } else {
    if (p.grenades[id] >= 2 || state.money < item.price) return;
    state.money -= item.price;
    p.grenades[id] += 1;
  }
  audio.playBuy();
  hud.setMoney(state.money);
  hud.refreshBuy(state);
  hud.setAmmo(p.mag, p.reserve, WEAPONS[p.weapon].name);
}

// --- Player simulation -------------------------------------------------------
function playerLook(dx, dy) {
  const p = state.player;
  if (!p || !actorAlive(p)) return;
  p.yaw -= dx * 0.0022;
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - dy * 0.0022));
}

function playerStep(dt) {
  const p = state.player;
  if (!p || !actorAlive(p)) return;
  const keys = input.state.keys;
  const now = state.phaseTime;
  p.bloom = Math.max(0, p.bloom - dt * 0.045);
  p.recoilPitch = Math.max(0, p.recoilPitch - dt * 0.085);
  p.reloadDip = Math.max(0, (p.reloadUntil - now) / 2.2);

  // Movement: acceleration toward the wish direction, friction when idle.
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const crouch = keys.has('ControlLeft') || keys.has('ControlRight');
  p.crouch = crouch;
  const speed = crouch ? 2.2 : sprint ? 5.8 : 4.3;
  let fx = 0;
  let fz = 0;
  if (keys.has('KeyW')) fz -= 1;
  if (keys.has('KeyS')) fz += 1;
  if (keys.has('KeyA')) fx -= 1;
  if (keys.has('KeyD')) fx += 1;
  const len = Math.hypot(fx, fz) || 1;
  fx /= len;
  fz /= len;
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  // Wish direction: forward is (-sin, -cos), right is (cos, -sin); W gives
  // fz = -1, so forward is -fz and right is fx.
  const wx = sin * fz + cos * fx;
  const wz = cos * fz - sin * fx;
  const accel = 42;
  p.vel.x += wx * accel * dt;
  p.vel.z += wz * accel * dt;
  const sp = Math.hypot(p.vel.x, p.vel.z);
  if (sp > speed) {
    p.vel.x *= speed / sp;
    p.vel.z *= speed / sp;
  }
  if (fx === 0 && fz === 0) {
    const f = Math.max(0, 1 - 11 * dt);
    p.vel.x *= f;
    p.vel.z *= f;
  }
  p.moving = sp > 0.6;
  moveCircle(p.pos, p.vel.x * dt, p.vel.z * dt, p.pos.y, p.crouch ? 1.15 : 1.7, 0.35, world.colliders);

  if (keys.has('Space') && p.pos.y <= 0.01) p.vy = 4.6;
  p.vy -= 13 * dt;
  p.pos.y += p.vy * dt;
  if (p.pos.y <= 0) { p.pos.y = 0; p.vy = 0; }
  p.eye.x = p.pos.x;
  p.eye.y = p.pos.y + (p.crouch ? EYE_CROUCH : 1.62);
  p.eye.z = p.pos.z;
  p.stepPhase += sp * dt * 1.6;
  if (p.moving && now - footAt > (sprint ? 0.32 : 0.42)) {
    footAt = now;
    audio.playStep(sprint);
  }

  // Weapon switching
  const ownedList = Object.keys(WEAPONS).filter((id) => p.owned[id]);
  for (let i = 0; i < ownedList.length; i += 1) {
    if (keys.has(`Digit${i + 1}`)) switchWeapon(p, ownedList[i]);
  }
  if (keys.has('Digit4')) p.selectedThrowable = 'frag';
  if (keys.has('Digit5')) p.selectedThrowable = 'flash';
  if (keys.has('KeyG')) throwPlayerGrenade(p);

  // Firing and reload
  const def = WEAPONS[p.weapon];
  if (now >= p.reloadUntil) {
    if (input.state.firing && p.mag > 0 && now >= (p.nextShotAt ?? 0)) {
      firePlayer(p);
    } else if (input.state.firing && p.mag === 0) {
      audio.playDry();
      p.nextShotAt = now + 0.3;
      startReload(p);
    }
    if (keys.has('KeyR')) startReload(p);
  }

  // Bomb: pick up, plant, drop.
  const bomb = state.bomb;
  if (bomb.state === 'dropped' && bomb.position) {
    const d = Math.hypot(p.pos.x - bomb.position.x, p.pos.z - bomb.position.z);
    if (d < 1.4) {
      bomb.state = 'carried';
      bomb.carrier = p;
      bomb.position = null;
      hud.setPrompt('<b>Surge charge picked up</b> — take it to Crane Bay or Fuel Depot');
      setTimeout(() => hud.setPrompt(null), 2500);
    }
  }
  if (keys.has('KeyQ') && bomb.carrier === p) dropBomb(p);
  const nearSite = siteNear(p.pos, 3.2);
  if (bomb.carrier === p && nearSite && keys.has('KeyE') && state.phase === 'live') {
    bomb.plantProgress += dt / 3;
    hud.setPlantBar(bomb.plantProgress);
    if (Math.floor(bomb.plantProgress * 10) !== Math.floor((bomb.plantProgress - dt / 3) * 10)) audio.playBeep(true);
    if (bomb.plantProgress >= 1) {
      bomb.state = 'planted';
      bomb.site = nearSite.id;
      bomb.fuse = 35;
      bomb.position = { x: nearSite.x, y: 0.1, z: nearSite.z };
      bomb.planter = p;
      bomb.plantProgress = 0;
      state.money += 300;
      hud.setMoney(state.money);
      hud.setPlantBar(null);
      audio.playPlant();
    }
  } else {
    bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 2);
    if (bomb.plantProgress > 0) hud.setPlantBar(bomb.plantProgress);
    else hud.setPlantBar(null);
  }
}

function siteNear(pos, r) {
  for (const s of world.sites) {
    if (Math.hypot(pos.x - s.x, pos.z - s.z) < r + s.r * 0.4) return s;
  }
  return null;
}

function switchWeapon(p, id) {
  if (p.weapon === id || !p.owned[id]) return;
  p.weapon = id;
  p.mag = WEAPONS[id].mag;
  p.reserve = WEAPONS[id].reserveMax;
  p.reloadUntil = 0;
  p.nextShotAt = state.phaseTime + 0.25;
  audio.playClick();
  hud.setAmmo(p.mag, p.reserve, WEAPONS[id].name);
}

function startReload(p) {
  if (p.reloadUntil > state.phaseTime || p.reserve <= 0 || p.mag === WEAPONS[p.weapon].mag) return;
  p.reloadUntil = state.phaseTime + WEAPONS[p.weapon].reload;
  audio.playReload();
}

function finishReload(p) {
  const def = WEAPONS[p.weapon];
  const need = def.mag - p.mag;
  const take = Math.min(need, p.reserve);
  p.mag += take;
  p.reserve -= take;
  hud.setAmmo(p.mag, p.reserve, def.name);
}

function aimDir(a) {
  return {
    x: -Math.sin(a.yaw) * Math.cos(a.pitch),
    y: Math.sin(a.pitch),
    z: -Math.cos(a.yaw) * Math.cos(a.pitch),
  };
}

function firePlayer(p) {
  const def = WEAPONS[p.weapon];
  const now = state.phaseTime;
  p.nextShotAt = now + def.interval;
  const dir = aimDir(p);
  const result = combat.fire(p, dir, rng);
  if (!result.fired) return;
  audio.playShot(p.weapon);
  bots.alertBots(p, p.pos);
  if (result.hit) {
    render.addTracer(result.origin, result.hit.point);
    if (result.hit.kind === 'world') render.spawnSparks(result.hit.point, 6, [0.9, 0.8, 0.6], 3);
    else {
      render.spawnSparks(result.hit.point, 10, [0.75, 0.1, 0.1], 2.5);
      hud.hitmarker(result.killed);
      audio.playHit();
    }
    render.flashAt({ x: p.eye.x + dir.x * 0.8, y: p.eye.y + dir.y * 0.8, z: p.eye.z + dir.z * 0.8 });
  }
  hud.setAmmo(p.mag, p.reserve, def.name);
}

function throwPlayerGrenade(p) {
  if (state.phaseTime < (p.nextThrowAt ?? 0)) return;
  if (p.grenades[p.selectedThrowable] <= 0) return;
  p.nextThrowAt = state.phaseTime + 0.8;
  combat.throwGrenade(p, p.selectedThrowable, aimDir(p));
}

// --- Fixed-step simulation ---------------------------------------------------
function stepSim(dt) {
  state.phaseTime += dt;
  if (state.phase === 'buy') {
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) {
      state.phase = 'live';
      state.timeLeft = ROUND_TIME;
      state.phaseTime = 0;
      hud.hideBuy();
      hud.hideBanner();
      audio.playBeep(true);
    }
    return;
  }
  if (state.phase === 'roundEnd') {
    if (state.phaseTime >= 4) nextRound();
    return;
  }
  if (state.phase !== 'live') return;

  state.timeLeft -= dt;
  const p = state.player;
  if (p && p.reloadUntil > 0 && state.phaseTime >= p.reloadUntil) {
    finishReload(p);
    p.reloadUntil = 0;
  }
  playerStep(dt);
  bots.step(dt);
  for (const a of state.actors) {
    if (!a.isBot) continue;
    a.eye.x = a.pos.x;
    a.eye.y = a.pos.y + (a.crouch ? 1.08 : 1.62);
    a.eye.z = a.pos.z;
  }
  combat.stepGrenades(dt);

  // Bomb carrier bots plant; dropped bomb pickup by bots.
  const bomb = state.bomb;
  if (bomb.state === 'dropped' && bomb.position) {
    for (const a of state.actors) {
      if (a.team === 'us' && a.isBot && actorAlive(a) &&
          Math.hypot(a.pos.x - bomb.position.x, a.pos.z - bomb.position.z) < 1.4) {
        bomb.state = 'carried';
        bomb.carrier = a;
        bomb.position = null;
        break;
      }
    }
  }
  if (bomb.state === 'planted') {
    bomb.fuse -= dt;
    if (Math.floor(bomb.fuse * 2) !== Math.floor((bomb.fuse + dt) * 2)) audio.playBeep(bomb.fuse < 10);
    if (bomb.fuse <= 0) {
      bomb.state = 'detonated';
      onCombatEvent('explosion', { pos: bomb.position });
      endRound('us', 'Charge detonated at ' + (bomb.site === 'A' ? 'Crane Bay' : 'Fuel Depot'));
      return;
    }
  }
  if (bomb.state === 'defused') {
    endRound('them', 'Charge defused');
    return;
  }

  // Round end by elimination or by the clock.
  if (teamAlive(state, 'them') === 0) { endRound('us', 'Dockwardens wiped out'); return; }
  if (teamAlive(state, 'us') === 0) { endRound('them', 'Tidebreakers wiped out'); return; }
  if (state.timeLeft <= 0 && bomb.state !== 'planted') { endRound('them', 'Time — the sites held'); return; }

  // HUD prompts for the player.
  if (p && actorAlive(p)) {
    const nearSite = siteNear(p.pos, 3.2);
    if (bomb.carrier === p && nearSite && state.phase === 'live') {
      hud.setPrompt(`Hold <b>E</b> to plant at ${nearSite.name}`);
    } else if (bomb.state === 'planted') {
      hud.setPrompt(null);
    } else if (bomb.state === 'dropped') {
      hud.setPrompt('The charge is down — walk over it to pick it up');
    } else {
      hud.setPrompt(null);
    }
    if (bomb.state === 'planted') {
      hud.setBombStatus(`CHARGE PLANTED — ${bomb.site} — ${Math.ceil(bomb.fuse)}s`);
    } else if (bomb.carrier === p) {
      hud.setBombStatus('YOU CARRY THE CHARGE');
    } else {
      hud.setBombStatus(null);
    }
  }
}

function syncHud() {
  const p = state.player;
  if (!p) return;
  hud.setHealth(p.hp, p.armor);
  hud.setAmmo(p.mag, p.reserve, WEAPONS[p.weapon].name);
  hud.setMoney(state.money);
  hud.setTimer(state.timeLeft, state.phase);
  hud.setScore(state.wins.us, state.wins.them, state.round);
  if (state.phaseTime - teamStatusAt > 0.25) {
    teamStatusAt = state.phaseTime;
    hud.setTeamStatus(state.actors);
  }
}

// --- Frame loop --------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) {
    render.renderer.render(scene, camera);
    return;
  }
  const look = input.takeLook();
  playerLook(look.x, look.y);
  accumulator += dt;
  let steps = 0;
  while (accumulator >= STEP && steps < 5) {
    stepSim(STEP);
    accumulator -= STEP;
    steps += 1;
  }
  if (accumulator > STEP * 5) accumulator = 0;

  // Camera follows the player, or a living teammate while spectating.
  const p = state.player;
  if (p && actorAlive(p)) {
    render.syncCamera(camera, p);
  } else if (p) {
    const mate = state.actors.find((a) => a.team === 'us' && a.isBot && actorAlive(a));
    if (mate) {
      camera.position.set(mate.eye.x, mate.eye.y, mate.eye.z);
      camera.rotation.set(mate.pitch, mate.yaw, 0, 'YXZ');
    }
  }
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 1.4);
    camera.position.x += (Math.random() - 0.5) * shake * 0.14;
    camera.position.y += (Math.random() - 0.5) * shake * 0.14;
  }
  // Grenade meshes follow the live grenades.
  combat.grenades.forEach((g, i) => {
    const m = render.grenadeMeshes[i];
    if (!m) return;
    m.visible = true;
    m.position.set(g.pos.x, g.pos.y, g.pos.z);
  });
  for (let i = combat.grenades.length; i < render.grenadeMeshes.length; i += 1) {
    render.grenadeMeshes[i].visible = false;
  }
  render.step(dt, state, p);
  syncHud();
  render.renderer.render(scene, camera);
}

window.addEventListener('resize', render.onResize);

// --- Deterministic capture frames --------------------------------------------
function aimAt(actor, point) {
  const dx = point.x - actor.pos.x;
  const dy = point.y - (actor.pos.y + 1.62);
  const dz = point.z - actor.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  actor.yaw = Math.atan2(-dx, -dz);
  actor.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) stepSim(STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    const p = state.player;
    if (p) render.syncCamera(camera, p);
    // Sync the actor meshes, tracers and particles once so the frozen frame
    // shows the bots and the shot, not just the empty map.
    render.step(0, state, p);
    render.renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  startMatch();
  // startRound opens the buy menu; hide it again — shot 3 re-opens it below.
  hud.hideOverlay();
  hud.hideBuy();
  state.phase = 'live';
  state.timeLeft = ROUND_TIME;
  state.phaseTime = 0;
  const p = state.player;
  const botsAlive = state.actors.filter((a) => a.isBot);
  const enemy = (i) => botsAlive.filter((a) => a.team === 'them')[i];
  const friend = (i) => botsAlive.filter((a) => a.team === 'us')[i];
  if (name === '1') {
    // Cover: mid-lane firefight, muzzle flash and a tracer frozen mid-air.
    p.pos.x = -2; p.pos.z = 9; p.pos.y = 0;
    aimAt(p, { x: -6, y: 1.3, z: -6 });
    enemy(0).pos.x = -7; enemy(0).pos.z = -4; enemy(0).yaw = 0.4;
    enemy(1).pos.x = 3; enemy(1).pos.z = -2; enemy(1).yaw = -0.5;
    friend(0).pos.x = -6; friend(0).pos.z = 4; friend(0).yaw = 0.2;
    settle(30);
    p.eye.x = p.pos.x; p.eye.y = p.pos.y + 1.62; p.eye.z = p.pos.z;
    const dir = aimDir(p);
    combat.fire(p, dir, rng);
    const hit = combat.rayHit(p.eye, dir, 90, p);
    if (hit) render.addTracer(p.eye, hit.point);
    render.flashAt({ x: p.eye.x + dir.x, y: p.eye.y, z: p.eye.z + dir.z });
    settle(6);
  } else if (name === '2') {
    // Planting the charge at Crane Bay, seen over the site from a few steps back.
    p.pos.x = -17; p.pos.z = -7; p.pos.y = 0;
    p.weapon = 'mastiff'; p.mag = 24; p.reserve = 90;
    state.bomb.state = 'carried';
    state.bomb.carrier = p;
    aimAt(p, { x: -17, y: 1.0, z: -11 });
    enemy(0).pos.x = -10; enemy(0).pos.z = -3; enemy(0).yaw = 2.6;
    friend(0).pos.x = -20; friend(0).pos.z = -7; friend(0).yaw = 0.6;
    settle(24);
    // The settle lets bots act; restore full health so the frame reads as a
    // fresh plant attempt, not a fight already lost.
    p.hp = 100;
    hud.setHealth(100, p.armor);
    state.bomb.plantProgress = 0.62;
    hud.setPlantBar(0.62);
    hud.setPrompt('Hold <b>E</b> to plant at CRANE BAY');
    hud.setBombStatus('YOU CARRY THE CHARGE');
    settle(4);
  } else if (name === '3') {
    // Buy phase at spawn, menu open.
    p.pos.x = 0; p.pos.z = 15; p.pos.y = 0;
    state.phase = 'buy';
    state.timeLeft = BUY_TIME;
    state.money = 4750;
    aimAt(p, { x: 2, y: 1.4, z: 0 });
    settle(10);
    hud.showBuy(state);
  } else {
    // Long sightline down the east lane toward Fuel Depot, with an enemy
    // pushing the open ground and a teammate holding beside you.
    p.pos.x = 13; p.pos.z = 12; p.pos.y = 0;
    p.weapon = 'longeye'; p.mag = 5; p.reserve = 20;
    aimAt(p, { x: 17, y: 1.3, z: -11 });
    enemy(0).pos.x = 12; enemy(0).pos.z = 6; enemy(0).yaw = 3.0;
    enemy(1).pos.x = 14; enemy(1).pos.z = -5; enemy(1).yaw = 2.8;
    friend(1).pos.x = 15; friend(1).pos.z = 8; friend(1).yaw = -0.3;
    settle(24);
    hud.setPrompt(null);
    settle(4);
  }
  p.eye.x = p.pos.x;
  p.eye.y = p.pos.y + 1.62;
  p.eye.z = p.pos.z;
  syncHud();
  paintTwiceThenReady();
}

// --- Headless self-test ------------------------------------------------------
function runSelftest() {
  startMatch();
  state.phase = 'live';
  state.timeLeft = ROUND_TIME;
  const p = state.player;
  const report = { steps: 0, errors, shots: 0, hits: 0, playerMoved: 0, botsMoved: 0, botsAlive: 0, phase: '', round: 0 };
  const start = { x: p.pos.x, z: p.pos.z };
  const botStart = state.actors.filter((a) => a.isBot).map((a) => ({ a, x: a.pos.x, z: a.pos.z }));
  input.state.keys.add('KeyW');
  for (let i = 0; i < 1800; i += 1) {
    if (i === 300) input.state.firing = true;
    if (i === 420) { input.state.firing = false; }
    if (i === 600) { input.state.keys.add('KeyA'); }
    if (i === 900) { input.state.keys.delete('KeyA'); input.state.keys.add('KeyD'); }
    if (i === 1200) { input.state.keys.delete('KeyD'); }
    if (i === 240) p.yaw += 0.5;
    if (i === 700) p.yaw -= 0.9;
    // Aim at the nearest living enemy while firing, so the hit path is exercised.
    if (input.state.firing) {
      let best = null;
      let bestD = Infinity;
      for (const a of state.actors) {
        if (a.team === 'us' || !actorAlive(a)) continue;
        const d = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
        if (d < bestD) { bestD = d; best = a; }
      }
      if (best) aimAt(p, { x: best.pos.x, y: best.pos.y + 1.2, z: best.pos.z });
    }
    stepSim(STEP);
    report.steps += 1;
    if (state.phase === 'roundEnd') break;
  }
  input.state.keys.clear();
  input.state.firing = false;
  // Controlled hit test: player and one enemy in the open mid, no wall
  // between them. Aim, fire once, record what the ray found.
  const testBot = state.actors.find((a) => a.team === 'them' && actorAlive(a)) ??
    state.actors.find((a) => a.team === 'them');
  p.hp = 100;
  testBot.hp = 100;
  p.pos.x = 0; p.pos.z = 10; p.pos.y = 0;
  p.eye.x = 0; p.eye.y = 1.62; p.eye.z = 10;
  testBot.pos.x = 0; testBot.pos.z = 0; testBot.pos.y = 0;
  testBot.eye.x = 0; testBot.eye.y = 1.62; testBot.eye.z = 0;
  p.weapon = 'kestrel'; p.mag = 12; p.reserve = 36;
  aimAt(p, { x: 0, y: 1.2, z: 0 });
  const testDir = aimDir(p);
  const testRes = combat.fire(p, testDir, rng);
  report.hitTest = {
    fired: testRes.fired,
    hitKind: testRes.hit?.kind ?? null,
    part: testRes.hit?.part ?? null,
    dist: testRes.hit ? +testRes.hit.dist.toFixed(2) : null,
    botHp: testBot.hp,
  };
  report.shots = state.stats.shots;
  report.hits = state.stats.hits;
  report.playerMoved = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
  report.botsMoved = botStart.reduce((sum, b) => sum + Math.hypot(b.a.pos.x - b.x, b.a.pos.z - b.z), 0);
  report.botsAlive = state.actors.filter((a) => a.isBot && actorAlive(a)).length;
  report.phase = state.phase;
  report.round = state.round;
  report.playerHp = p.hp;
  // Nav graph validation: every edge's straight line must clear the colliders.
  const blockedEdges = [];
  for (const [from, tos] of Object.entries(world.edges)) {
    const [fx, fz] = world.nodes[from];
    for (const to of tos) {
      const [tx, tz] = world.nodes[to];
      if (losBlocked({ x: fx, y: 1.2, z: fz }, { x: tx, y: 1.2, z: tz }, world.colliders)) {
        blockedEdges.push(`${from}->${to}`);
      }
    }
  }
  report.blockedEdges = blockedEdges;
  report.actors = state.actors.map((a) => ({ name: a.name, team: a.team, hp: Math.round(a.hp), x: +a.pos.x.toFixed(1), z: +a.pos.z.toFixed(1) }));
  document.getElementById('selftest').textContent = JSON.stringify(report);
  window.__selftest = report;
  render.syncCamera(camera, p);
  render.renderer.render(scene, camera);
}

// --- Boot --------------------------------------------------------------------
window.__round = 1;
resetActors();
state.phase = 'menu';
syncHud();
if (shot) runShot(shot);
else if (selftest) runSelftest();
else requestAnimationFrame(frame);
