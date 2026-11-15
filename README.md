# threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/bee6en9/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/bee6en9/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

HARBOURFALL — Dockside Tactics: a round-based tactical FPS in the browser, built on three.js 0.187.0. No build step, no network: open `game/index.html` from any static server and play. Pier 9, a container yard after dark. You are a **Tidebreaker** attacking against the **Dockwardens**. First to 5 rounds takes the pier.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=vfk2n47z&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>

## The game

- **Rounds:** eliminate the other team, or plant the surge charge at Crane Bay (Site A) or Fuel Depot (Site B) and hold it until it detonates. Defenders win on the clock if nothing is planted — and by defusing the charge.
- **Economy:** kills and round wins pay credits. Spend them in the buy menu (B during the buy phase) on rifles, a DMR, grenades and dock plate.
- **Gunplay:** hitscan with headshots, recoil and spread that punish firing on the move, crouching and stopping to aim. Four weapons, a frag and a flash.
- **Bots:** three teammates and four defenders who run lanes, hold sites, react to what they see and hear, plant and defuse.
- **Map:** an original yard — container stacks, a warehouse with a sunlit hall, a crane, three lanes, two sites. All art is procedural (canvas textures, three.js geometry); all sound is synthesized with WebAudio.

## Controls

WASD move · mouse look · click fire · R reload · Shift sprint · Ctrl crouch · Space jump · 1–3 weapons · 4 frag · 5 flash · G throw · E plant/defuse · B buy menu · Q drop the charge.

## Files

- `main.ts` — the entry program: copies `game/` and `screenshots/` to `/output` and writes `dossier.json` (run with `MAKEFUN_OUTPUT_DIR=out`).
- `game/` — the playable game: `index.html` plus `src/` modules and vendored three.js 0.187.0 under `game/vendor/three/`.
- `screenshots/` — real renders of the game, taken in Chrome.
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged.

MIT licensed. Three.js files are npm's three@0.187.0 build output, MIT licensed.
