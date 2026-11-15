// HARBOURFALL — a three.js tactical FPS entry for make.fun (Node 22, stdlib only).
// The program hands the game in: it copies this repository's game/ (static ES
// modules, three.js 0.187.0 vendored) and screenshots/ (3-4 real renders) into
// /output and writes /output/dossier.json with the kit's buildDossier library,
// the summary the AI judge reads. Run it outside the grader with
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// It runs twice in the grader and both runs must write the same bytes: the copy
// is a plain file copy and the dossier is built deterministically from the same
// files, so the outputs match byte for byte.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');

function countFiles(dir, seen = { files: 0, bytes: 0 }) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = statSync(path);
    if (stats.isDirectory()) countFiles(path, seen);
    else {
      seen.files += 1;
      seen.bytes += stats.size;
    }
  }
  return seen;
}

function fail(message) {
  throw new Error(`main.ts: ${message}`);
}

if (!existsSync(join(gameDir, 'index.html'))) fail('game/index.html is missing');
if (!existsSync(join(gameDir, 'vendor', 'three', 'three.module.min.js'))) fail('game/vendor/three/three.module.min.js is missing');
if (!existsSync(join(gameDir, 'vendor', 'three', 'three.core.min.js'))) fail('game/vendor/three/three.core.min.js is missing');

const gameStats = countFiles(gameDir);
if (gameStats.files > 993) fail(`game/ holds ${gameStats.files} files, the gate allows 993`);
if (gameStats.bytes > 48 * 1024 * 1024) fail(`game/ is ${gameStats.bytes} bytes, the gate allows 48 MiB`);

const shots = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((name) => !name.startsWith('.')).sort()
  : [];
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images, the gate needs 3 or 4`);
for (const name of shots) {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('-')) fail(`screenshot name ${name} is not allowed`);
  const size = statSync(join(shotsDir, name)).size;
  if (size > 256 * 1024) fail(`screenshot ${name} is ${size} bytes, the gate allows 256 KiB`);
}

mkdirSync(outDir, { recursive: true });
cpSync(gameDir, join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

// The scorer's own caps: only text_max_bytes shapes the dossier text; the
// others refuse an entry the scorer would refuse, so check them here first.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);

console.log(
  `harbourfall: game/ ${gameStats.files} files, ${gameStats.bytes} bytes; ` +
  `screenshots/ ${shots.join(', ')}; dossier.json written to ${outDir}`,
);
