// Central state: one place holds the match, the actors and the round.
// Every other module reads or mutates this object; nothing keeps a second copy
// of health, money or the round clock.
export const STEP = 1 / 60;
export const ROUND_TIME = 100;
export const BUY_TIME = 12;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const BOMB_FUSE = 35;
export const GRAVITY = 13;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.08;

export const WEAPONS = {
  kestrel: {
    id: 'kestrel', name: 'KESTREL-9', kind: 'pistol', price: 0,
    damage: 34, headMult: 2, mag: 12, reserveMax: 36, auto: false,
    interval: 0.18, reload: 1.5, spread: 0.007, moveSpread: 0.016,
    recoil: 0.011, range: 40, desc: 'Sidearm. Light, honest, always yours.',
  },
  riptide: {
    id: 'riptide', name: 'RIPTIDE-9', kind: 'smg', price: 1500,
    damage: 26, headMult: 2, mag: 25, reserveMax: 100, auto: true,
    interval: 0.09, reload: 1.9, spread: 0.013, moveSpread: 0.026,
    recoil: 0.008, range: 28, desc: 'Close-quarters hose. Fast, hungry, wild.',
  },
  mastiff: {
    id: 'mastiff', name: 'MASTIFF-5', kind: 'rifle', price: 2700,
    damage: 33, headMult: 2, mag: 30, reserveMax: 90, auto: true,
    interval: 0.11, reload: 2.1, spread: 0.009, moveSpread: 0.022,
    recoil: 0.013, range: 50, desc: 'The workhorse. Stops to aim, drops targets.',
  },
  longeye: {
    id: 'longeye', name: 'LONGEYE', kind: 'dmr', price: 4000,
    damage: 80, headMult: 2.5, mag: 5, reserveMax: 20, auto: false,
    interval: 0.9, reload: 2.7, spread: 0.0015, moveSpread: 0.05,
    recoil: 0.045, range: 90, desc: 'One shot, one lesson. Punishes movement.',
  },
};

export const GEAR = {
  frag: { id: 'frag', name: 'SURGE FRAG', price: 300, desc: 'Cooks 1.2s after the bounce. Clears corners.' },
  flash: { id: 'flash', name: 'GLAREPOP', price: 200, desc: 'White-out for anyone facing it. Mind your own eyes.' },
  armor: { id: 'armor', name: 'DOCK PLATE', price: 650, desc: 'Absorbs the first 50 damage. Heavy, worth it.' },
};

export function createState() {
  return {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    round: 1,
    wins: { us: 0, them: 0 },
    timeLeft: BUY_TIME,
    phaseTime: 0,
    money: 800,
    kills: { us: 0, them: 0 },
    bomb: {
      state: 'idle', // idle | carried | planted | defused | detonated
      site: null, carrier: null, plantProgress: 0, defuseProgress: 0,
      fuse: 0, position: null, defuser: null, planter: null,
    },
    player: null, // actor object, created by sim
    actors: [], // player + bots, in one list
    events: [], // {kind, text, at} killfeed entries, newest first
    banner: null,
    matchWinner: null,
    stats: { shots: 0, hits: 0, kills: 0, roundsPlayed: 0 },
    seed: 1,
  };
}

// Damage falloff by distance, per weapon range: full inside half range, then
// a linear drop to 60% at the weapon's range, flat after.
export function falloff(damage, distance, range) {
  if (distance <= range * 0.5) return damage;
  const t = Math.min(1, (distance - range * 0.5) / (range * 0.5));
  return damage * (1 - 0.4 * t);
}

export function actorAlive(actor) {
  return actor.hp > 0;
}

export function teamAlive(state, team) {
  let n = 0;
  for (const a of state.actors) if (a.team === team && actorAlive(a)) n += 1;
  return n;
}
