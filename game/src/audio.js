// Procedural sound: every effect is synthesized with WebAudio — filtered noise
// bursts and short oscillator blips — so the game ships no audio files and
// makes no network request. The context is created on the first user gesture;
// every call is a no-op until then, which also keeps capture mode silent.
let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
}

function noise(dur, filterType, freq, gain, decay = 0.001) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(decay, t + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function tone(freq, dur, type, gain, slideTo = null, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export function playShot(kind, distant = false) {
  if (!ctx) return;
  const g = distant ? 0.12 : 0.5;
  if (kind === 'longeye') {
    noise(0.32, 'lowpass', 900, g);
    tone(140, 0.22, 'sine', g * 0.8, 45);
  } else if (kind === 'kestrel') {
    noise(0.12, 'bandpass', 1800, g * 0.8);
    tone(220, 0.08, 'square', g * 0.25, 90);
  } else if (kind === 'riptide') {
    noise(0.1, 'bandpass', 1400, g * 0.7);
    tone(180, 0.07, 'square', g * 0.2, 80);
  } else {
    noise(0.16, 'lowpass', 1400, g);
    tone(160, 0.12, 'sine', g * 0.6, 55);
  }
}

export function playDry() { tone(1200, 0.04, 'square', 0.12); }
export function playReload() {
  tone(900, 0.05, 'square', 0.14);
  tone(600, 0.05, 'square', 0.14, null, 0.25);
  tone(1100, 0.06, 'square', 0.18, null, 0.55);
}
export function playStep(run) { noise(0.06, 'lowpass', 420, run ? 0.1 : 0.06); }
export function playHit() { tone(1400, 0.05, 'sine', 0.2, 900); }
export function playKill() { tone(1400, 0.05, 'sine', 0.2, 900); tone(1800, 0.09, 'sine', 0.22, 1200, 0.07); }
export function playHurt() { tone(110, 0.18, 'sawtooth', 0.25, 60); noise(0.12, 'lowpass', 500, 0.2); }
export function playBeep(high = true) { tone(high ? 880 : 440, 0.09, 'sine', 0.22); }
export function playPlant() { playBeep(true); playBeep(true); }
export function playExplosion() {
  noise(1.1, 'lowpass', 320, 0.9);
  tone(70, 0.9, 'sine', 0.8, 28);
  noise(0.4, 'highpass', 2000, 0.25);
}
export function playFlash() { tone(2400, 0.5, 'sine', 0.12, 1800); }
export function playBuy() { tone(660, 0.07, 'sine', 0.18); tone(990, 0.1, 'sine', 0.18, null, 0.08); }
export function playRoundWin() {
  tone(523, 0.14, 'sine', 0.22); tone(659, 0.14, 'sine', 0.22, null, 0.14); tone(784, 0.24, 'sine', 0.24, null, 0.28);
}
export function playRoundLose() {
  tone(392, 0.16, 'sine', 0.2); tone(311, 0.22, 'sine', 0.2, null, 0.16);
}
export function playClick() { tone(700, 0.04, 'square', 0.1); }
