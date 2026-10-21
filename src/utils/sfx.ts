// Sonidos sintetizados (Web Audio), mismos que usa el analizador. Se pueden silenciar y se recuerda la elección.
let ac: AudioContext | null = null;
export const sound = {
  on: (() => { try { return localStorage.getItem('ngm-sound') !== 'off'; } catch { return true; } })(),
  set(v: boolean) { this.on = v; try { localStorage.setItem('ngm-sound', v ? 'on' : 'off'); } catch {} },
};
function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, delay = 0) {
  if (!sound.on) return;
  try {
    ac ||= new (window.AudioContext || (window as any).webkitAudioContext)();
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(); const g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
  } catch {}
}
export const sfx = {
  move: () => tone(220, 0.09, 'triangle', 0.18),
  capture: () => { tone(160, 0.14, 'sawtooth', 0.12); tone(110, 0.12, 'square', 0.06, 0.02); },
  check: () => { tone(660, 0.1, 'square', 0.08); tone(880, 0.16, 'square', 0.08, 0.1); },
  done: () => { tone(523, 0.12, 'sine', 0.12); tone(659, 0.12, 'sine', 0.12, 0.1); tone(784, 0.2, 'sine', 0.12, 0.2); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'sine', 0.13, i * 0.1)); },
  error: () => tone(130, 0.2, 'sawtooth', 0.1),
};
