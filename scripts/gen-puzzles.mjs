// Genera candidatos a ejercicio con Stockfish: partidas con errores aleatorios y búsqueda de posiciones donde
// existe UNA jugada claramente mejor (mate forzado o ganancia clara). Uso: node scripts/gen-puzzles.mjs <semilla> <salida.jsonl> <minutos>
import { Chess } from 'chess.js';
import { appendFileSync } from 'node:fs';
import { Engine, score } from './lib-engine.mjs';

const seed0 = Number(process.argv[2] || 1); const out = process.argv[3] || '/tmp/cands.jsonl'; const minutes = Number(process.argv[4] || 10);
let s = seed0 * 2654435761 >>> 0;
const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const uciOf = (m) => m.from + m.to + (m.promotion || '');
const pieces = (c) => c.board().flat().filter(Boolean).length;
const key = (fen) => fen.split(' ').slice(0, 2).join(' ');

const MATE = process.env.MODE === 'mate'; // modo mate: partidas más largas y descuidadas para que aparezcan mates
const e = new Engine(); await e.init();
const seen = new Set(); const end = Date.now() + minutes * 60000; let n = 0, found = 0;

// Clasifica una posición con los datos del motor. Devuelve null si no sirve como ejercicio.
function classify(lines, strict) {
  const l1 = lines[0], l2 = lines[1];
  if (!l1) return null;
  const mateGap = (x) => x && x.mate !== null && x.mate > 0;
  if (mateGap(l1) && l1.mate <= 3) {
    if (l2 && mateGap(l2) && l2.mate <= l1.mate + (strict ? 0 : 1)) return null; // hay otra forma igual de rápida: no es única
    return { t: 'm' + l1.mate, e: l1.mate };
  }
  if (l1.mate === null && l1.cp >= 220) {
    const s2 = l2 ? score(l2) : -100000;
    if (l1.cp - s2 >= 160) return { t: 'w', e: l1.cp };
  }
  return null;
}

while (Date.now() < end) {
  const g = new Chess(); const plies = MATE ? 30 + Math.floor(rnd() * 90) : 16 + Math.floor(rnd() * 44);
  for (let ply = 0; ply < plies && !g.isGameOver(); ply++) {
    const moves = g.moves({ verbose: true }); if (!moves.length) break;
    let mv; let blunder = false;
    if (ply > 8 && rnd() < (MATE ? 0.3 : 0.14)) { mv = pick(moves); blunder = true; }
    else {
      const r = await e.analyze(g.fen(), 6, 4);
      const best = r.lines[0] ? score(r.lines[0]) : 0;
      const ok = r.lines.filter((l) => best - score(l) <= 90).map((l) => l.pv[0]);
      const u = pick(ok.length ? ok : [r.best]);
      mv = moves.find((m) => uciOf(m) === u) || pick(moves);
    }
    g.move(mv);
    if (ply < 9 || g.isGameOver() || pieces(g) < 8) continue;
    if (!MATE && !blunder && rnd() > 0.3) continue;
    if (MATE && ply < 20) continue;
    const fen = g.fen(); const k = key(fen); if (seen.has(k)) continue; seen.add(k); n++;
    const q = await e.analyze(fen, MATE ? 7 : 9, 2); // filtro rápido
    const qc = classify(q.lines, false); if (!qc || (MATE && qc.t === 'w')) continue;
    if (!MATE && qc.t === 'w') { // táctica obvia (la ve el motor con casi nada de profundidad): solo algunas, para los primeros niveles
      const quick = await e.analyze(fen, 2, 1);
      if (quick.best === q.lines[0].pv[0] && rnd() > 0.08) continue;
    }
    const d = await e.analyze(fen, 16, 3); // comprobación a fondo
    const c = classify(d.lines, true); if (!c || (MATE && c.t === 'w')) continue;
    const bestU = d.lines[0].pv[0]; if (bestU !== q.best && q.lines[0].pv[0] !== bestU && c.t === 'w') { /* cambio de opinión entre profundidades: se descarta si es dudoso */ if (Math.abs(q.lines[0].cp ?? 0) < 100) continue; }
    // ¿a partir de qué profundidad el motor ve la solución? (dificultad)
    let found1 = 16;
    const hist = [];
    for (const dep of [1, 2, 3, 4, 5, 6, 8, 10, 12]) { const r = await e.analyze(fen, dep, 1); hist.push([dep, r.best]); }
    for (let i = 0; i < hist.length; i++) if (hist.slice(i).every(([, b]) => b === bestU)) { found1 = hist[i][0]; break; }
    const legal = g.moves().length;
    const rec = { f: fen, m: bestU, pv: d.lines[0].pv.slice(0, 8).join(' '), t: c.t, e: c.e, fd: found1, lg: legal, pc: pieces(g) };
    appendFileSync(out, JSON.stringify(rec) + '\n'); found++;
    process.stdout.write(`\r[${seed0}] posiciones ${n}, ejercicios ${found}  `);
  }
}
console.log(`\n[${seed0}] fin: ${n} posiciones, ${found} ejercicios`);
e.quit();
