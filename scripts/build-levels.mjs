// Elige los 100 niveles a partir de los candidatos y los VUELVE A COMPROBAR con Stockfish a mayor profundidad.
// Uso: node scripts/build-levels.mjs <candidatos.jsonl ...>   →   escribe src/data/puzzles.json
import { readFileSync, writeFileSync } from 'node:fs';
import { Engine, score } from './lib-engine.mjs';

const files = process.argv.slice(2);
const pool = files.flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
let s = 777; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const diff = (c) => (c.t === 'm1' ? 1 + c.lg / 100 : c.t === 'w' ? 2 + c.fd * 0.6 : c.t === 'm2' ? 3 + c.fd * 0.5 : 5 + c.fd * 0.5) + (rnd() - 0.5) * 0.9;
// cuántos de cada grupo
const groups = [
  ['m1', (c) => c.t === 'm1', 19], ['w fácil', (c) => c.t === 'w' && c.fd <= 2, 24], ['m2 fácil', (c) => c.t === 'm2' && c.fd <= 3, 14],
  ['w medio', (c) => c.t === 'w' && c.fd >= 3 && c.fd <= 6, 10], ['m3 fácil', (c) => c.t === 'm3' && c.fd <= 3, 10],
  ['m2 difícil', (c) => c.t === 'm2' && c.fd > 3, 9], ['m3 difícil', (c) => c.t === 'm3' && c.fd > 3, 8], ['w difícil', (c) => c.t === 'w' && c.fd > 6, 6],
];
const seen = new Set(); const uniq = pool.filter((c) => { const k = c.f.split(' ').slice(0, 2).join(' '); if (seen.has(k)) return false; seen.add(k); return true; });

function check(lines) { // misma exigencia que el generador, pero a más profundidad
  const l1 = lines[0], l2 = lines[1]; if (!l1) return null;
  const mateFor = (x) => x && x.mate !== null && x.mate > 0;
  if (mateFor(l1) && l1.mate <= 3) return mateFor(l2) && l2.mate <= l1.mate ? null : 'm' + l1.mate;
  if (l1.mate === null && l1.cp >= 220 && l1.cp - (l2 ? score(l2) : -1e5) >= 160) return 'w';
  return null;
}
const e = new Engine(); await e.init();
const chosen = [];
for (const [name, pred, want] of groups) {
  const cand = uniq.filter(pred).sort(() => rnd() - 0.5); let got = 0;
  for (const c of cand) {
    if (got >= want) break;
    const r = await e.analyze(c.f, 20, 3); const t = check(r.lines);
    if (!t || r.lines[0].pv[0] !== c.m || (c.t[0] === 'm' ? t !== c.t : t !== 'w')) { process.stdout.write('x'); continue; }
    chosen.push({ ...c, pv: r.lines[0].pv.slice(0, 8).join(' '), d: diff(c) }); got++; process.stdout.write('.');
  }
  console.log(`\n${name}: ${got}/${want}`);
}
chosen.sort((a, b) => a.d - b.d);
writeFileSync('src/data/puzzles.json', JSON.stringify(chosen.map((c) => ({ f: c.f, m: c.m, pv: c.pv, t: c.t }))));
console.log('niveles escritos:', chosen.length);
console.log(chosen.map((c, i) => `${i + 1}:${c.t}${c.fd}`).join(' '));
e.quit();
