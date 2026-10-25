// Amplía puzzles.json hasta TARGET niveles (por defecto 200) con candidatos nuevos, comprobados con Stockfish a profundidad 20.
// Los niveles nuevos se añaden al final ordenados de menos a más difíciles (sin mates en 1, que ya están al principio).
// Uso: TARGET=200 node scripts/extend-levels.mjs <candidatos.jsonl ...>
import { readFileSync, writeFileSync } from 'node:fs';
import { Engine, score } from './lib-engine.mjs';
const TARGET = Number(process.env.TARGET || 200);
const P = JSON.parse(readFileSync('src/data/puzzles.json', 'utf8'));
const key = (f) => f.split(' ').slice(0, 2).join(' ');
const have = new Set(P.map((p) => key(p.f)));
const diff = (c) => (c.t === 'w' ? 2 + c.fd * 0.6 : c.t === 'm2' ? 3 + c.fd * 0.5 : 5 + c.fd * 0.5);
const seen = new Set();
const pool = process.argv.slice(2).flatMap((f) => { try { return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } })
  .filter((c) => c.t !== 'm1' && !have.has(key(c.f)) && (seen.has(key(c.f)) ? false : (seen.add(key(c.f)), true)));
// mezcla por tipo para que no salgan todos los de un mismo tipo
let s = 4242; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
pool.sort(() => rnd() - 0.5);
const e = new Engine(); await e.init();
const mateFor = (x) => x && x.mate !== null && x.mate > 0;
const add = [];
for (const c of pool) {
  if (P.length + add.length >= TARGET) break;
  const r = await e.analyze(c.f, 20, 3); const [l1, l2] = r.lines;
  const t = mateFor(l1) && l1.mate <= 3 ? (mateFor(l2) && l2.mate <= l1.mate ? null : 'm' + l1.mate) : l1.mate === null && l1.cp >= 220 && l1.cp - (l2 ? score(l2) : -1e5) >= 160 ? 'w' : null;
  if (!t || l1.pv[0] !== c.m || t !== c.t) continue;
  add.push({ f: c.f, m: c.m, pv: l1.pv.slice(0, 8).join(' '), t, _d: diff(c) }); process.stdout.write(`+${add.length} `);
}
add.sort((a, b) => a._d - b._d).forEach((a) => { delete a._d; P.push(a); });
writeFileSync('src/data/puzzles.json', JSON.stringify(P)); console.log('\ntotal niveles:', P.length); e.quit();
