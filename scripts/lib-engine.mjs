// Pequeño envoltorio de Stockfish (el mismo motor que usa la web) para generar y verificar ejercicios desde Node.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(here, '..', 'node_modules', 'stockfish', 'bin', 'stockfish-19-lite-single.js');

export class Engine {
  constructor() {
    this.p = spawn('node', [ENGINE], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = ''; this.waiters = [];
    this.p.stdout.on('data', (d) => {
      this.buf += d;
      const lines = this.buf.split('\n'); this.buf = lines.pop();
      for (const l of lines) for (const w of [...this.waiters]) w(l.trim());
    });
    this.multipv = 1;
  }
  send(s) { this.p.stdin.write(s + '\n'); }
  until(pred, onLine) {
    return new Promise((resolve) => {
      const w = (l) => { if (onLine) onLine(l); if (pred(l)) { this.waiters.splice(this.waiters.indexOf(w), 1); resolve(l); } };
      this.waiters.push(w);
    });
  }
  async init() { this.send('uci'); await this.until((l) => l === 'uciok'); this.send('setoption name Hash value 32'); this.send('isready'); await this.until((l) => l === 'readyok'); }
  async setMultiPV(n) { if (n !== this.multipv) { this.send('setoption name MultiPV value ' + n); this.multipv = n; } }
  /** Devuelve { lines: [{cp, mate, d, pv:[uci...]}] ordenadas por multipv (desde el punto de vista de quien mueve), best } */
  async analyze(fen, depth, multipv = 1) {
    await this.setMultiPV(multipv);
    const lines = new Map();
    this.send('ucinewgame'); this.send('position fen ' + fen); this.send('go depth ' + depth);
    const end = await this.until((l) => l.startsWith('bestmove'), (l) => {
      if (!l.startsWith('info') || !l.includes(' pv ') || l.includes('lowerbound') || l.includes('upperbound')) return;
      const d = /depth (\d+)/.exec(l), cp = /score cp (-?\d+)/.exec(l), mt = /score mate (-?\d+)/.exec(l), pv = /\spv (.+)$/.exec(l), k = /multipv (\d+)/.exec(l);
      if (d && pv) lines.set(k ? +k[1] : 1, { d: +d[1], cp: cp ? +cp[1] : null, mate: mt ? +mt[1] : null, pv: pv[1].trim().split(' ') });
    });
    return { lines: [...lines.keys()].sort((a, b) => a - b).map((k) => lines.get(k)), best: end.split(' ')[1] };
  }
  quit() { try { this.send('quit'); this.p.kill(); } catch {} }
}
// Puntuación como número comparable (centipeones; los mates valen muchísimo)
export const score = (l) => (l.mate !== null ? (l.mate > 0 ? 100000 - l.mate * 100 : -100000 - l.mate * 100) : l.cp);
