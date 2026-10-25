// Cliente del protocolo de duelos en línea. No toca el DOM: la web (y las futuras apps de iOS/Android, que cargan esta misma web
// o reutilizan este archivo) solo tienen que pintar lo que llega. Protocolo completo en ONLINE.md.
export interface Profile { n: string; e: number; g: number; w: number; d: number; l: number; premium: boolean; limit: number | null; used: number; hist: { id: string; t: number; opp: string; oe: number; c: 'w' | 'b'; r: 'w' | 'd' | 'l'; d: number }[] }
export interface Stats { online: number; searching: number; playing: number; players?: { n: string; e: number; s: 0 | 1 | 2 }[]; games?: { w: string; b: string; we: number; be: number; tc: string }[]; searchTc?: Record<string, number> }
export interface GameState {
  t: 'state'; id: string; tc: string; inc: number; players: { w: { n: string; e: number }; b: { n: string; e: number } }; fen: string; moves: string[]; last: { from: string; to: string } | null;
  clocks: { w: number; b: number }; turn: 'w' | 'b'; running: boolean; ts: number; lastTs: number; status: 'active' | 'ended'; result: 'w' | 'b' | 'd' | 'x' | null; reason: string | null;
  offer: 'w' | 'b' | null; delta: { w: number; b: number; we: number; be: number } | null; online: { w: boolean; b: boolean }; err?: string;
}
const post = async (path: string, body: object = {}) => {
  try { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); return { ...j, ok: !!j.ok && r.ok, error: j.error || (r.ok ? undefined : 'error') }; }
  catch { return { ok: false, error: 'network' } as any; }
};
/** Pide una entrada firmada (vale 2 minutos) y tu perfil. Con `nick` también cambia tu apodo. */
export const getTicket = (nick?: string): Promise<{ ok: boolean; error?: string; ticket?: string; profile?: Profile }> => post('/api/online/ticket', nick ? { nick } : {});
export const report = (game: string, reason: string) => post('/api/online/report', { game, reason });
export const gamePgn = (game: string): Promise<{ ok: boolean; pgn?: string }> => post('/api/online/pgn', { game });
export async function fetchStats(): Promise<Stats | null> { try { const r = await fetch('/api/online/stats'); return r.ok ? await r.json() : null; } catch { return null; } }
export async function fetchBoard(): Promise<{ n: string; e: number; g: number }[]> { try { const r = await fetch('/api/online/leaderboard', { cache: 'no-cache' }); return r.ok ? (await r.json()).top : []; } catch { return []; } }

const wsUrl = (path: string) => location.origin.replace(/^http/, 'ws') + path;
export interface Conn { send(o: object): void; close(): void }
/** Conexión con reconexión automática (pide una entrada nueva cada vez). */
function connect(path: (ticket: string) => string, onMsg: (m: any) => void, onStatus: (up: boolean) => void): Conn {
  let ws: WebSocket | null = null; let closed = false; let tries = 0; let timer: number | undefined; let hb: number | undefined;
  const open = async () => {
    if (closed) return;
    const t = await getTicket();
    if (closed) return;
    if (!t.ok || !t.ticket) { if (t.error === 'no_session' || t.error === 'email_not_verified') { onMsg({ t: 'fatal', e: t.error }); return; } retry(); return; }
    try { ws = new WebSocket(wsUrl(path(t.ticket))); } catch { retry(); return; }
    ws.onopen = () => { tries = 0; onStatus(true); hb = window.setInterval(() => ws && ws.readyState === 1 && ws.send('{"t":"ping"}'), 25000); };
    ws.onmessage = (ev) => { try { onMsg(JSON.parse(ev.data)); } catch {} };
    ws.onclose = (ev) => { clearInterval(hb); onStatus(false); if (ev.code === 4000) { onMsg({ t: 'fatal', e: 'replaced' }); return; } retry(); };
    ws.onerror = () => {};
  };
  const retry = () => { if (closed) return; clearTimeout(timer); timer = window.setTimeout(open, Math.min(8000, 800 * 2 ** tries++)); };
  open();
  return { send: (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }, close: () => { closed = true; clearTimeout(timer); clearInterval(hb); try { ws && ws.close(); } catch {} } };
}
export const connectLobby = (onMsg: (m: any) => void, onStatus: (up: boolean) => void) => connect((t) => '/api/online/ws?ticket=' + encodeURIComponent(t), onMsg, onStatus);
export const connectGame = (id: string, onMsg: (m: any) => void, onStatus: (up: boolean) => void) => connect((t) => '/api/online/game?id=' + id + '&ticket=' + encodeURIComponent(t), onMsg, onStatus);

/** Milisegundos que le quedan a cada bando ahora mismo (el servidor manda el reloj del momento de la última jugada). */
export function liveClocks(s: GameState, recvAt: number): { w: number; b: number } {
  const c = { ...s.clocks };
  if (s.status === 'active' && s.running) c[s.turn] = Math.max(0, c[s.turn] - (s.ts - s.lastTs) - (performance.now() - recvAt));
  return c;
}
export const fmtClock = (ms: number) => { const t = Math.max(0, Math.ceil(ms / 1000)); const m = Math.floor(t / 60); const sec = t % 60; return ms < 10000 && ms > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; };
