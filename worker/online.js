// Duelos en línea: sala común (Lobby) y una sala por partida (GameRoom). Mismo protocolo WebSocket para web, iOS y Android.
// Todo lo que importa (jugadas legales, relojes, resultado y Elo) lo decide el servidor; los clientes solo pintan y envían intenciones.
import { Chess } from 'chess.js';

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const randHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

export const TCS = { '1+0': [60, 0], '3+0': [180, 0], '3+2': [180, 2], '5+0': [300, 0], '10+0': [600, 0], '15+10': [900, 10] };
export const START_ELO = 1200;
export const QUICK = ['¡Buena suerte!', 'Buena partida', '¡Gracias!', 'Bien jugado', 'Tengo que irme', '¡Revancha!']; // sin chat libre: así no hay insultos ni spam
const NICK_RE = /^[A-Za-z0-9ñÑ_.-]{3,16}$/;
export const validNick = (n) => typeof n === 'string' && NICK_RE.test(n) && !/^(admin|moderador|soporte|nextgranmaestro)/i.test(n);

// ---- Elo
export function eloDelta(ra, rb, score, games) {
  const k = games < 30 ? 40 : 20; const e = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  return Math.round(k * (score - e));
}

// ---- Entradas firmadas de corta duración (las pide la web/app con la sesión y las usa al abrir el WebSocket)
async function hmacKey(env) { return crypto.subtle.importKey('raw', enc.encode(env.TOKEN_SECRET + ':online'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function makeTicket(env, info, ttl = 120) {
  const payload = b64u(enc.encode(JSON.stringify({ ...info, x: Math.floor(Date.now() / 1000) + ttl })));
  return payload + '.' + b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(payload)));
}
export async function readTicket(env, ticket) {
  if (typeof ticket !== 'string' || ticket.length > 800 || !env.TOKEN_SECRET) return null;
  const [p, s] = ticket.split('.'); if (!p || !s) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(s), enc.encode(p)))) return null;
    const d = JSON.parse(new TextDecoder().decode(unb64u(p)));
    return d && d.x > Date.now() / 1000 && typeof d.a === 'string' ? d : null;
  } catch { return null; }
}
const upgrade = (client) => { try { return new Response(null, { status: 101, webSocket: client }); } catch { const r = new Response(null, { status: 200 }); r.ws = client; return r; } }; // el segundo caso solo ocurre en las pruebas con Node
const send = (ws, o) => { try { ws.send(JSON.stringify(o)); } catch {} };
const parse = (m) => { if (typeof m !== 'string' || m.length > 2000) return null; try { const o = JSON.parse(m); return o && typeof o === 'object' ? o : null; } catch { return null; } };
const stub = (ns, name) => ns.get(ns.idFromName(name));
async function accounts(env, op, payload) {
  try { const r = await stub(env.ACCOUNTS, 'accounts').fetch('https://accounts/', { method: 'POST', body: JSON.stringify({ op, ...payload, now: Math.floor(Date.now() / 1000) }) }); return await r.json(); } catch { return { ok: false }; }
}
const GAME_TTL = 3 * 3600 * 1000;

// =====================================================================================
// Sala común: quién está conectado, cola de emparejamiento, ranking y denuncias. Una sola instancia para todos.
// =====================================================================================
export class Lobby {
  constructor(state, env) { this.state = state; this.env = env; }

  socks() { return this.state.getWebSockets().map((ws) => ({ ws, at: ws.deserializeAttachment() })).filter((x) => x.at); }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const t = await readTicket(this.env, url.searchParams.get('ticket'));
      if (!t) return new Response('unauthorized', { status: 401 });
      for (const o of this.socks()) if (o.at.a === t.a) { try { o.ws.close(4000, 'replaced'); } catch {} } // una conexión por cuenta
      const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ a: t.a, n: t.n, e: t.e, g: t.g || 0, p: t.p ? 1 : 0, s: 0, tc: '', at: 0 });
      await this.hello(server);
      return upgrade(client);
    }
    const st = this.state.storage;
    if (url.pathname === '/stats') return json(await this.stats(false));
    if (url.pathname === '/leaderboard') return json({ top: await this.board() });
    const b = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    if (url.pathname === '/game') { // lo llama la sala de partida al empezar y al acabar
      if (b.end) { await st.delete('g:' + b.id); for (const a of b.accs || []) { const ag = await st.get('ag:' + a); if (ag && ag.id === b.id) await st.delete('ag:' + a); } await this.broadcast(); }
      return json({ ok: true });
    }
    if (url.pathname === '/rated') { // actualiza el ranking con los jugadores que acaban de jugar
      const lb = (await st.get('lb')) || {};
      for (const p of b.players || []) lb[p.a] = { n: p.n, e: p.e, g: p.g };
      const ent = Object.entries(lb).sort((x, y) => y[1].e - x[1].e).slice(0, 300); await st.put('lb', Object.fromEntries(ent));
      return json({ ok: true });
    }
    if (url.pathname === '/forget') { const lb = (await st.get('lb')) || {}; delete lb[b.a]; await st.put('lb', lb); await st.delete('ag:' + b.a); return json({ ok: true }); }
    if (url.pathname === '/report') {
      const day = new Date().toISOString().slice(0, 10); const ck = 'rc:' + b.by + ':' + day; const n = (await st.get(ck)) || 0;
      if (n >= 5) return json({ ok: false, error: 'rate_limited' }, 429);
      await st.put(ck, n + 1); await st.put('rep:' + Date.now() + ':' + randHex(3), { by: b.by, game: String(b.game || '').slice(0, 40), reason: String(b.reason || '').slice(0, 200), t: Date.now() });
      return json({ ok: true });
    }
    if (url.pathname === '/reports') return json({ reports: [...(await st.list({ prefix: 'rep:', limit: 100 })).values()] });
    return json({ ok: false }, 404);
  }

  async board() {
    const lb = (await this.state.storage.get('lb')) || {};
    return Object.values(lb).filter((x) => x.g >= 1).sort((a, b) => b.e - a.e).slice(0, 25).map((x) => ({ n: x.n, e: x.e, g: x.g }));
  }

  async activeGames() {
    const now = Date.now(); const all = await this.state.storage.list({ prefix: 'g:' }); const out = [];
    for (const [k, v] of all) { if (now - v.t > GAME_TTL) await this.state.storage.delete(k); else out.push(v); }
    return out;
  }

  async stats(withPlayers) {
    const socks = this.socks(); const games = await this.activeGames();
    const ag = new Set([...(await this.state.storage.list({ prefix: 'ag:' })).keys()].map((k) => k.slice(3)));
    const o = { online: new Set(socks.map((x) => x.at.a)).size, searching: socks.filter((x) => x.at.s === 1).length, playing: games.length * 2 };
    if (withPlayers) {
      o.players = socks.slice(0, 40).map((x) => ({ n: x.at.n, e: x.at.e, s: ag.has(x.at.a) ? 2 : x.at.s })).sort((a, b) => b.e - a.e);
      o.games = games.slice(0, 8).map((g) => ({ w: g.w, b: g.b, we: g.we, be: g.be, tc: g.tc }));
      o.searchTc = {}; for (const x of socks) if (x.at.s === 1) o.searchTc[x.at.tc] = (o.searchTc[x.at.tc] || 0) + 1;
    }
    return o;
  }
  async broadcast() { const s = await this.stats(true); for (const o of this.socks()) send(o.ws, { t: 'stats', ...s }); }

  async hello(ws) {
    const at = ws.deserializeAttachment(); const ag = await this.state.storage.get('ag:' + at.a);
    send(ws, { t: 'hello', you: { n: at.n, e: at.e, p: !!at.p }, tcs: Object.keys(TCS), resume: ag && Date.now() - ag.t < GAME_TTL ? ag.id : null, quick: QUICK });
    await this.broadcast();
  }

  async webSocketMessage(ws, raw) {
    const m = parse(raw); if (!m) return; const at = ws.deserializeAttachment(); if (!at) return;
    if (m.t === 'seek') {
      if (!TCS[m.tc]) return send(ws, { t: 'err', e: 'bad_tc' });
      const ag = await this.state.storage.get('ag:' + at.a);
      if (ag && Date.now() - ag.t < GAME_TTL) return send(ws, { t: 'resume', game: ag.id });
      if (!at.p) { // gratis: límite diario (se cuenta al emparejar, aquí solo se mira)
        const q = await accounts(this.env, 'ocount', { id: at.a, limit: Number(this.env.ONLINE_FREE_PER_DAY) || 5, inc: false });
        if (q.ok === false) return send(ws, { t: 'err', e: 'limit', limit: q.limit, used: q.used });
      }
      at.s = 1; at.tc = m.tc; at.at = Date.now(); ws.serializeAttachment(at);
      send(ws, { t: 'seeking', tc: m.tc }); await this.tryMatch(); await this.broadcast();
    } else if (m.t === 'cancel') { at.s = 0; ws.serializeAttachment(at); send(ws, { t: 'idle' }); await this.broadcast(); }
    else if (m.t === 'ping') send(ws, { t: 'pong' });
    else if (m.t === 'stats') send(ws, { t: 'stats', ...(await this.stats(true)) });
  }
  async webSocketClose() { await this.broadcast(); }
  async webSocketError() { await this.broadcast(); }
  async alarm() { await this.tryMatch(); await this.broadcast(); }

  async tryMatch() {
    const now = Date.now(); const q = this.socks().filter((x) => x.at.s === 1).sort((a, b) => a.at.at - b.at.at); const used = new Set();
    const range = (x) => Math.min(2000, 100 + 25 * Math.floor((now - x.at.at) / 1000));
    for (const A of q) {
      if (used.has(A.at.a)) continue; let best = null;
      for (const B of q) {
        if (B === A || used.has(B.at.a) || B.at.a === A.at.a || B.at.tc !== A.at.tc) continue;
        const diff = Math.abs(A.at.e - B.at.e);
        if (diff <= Math.max(range(A), range(B)) && (!best || diff < best.diff)) best = { B, diff };
      }
      if (best) { used.add(A.at.a); used.add(best.B.at.a); await this.createGame(A, best.B); }
    }
    if (q.some((x) => !used.has(x.at.a))) await this.state.storage.setAlarm(Date.now() + 3000); // sigue buscando y va ampliando el rango de Elo
  }

  async createGame(A, B) {
    const flip = crypto.getRandomValues(new Uint8Array(1))[0] & 1; const W = flip ? A : B; const Bk = flip ? B : A; const id = randHex(8);
    const mk = (x) => ({ a: x.at.a, n: x.at.n, e: x.at.e, g: x.at.g });
    const tc = A.at.tc; const r = await stub(this.env.GAMES, id).fetch('https://game/init', { method: 'POST', body: JSON.stringify({ id, tc, w: mk(W), b: mk(Bk) }) });
    if (!r.ok) return;
    const st = this.state.storage; const t = Date.now();
    await st.put('g:' + id, { t, id, w: W.at.n, b: Bk.at.n, we: W.at.e, be: Bk.at.e, tc });
    for (const x of [W, Bk]) {
      await st.put('ag:' + x.at.a, { id, t });
      if (!x.at.p) await accounts(this.env, 'ocount', { id: x.at.a, limit: 1e9, inc: true });
      x.at.s = 0; x.ws.serializeAttachment(x.at);
      const opp = x === W ? Bk : W;
      send(x.ws, { t: 'match', game: id, color: x === W ? 'w' : 'b', opp: { n: opp.at.n, e: opp.at.e }, tc });
    }
  }
}

// =====================================================================================
// Una partida. Guarda su estado en disco, así sobrevive a desconexiones y reinicios.
// =====================================================================================
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
const FIRST_MOVE_MS = 40000; const DISCONNECT_MS = 60000;
export class GameRoom {
  constructor(state, env) { this.state = state; this.env = env; }

  async load() { return this.state.storage.get('g'); }
  save(g) { return this.state.storage.put('g', g); }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/init') {
      if (await this.load()) return json({ ok: false }, 409);
      const b = await request.json(); const [base, inc] = TCS[b.tc] || [];
      if (!base) return json({ ok: false }, 400);
      const now = Date.now(); const fen = new Chess().fen();
      await this.save({ id: b.id, tc: b.tc, inc, players: { w: b.w, b: b.b }, fen, moves: [], last: null, clocks: { w: base * 1000, b: base * 1000 }, lastTs: now, startedAt: now, turn: 'w', status: 'active', result: null, reason: null, offer: null, offers: { w: 0, b: 0 }, disc: { w: null, b: null }, reps: { [posKey(fen)]: 1 }, say: { w: 0, b: 0 }, delta: null });
      await this.schedule(); return json({ ok: true });
    }
    if (url.pathname === '/ws') {
      const t = await readTicket(this.env, url.searchParams.get('ticket')); const g = await this.load();
      if (!t || !g) return new Response('unauthorized', { status: 401 });
      const color = g.players.w.a === t.a ? 'w' : g.players.b.a === t.a ? 'b' : null; if (!color) return new Response('forbidden', { status: 403 });
      const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server); server.serializeAttachment({ a: t.a, c: color });
      if (g.disc[color]) { g.disc[color] = null; await this.save(g); await this.schedule(); }
      await this.checkTimeouts(); await this.pushState();
      return upgrade(client);
    }
    return json({ ok: false }, 404);
  }

  view(g) {
    return { t: 'state', id: g.id, tc: g.tc, inc: g.inc, players: { w: { n: g.players.w.n, e: g.players.w.e }, b: { n: g.players.b.n, e: g.players.b.e } }, fen: g.fen, moves: g.moves, last: g.last, clocks: g.clocks, turn: g.turn, running: g.moves.length >= 2 && g.status === 'active', ts: Date.now(), lastTs: g.lastTs, status: g.status, result: g.result, reason: g.reason, offer: g.offer, delta: g.delta, online: { w: !g.disc.w, b: !g.disc.b }, startedAt: g.startedAt };
  }
  async pushState() { const g = await this.load(); if (!g) return; const v = this.view(g); for (const ws of this.state.getWebSockets()) send(ws, v); }

  async webSocketMessage(ws, raw) {
    const m = parse(raw); const at = ws.deserializeAttachment(); if (!m || !at) return;
    let g = await this.load(); if (!g) return;
    await this.checkTimeouts(); g = await this.load();
    if (m.t === 'sync') return send(ws, this.view(g));
    if (g.status !== 'active') return send(ws, this.view(g));
    const me = at.c; const opp = me === 'w' ? 'b' : 'w'; const now = Date.now();
    if (m.t === 'move') {
      if (g.turn !== me) return send(ws, { ...this.view(g), t: 'state', err: 'not_your_turn' });
      const chess = new Chess(g.fen); let mv;
      try { mv = chess.move({ from: String(m.from), to: String(m.to), promotion: m.promotion ? String(m.promotion) : undefined }); } catch { mv = null; }
      if (!mv) return send(ws, { ...this.view(g), err: 'illegal' });
      if (g.moves.length >= 2) { g.clocks[me] = Math.max(0, g.clocks[me] - (now - g.lastTs)) + g.inc * 1000; }
      g.moves.push(mv.san); g.fen = chess.fen(); g.last = { from: mv.from, to: mv.to }; g.turn = opp; g.lastTs = now; g.offer = null;
      const k = posKey(g.fen); g.reps[k] = (g.reps[k] || 0) + 1;
      if (chess.isCheckmate()) return this.end(g, me, 'mate');
      if (chess.isStalemate()) return this.end(g, 'd', 'ahogado');
      if (chess.isInsufficientMaterial()) return this.end(g, 'd', 'material');
      if (chess.isDrawByFiftyMoves()) return this.end(g, 'd', '50');
      if (g.reps[k] >= 3) return this.end(g, 'd', 'repeticion');
      await this.save(g); await this.schedule(); return this.pushState();
    }
    if (m.t === 'resign') return this.end(g, opp, 'abandono');
    if (m.t === 'abort') { if (g.moves.length < 2) return this.end(g, null, 'anulada'); return; }
    if (m.t === 'draw') {
      if (g.offer === opp) return this.end(g, 'd', 'acuerdo');
      if (g.offer === null && g.offers[me] < 3 && g.moves.length >= 2) { g.offer = me; g.offers[me]++; await this.save(g); return this.pushState(); }
      return;
    }
    if (m.t === 'nodraw') { if (g.offer === opp) { g.offer = null; await this.save(g); return this.pushState(); } return; }
    if (m.t === 'say') {
      const k = Number(m.k); if (!Number.isInteger(k) || k < 0 || k >= QUICK.length || now - (g.say[me] || 0) < 3000) return;
      g.say[me] = now; await this.save(g);
      for (const s of this.state.getWebSockets()) send(s, { t: 'say', c: me, k });
    }
  }

  async webSocketClose(ws) {
    const at = ws.deserializeAttachment(); const g = await this.load(); if (!at || !g || g.status !== 'active') return;
    const still = this.state.getWebSockets().some((s) => s !== ws && (s.deserializeAttachment() || {}).a === at.a);
    if (!still) { g.disc[at.c] = Date.now(); await this.save(g); await this.schedule(); await this.pushState(); }
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }

  // Cuándo hay que volver a mirar: caída de bandera, jugador desconectado o primera jugada sin hacer.
  async schedule() {
    const g = await this.load(); if (!g || g.status !== 'active') return;
    const c = [];
    if (g.moves.length >= 2) c.push(g.lastTs + g.clocks[g.turn]); else c.push(g.lastTs + FIRST_MOVE_MS);
    for (const k of ['w', 'b']) if (g.disc[k]) c.push(g.disc[k] + DISCONNECT_MS);
    await this.state.storage.setAlarm(Math.max(Date.now() + 50, Math.min(...c) + 20));
  }
  async alarm() { await this.checkTimeouts(); await this.pushState(); await this.schedule(); }

  async checkTimeouts() {
    const g = await this.load(); if (!g || g.status !== 'active') return; const now = Date.now();
    if (g.moves.length >= 2 && now - g.lastTs >= g.clocks[g.turn]) { g.clocks[g.turn] = 0; return this.end(g, g.turn === 'w' ? 'b' : 'w', 'tiempo'); }
    if (g.moves.length < 2 && now - g.lastTs >= FIRST_MOVE_MS) return this.end(g, null, 'anulada');
    for (const k of ['w', 'b']) if (g.disc[k] && now - g.disc[k] >= DISCONNECT_MS) return g.moves.length >= 2 ? this.end(g, k === 'w' ? 'b' : 'w', 'desconexion') : this.end(g, null, 'anulada');
  }

  async end(g, winner, reason) {
    if (g.status !== 'active') return;
    g.status = 'ended'; g.reason = reason; g.result = winner === null ? null : winner; g.offer = null;
    if (winner === 'w' || winner === 'b' || winner === 'd') g.result = winner; else g.result = 'x'; // x = anulada, no cuenta para el Elo
    const W = g.players.w; const B = g.players.b;
    if (g.result !== 'x') {
      const sw = g.result === 'w' ? 1 : g.result === 'd' ? 0.5 : 0;
      const dw = eloDelta(W.e, B.e, sw, W.g); const db = eloDelta(B.e, W.e, 1 - sw, B.g);
      const pgn = this.pgn(g);
      const rw = await accounts(this.env, 'orate', { id: W.a, delta: dw, res: g.result === 'w' ? 'w' : g.result === 'd' ? 'd' : 'l', game: { id: g.id, opp: B.n, oe: B.e, c: 'w', pgn } });
      const rb = await accounts(this.env, 'orate', { id: B.a, delta: db, res: g.result === 'b' ? 'w' : g.result === 'd' ? 'd' : 'l', game: { id: g.id, opp: W.n, oe: W.e, c: 'b', pgn } });
      g.delta = { w: dw, b: db, we: rw.elo ?? W.e + dw, be: rb.elo ?? B.e + db };
      try { await stub(this.env.LOBBY, 'main').fetch('https://lobby/rated', { method: 'POST', body: JSON.stringify({ players: [{ a: W.a, n: W.n, e: g.delta.we, g: rw.games ?? W.g + 1 }, { a: B.a, n: B.n, e: g.delta.be, g: rb.games ?? B.g + 1 }] }) }); } catch {}
    }
    await this.save(g);
    try { await stub(this.env.LOBBY, 'main').fetch('https://lobby/game', { method: 'POST', body: JSON.stringify({ end: true, id: g.id, accs: [W.a, B.a] }) }); } catch {}
    await this.state.storage.deleteAlarm();
    await this.pushState();
  }

  pgn(g) {
    try {
      const c = new Chess(); for (const s of g.moves) c.move(s);
      c.setHeader('Event', 'Duelo en línea · NextGranMaestro'); c.setHeader('Date', new Date(g.startedAt).toISOString().slice(0, 10).replace(/-/g, '.'));
      c.setHeader('White', g.players.w.n); c.setHeader('Black', g.players.b.n); c.setHeader('WhiteElo', String(g.players.w.e)); c.setHeader('BlackElo', String(g.players.b.e));
      c.setHeader('Result', g.result === 'w' ? '1-0' : g.result === 'b' ? '0-1' : '1/2-1/2'); c.setHeader('TimeControl', g.tc);
      return c.pgn().slice(0, 3500);
    } catch { return ''; }
  }
}
