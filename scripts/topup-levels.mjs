// Añade al final de puzzles.json los niveles que falten (hasta 100) con los candidatos más difíciles, comprobados a profundidad 20.
// Uso: node scripts/topup-levels.mjs <candidatos.jsonl ...>
import { readFileSync, writeFileSync } from 'node:fs';
import { Engine, score } from './lib-engine.mjs';
const P = JSON.parse(readFileSync('src/data/puzzles.json', 'utf8'));
const have = new Set(P.map((p) => p.f.split(' ').slice(0, 2).join(' ')));
const pool = process.argv.slice(2).flatMap((f) => { try { return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } })
  .filter((c) => !have.has(c.f.split(' ').slice(0, 2).join(' ')) && c.fd >= 8).sort((a, b) => Math.abs(a.fd - 9) - Math.abs(b.fd - 9));
const e = new Engine(); await e.init();
const mateFor = (x) => x && x.mate !== null && x.mate > 0;
for (const c of pool) {
  if (P.length >= 100) break;
  const r = await e.analyze(c.f, 20, 3); const [l1, l2] = r.lines;
  const t = mateFor(l1) && l1.mate <= 3 ? (mateFor(l2) && l2.mate <= l1.mate ? null : 'm' + l1.mate) : l1.mate === null && l1.cp >= 220 && l1.cp - (l2 ? score(l2) : -1e5) >= 160 ? 'w' : null;
  if (!t || l1.pv[0] !== c.m || t !== c.t) { console.log('descartado'); continue; }
  P.push({ f: c.f, m: c.m, pv: l1.pv.slice(0, 8).join(' '), t }); console.log('añadido', t, 'fd', c.fd, '→', P.length);
}
writeFileSync('src/data/puzzles.json', JSON.stringify(P)); console.log('total niveles:', P.length); e.quit();
