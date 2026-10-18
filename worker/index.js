// Servidor de NextGranMaestro (Cloudflare Worker). Solo gestiona /api/*; el resto lo sirve la web estática.
//
// Flujo de pago:
//  1) El usuario paga en un Payment Link de Stripe, que lo redirige a /gracias?session_id=cs_...
//  2) /gracias llama a POST /api/activate: verificamos con Stripe (clave secreta, solo aquí) que el pago está completo
//     y que la suscripción está activa, y devolvemos un token firmado (HMAC-SHA256).
//  3) El navegador guarda el token. Cada día el analizador llama a POST /api/status, que vuelve a comprobar en Stripe
//     que la suscripción sigue activa (si cancela o falla el pago, el plan ilimitado se desactiva).
//
// Secretos (Cloudflare → tu proyecto → Settings → Variables and Secrets, tipo "Secret"):
//   STRIPE_SECRET_KEY   clave de Stripe (recomendada: restringida, solo lectura de Checkout Sessions y Subscriptions)
//   TOKEN_SECRET        texto largo y aleatorio inventado por ti (mínimo 32 caracteres)
// Opcional: binding RATE_LIMITER (ya declarado en wrangler.jsonc): límite de peticiones por IP en toda la red de Cloudflare.
// Opcional (variable normal o secreta):
//   ALLOWED_PRICE_IDS   ids de precio de Stripe permitidos, separados por comas (price_...). Si lo pones, solo esos
//                       precios dan acceso al plan ilimitado (útil si vendes más cosas con la misma cuenta de Stripe).

const enc = new TextEncoder();
const ACTIVE = new Set(['active', 'trialing']);
const TOKEN_DAYS = 400;
const SUB_RE = /^sub_[A-Za-z0-9]{6,100}$/;
const SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;

const SECURITY_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000',
};
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...SECURITY_HEADERS, ...extra } });

// ---- Límite de peticiones (por IP, en memoria de cada instancia). Complementa, no sustituye, una regla WAF de Cloudflare.
const hits = new Map();
const LIMIT = 40; // peticiones por minuto y por IP
function rateLimited(ip) {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const h = hits.get(ip);
  if (!h || now - h.t > 60000) { hits.set(ip, { t: now, n: 1 }); return false; }
  h.n++;
  return h.n > LIMIT;
}

// ---- Criptografía
function b64u(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sign(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function makeToken(env, sub) {
  const payload = b64u(enc.encode(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400 })));
  return payload + '.' + (await sign(env.TOKEN_SECRET, payload));
}
async function readToken(env, token) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, sig] = parts;
  if (!safeEqual(sig, await sign(env.TOKEN_SECRET, payload))) return null;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof data.sub !== 'string' || !SUB_RE.test(data.sub) || !data.exp || data.exp < Date.now() / 1000) return null;
    return data;
  } catch { return null; }
}

// ---- Stripe
async function stripeGet(env, path) {
  try {
    const r = await fetch('https://api.stripe.com/v1' + path, { headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } });
    if (!r.ok) return { status: r.status, data: null };
    return { status: 200, data: await r.json() };
  } catch { return { status: 0, data: null }; }
}
function priceAllowed(env, sub) {
  if (!env.ALLOWED_PRICE_IDS) return true;
  const allowed = String(env.ALLOWED_PRICE_IDS).split(',').map((x) => x.trim()).filter(Boolean);
  if (!allowed.length) return true;
  const used = ((sub.items && sub.items.data) || []).map((i) => i.price && i.price.id);
  return used.some((id) => allowed.includes(id));
}
async function readBody(request) {
  try {
    const text = await request.text();
    if (text.length > 2000) return null;
    return JSON.parse(text);
  } catch { return null; }
}

async function activate(request, env) {
  const body = await readBody(request);
  const id = body && body.session_id;
  if (typeof id !== 'string' || !SESSION_RE.test(id)) return json({ ok: false, error: 'invalid_session' }, 400);
  const s = await stripeGet(env, '/checkout/sessions/' + id);
  if (!s.data) return json({ ok: false, error: s.status === 404 ? 'session_not_found' : 'stripe_unavailable' }, s.status === 404 ? 404 : 503);
  const session = s.data;
  if (session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status)) return json({ ok: false, error: 'not_paid' }, 402);
  if (session.mode !== 'subscription' || typeof session.subscription !== 'string' || !SUB_RE.test(session.subscription)) return json({ ok: false, error: 'not_subscription' }, 400);
  const u = await stripeGet(env, '/subscriptions/' + session.subscription);
  if (!u.data) return json({ ok: false, error: 'stripe_unavailable' }, 503);
  if (!ACTIVE.has(u.data.status) || !priceAllowed(env, u.data)) return json({ ok: false, error: 'subscription_inactive' }, 402);
  return json({ ok: true, token: await makeToken(env, u.data.id) });
}

async function status(request, env) {
  const body = await readBody(request);
  const data = await readToken(env, body && body.token);
  if (!data) return json({ active: false, error: 'invalid_token' }, 401);
  const u = await stripeGet(env, '/subscriptions/' + data.sub);
  if (!u.data) return json({ error: 'stripe_unavailable' }, 503); // un fallo temporal NO desactiva el plan
  return json({ active: ACTIVE.has(u.data.status) && priceAllowed(env, u.data) });
}

function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
  const site = request.headers.get('sec-fetch-site');
  return !site || site === 'same-origin' || site === 'none';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (!env.STRIPE_SECRET_KEY || !env.TOKEN_SECRET || String(env.TOKEN_SECRET).length < 32) return json({ error: 'server_not_configured' }, 503);
    if (url.pathname !== '/api/activate' && url.pathname !== '/api/status') return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
    if (!sameOrigin(request, url)) return json({ error: 'forbidden_origin' }, 403);
    if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json({ error: 'unsupported_media_type' }, 415);
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (rateLimited(ip)) return json({ error: 'rate_limited' }, 429, { 'retry-after': '60' });
    if (env.RATE_LIMITER) { // límite global de Cloudflare (compartido entre instancias); si falla, no bloquea el servicio
      try { const r = await env.RATE_LIMITER.limit({ key: ip }); if (!r.success) return json({ error: 'rate_limited' }, 429, { 'retry-after': '60' }); } catch {}
    }

    return url.pathname === '/api/activate' ? activate(request, env) : status(request, env);
  },
};
