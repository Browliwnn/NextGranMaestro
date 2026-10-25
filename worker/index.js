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
// Un plan = un dispositivo a la vez: el registro de dispositivos (Durable Object DEVICES, declarado en wrangler.jsonc)
// guarda qué navegador tiene activo cada suscripción. Al activarlo en otro, el anterior deja de ser ilimitado.
// Opcional (variable normal o secreta):
//   STRIPE_WEBHOOK_SECRET  secreto de firma (whsec_...) del webhook de Stripe en /api/stripe-webhook (reembolsos, disputas, bajas al instante)
//   ALERT_WEBHOOK_URL      webhook de un canal de Discord (https://discord.com/api/webhooks/...) para recibir avisos de ventas, fallos y reembolsos
//   RESEND_API_KEY y MAIL_FROM  para «recuperar plan por email» (resend.com; MAIL_FROM = «NextGranMaestro <no-reply@tudominio.com>», dominio verificado en Resend)
// Cuentas (opcionales): registro e inicio de sesión con email y contraseña. El Durable Object ACCOUNTS (AccountStore, declarado en
// wrangler.jsonc) guarda las cuentas (contraseña con PBKDF2-SHA256), las sesiones (cookie HttpOnly), el progreso sincronizado y la
// suscripción vinculada. La cuenta nunca se necesita para usar el analizador; sí para comprar (se exige en la web).
//   PRICE_MONTHLY y PRICE_YEARLY  (opcional) ids de precio de Stripe (price_...) para crear el pago desde la propia web con /api/checkout: así comprar exige cuenta
//   REQUIRE_ACCOUNT=1   (opcional) solo activa planes pagados desde una cuenta; los pagos hechos con un Payment Link antiguo se rechazan
//   ALLOWED_PRICE_IDS   ids de precio de Stripe permitidos, separados por comas (price_...). Si lo pones, solo esos
//                       precios dan acceso al plan ilimitado (útil si vendes más cosas con la misma cuenta de Stripe).

const enc = new TextEncoder();
const ACTIVE = new Set(['active', 'trialing']);
const TOKEN_DAYS = 400;
const SUB_RE = /^sub_[A-Za-z0-9]{6,100}$/;
const SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
const DEVICE_RE = /^[a-f0-9]{32}$/;
const MOVE_COOLDOWN = 24 * 3600; // segundos mínimos entre cambios de dispositivo con el código (anti-robo)

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

// ---- Registro de dispositivos (un Durable Object con almacenamiento propio; coherencia fuerte)
import { makeTicket, validNick, START_ELO } from './online.js';
export { Lobby, GameRoom } from './online.js';

export class DeviceRegistry {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const { op, sub, device, now } = await request.json();
    const st = this.state.storage;
    const reply = (o) => new Response(JSON.stringify(o));
    if (op === 'revoke') { await st.put('rev:' + sub, now); return reply({ ok: true }); } // baja, reembolso o disputa (webhook de Stripe)
    if (op === 'unrevoke') { await st.delete('rev:' + sub); return reply({ ok: true }); } // se ha vuelto a pagar
    if (op === 'peek') return reply({ revoked: !!(await st.get('rev:' + sub)) });
    if (op === 'throttle') { const last = await st.get('thr:' + sub); if (last && now - last < 600) return reply({ ok: false }); await st.put('thr:' + sub, now); return reply({ ok: true }); } // 1 correo cada 10 min por email
    if (await st.get('rev:' + sub)) return reply({ ok: false, revoked: true });
    const rec = await st.get(sub); // { d: dispositivo activo, t: instante del último traspaso (0 = ninguno) }
    const put = async (t) => { await st.put(sub, { d: device, t }); return { ok: true }; };
    let out;
    if (op === 'bind') out = await put(0); // tras un pago verificado: este dispositivo pasa a ser el activo, sin espera
    else if (!rec) out = await put(0); // plan anterior a esta función: se queda con el primer dispositivo que lo comprueba
    else if (rec.d === device) out = { ok: true };
    else if (op === 'claim') out = !rec.t || now - rec.t >= MOVE_COOLDOWN ? await put(now) : { ok: false, wait: MOVE_COOLDOWN - (now - rec.t) };
    else out = { ok: false };
    return reply(out);
  }
}
// Devuelve {ok, wait?} o null si el registro no está disponible. Sin registro configurado no se limita (compatibilidad).
async function registry(env, op, sub, device) {
  if (!env.DEVICES) return { ok: true };
  try {
    const stub = env.DEVICES.get(env.DEVICES.idFromName('registry'));
    const r = await stub.fetch('https://registry/', { method: 'POST', body: JSON.stringify({ op, sub, device, now: Math.floor(Date.now() / 1000) }) });
    return await r.json();
  } catch { return null; }
}
const deviceOf = (env, body) => (!env.DEVICES ? '' : body && typeof body.device === 'string' && DEVICE_RE.test(body.device) ? body.device : null);

// ---- Límite de peticiones (por IP, en memoria de cada instancia). Complementa, no sustituye, una regla WAF de Cloudflare.
const hits = new Map();
const LIMIT = 40; // peticiones por minuto y por IP
function rateLimited(ip, mult = 1) {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const h = hits.get(ip);
  if (!h || now - h.t > 60000) { hits.set(ip, { t: now, n: 1 }); return false; }
  h.n++;
  return h.n > LIMIT * mult;
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
// Tipo de plan según el intervalo de cobro de Stripe (solo para mostrarlo al usuario)
function planOf(sub) {
  const it = (sub.items && sub.items.data && sub.items.data[0]) || {};
  const iv = (it.price && it.price.recurring && it.price.recurring.interval) || (it.plan && it.plan.interval) || '';
  return iv === 'year' ? 'yearly' : iv === 'month' ? 'monthly' : 'unlimited';
}
async function readBody(request, max = 2000) {
  try {
    const text = await request.text();
    if (text.length > max) return null;
    return JSON.parse(text);
  } catch { return null; }
}

async function activate(request, env, ctx) {
  const body = await readBody(request);
  const id = body && body.session_id;
  if (typeof id !== 'string' || !SESSION_RE.test(id)) return json({ ok: false, error: 'invalid_session' }, 400);
  const device = deviceOf(env, body);
  if (device === null) return json({ ok: false, error: 'invalid_device' }, 400);
  const s = await stripeGet(env, '/checkout/sessions/' + id);
  if (!s.data) {
    if (s.status !== 404) alert(env, ctx, '⚠️ /api/activate: Stripe no responde (código ' + s.status + '). Un cliente puede haber pagado sin activarse.');
    return json({ ok: false, error: s.status === 404 ? 'session_not_found' : 'stripe_unavailable' }, s.status === 404 ? 404 : 503);
  }
  const session = s.data;
  const sess0 = sessionOf(request); let acct0 = null;
  if (sess0) { const m = await accounts(env, 'me', { session: sess0 }); if (m.ok) acct0 = m.user; }
  if (String(env.REQUIRE_ACCOUNT) === '1' && !(acct0 && typeof session.client_reference_id === 'string' && session.client_reference_id === acct0.id)) return json({ ok: false, error: 'account_required' }, 403);
  if (session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status)) return json({ ok: false, error: 'not_paid' }, 402);
  if (session.mode !== 'subscription' || typeof session.subscription !== 'string' || !SUB_RE.test(session.subscription)) return json({ ok: false, error: 'not_subscription' }, 400);
  const u = await stripeGet(env, '/subscriptions/' + session.subscription);
  if (!u.data) return json({ ok: false, error: 'stripe_unavailable' }, 503);
  if (!ACTIVE.has(u.data.status) || !priceAllowed(env, u.data)) return json({ ok: false, error: 'subscription_inactive' }, 402);
  const reg = await registry(env, 'bind', u.data.id, device);
  if (!reg) { alert(env, ctx, '⚠️ /api/activate: el registro de dispositivos no responde.'); return json({ ok: false, error: 'registry_unavailable' }, 503); }
  if (reg.revoked) return json({ ok: false, error: 'subscription_inactive' }, 402);
  let linked = false;
  if (acct0 && !needsVerify(env, acct0)) { const l = await accounts(env, 'link', { session: sess0, sub: u.data.id }); linked = !!l.ok; } // si has iniciado sesión, el plan queda en tu cuenta
  return json({ ok: true, plan: planOf(u.data), token: await makeToken(env, u.data.id), linked });
}

async function status(request, env) {
  const body = await readBody(request);
  const data = await readToken(env, body && body.token);
  if (!data) return json({ active: false, error: 'invalid_token' }, 401);
  const device = deviceOf(env, body);
  if (device === null) return json({ active: false, error: 'invalid_device' }, 400);
  const u = await stripeGet(env, '/subscriptions/' + data.sub);
  if (!u.data) return json({ error: 'stripe_unavailable' }, 503); // un fallo temporal NO desactiva el plan
  if (!(ACTIVE.has(u.data.status) && priceAllowed(env, u.data))) return json({ active: false });
  const reg = await registry(env, 'check', data.sub, device);
  if (!reg) return json({ error: 'registry_unavailable' }, 503); // tampoco desactiva
  if (reg.revoked) return json({ active: false, error: 'revoked' });
  if (!reg.ok) return json({ active: false, error: 'other_device' }, 409);
  return json({ active: true, plan: planOf(u.data) });
}

// Mover el plan a este dispositivo con el código (página /cuenta). Máximo un cambio cada 24 h.
async function transfer(request, env) {
  const body = await readBody(request);
  const data = await readToken(env, body && body.token);
  if (!data) return json({ active: false, error: 'invalid_token' }, 401);
  const device = deviceOf(env, body);
  if (device === null) return json({ active: false, error: 'invalid_device' }, 400);
  const u = await stripeGet(env, '/subscriptions/' + data.sub);
  if (!u.data) return json({ error: 'stripe_unavailable' }, 503);
  if (!(ACTIVE.has(u.data.status) && priceAllowed(env, u.data))) return json({ active: false });
  const reg = await registry(env, 'claim', data.sub, device);
  if (!reg) return json({ error: 'registry_unavailable' }, 503);
  if (reg.revoked) return json({ active: false });
  if (!reg.ok) return json({ active: false, error: 'too_soon', wait: reg.wait }, 429, { 'retry-after': String(reg.wait || 3600) });
  return json({ active: true, plan: planOf(u.data) });
}


// ---- Avisos al propietario (canal de Discord). Solo se aceptan webhooks de discord.com.
let lastAlert = 0;
function alert(env, ctx, text, force = false) {
  try {
    const u = env.ALERT_WEBHOOK_URL && new URL(String(env.ALERT_WEBHOOK_URL));
    if (!u || u.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(u.hostname)) return;
    if (!force && Date.now() - lastAlert < 600000) return; // los avisos de fallo técnico, como mucho uno cada 10 min
    lastAlert = Date.now();
    const p = fetch(u.toString(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text.slice(0, 1900) }) }).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(p);
  } catch {}
}

// ---- Webhook de Stripe: bajas, reembolsos y disputas surten efecto al instante (sin esperar a la siguiente comprobación)
async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function verifyStripeSignature(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i).trim(), kv.slice(i + 1)]; }));
  const t = Number(parts.t); if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = await hmacHex(secret, t + '.' + raw);
  return header.split(',').map((kv) => kv.trim()).filter((kv) => kv.startsWith('v1=')).some((kv) => safeEqual(kv.slice(3), expected));
}
const subOfInvoice = (inv) => (inv && (typeof inv.subscription === 'string' ? inv.subscription : inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription)) || null;
async function webhook(request, env, ctx) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'webhook_not_configured' }, 503);
  const raw = await request.text();
  if (raw.length > 1000000) return json({ error: 'too_large' }, 413);
  if (!(await verifyStripeSignature(raw, request.headers.get('stripe-signature'), String(env.STRIPE_WEBHOOK_SECRET)))) return json({ error: 'bad_signature' }, 400);
  let ev; try { ev = JSON.parse(raw); } catch { return json({ error: 'bad_json' }, 400); }
  const o = (ev.data && ev.data.object) || {};
  const revoke = (sub, why) => { if (typeof sub === 'string' && SUB_RE.test(sub)) return registry(env, 'revoke', sub, ''); return null; };
  try {
    switch (ev.type) {
      case 'checkout.session.completed':
        alert(env, ctx, '🎉 Nueva suscripción: ' + ((o.amount_total || 0) / 100).toFixed(2) + ' ' + String(o.currency || '').toUpperCase() + (String(ev.id).includes('test') || o.livemode === false ? ' (prueba)' : ''), true); break;
      case 'customer.subscription.deleted':
        await revoke(o.id); alert(env, ctx, '📉 Suscripción cancelada: ' + o.id, true); break;
      case 'customer.subscription.updated':
        if (['canceled', 'unpaid', 'incomplete_expired'].includes(o.status)) await revoke(o.id); break;
      case 'invoice.paid': {
        const sub = subOfInvoice(o);
        if (sub && o.amount_paid > 0) await registry(env, 'unrevoke', sub, ''); break; }
      case 'invoice.payment_failed':
        alert(env, ctx, '⚠️ Pago fallido de una suscripción (' + (subOfInvoice(o) || 'sin id') + '). Stripe reintentará el cobro.', true); break;
      case 'charge.refunded': case 'charge.dispute.created': {
        let invId = o.invoice;
        if (ev.type === 'charge.dispute.created' && !invId && typeof o.charge === 'string') { const c = await stripeGet(env, '/charges/' + o.charge); invId = c.data && c.data.invoice; }
        if (ev.type === 'charge.dispute.created' || o.refunded === true) {
          let sub = null;
          if (typeof invId === 'string') { const inv = await stripeGet(env, '/invoices/' + invId); sub = subOfInvoice(inv.data); }
          if (sub) await revoke(sub);
          alert(env, ctx, (ev.type === 'charge.refunded' ? '💸 Reembolso completo' : '🚨 Disputa abierta') + (sub ? ': plan ' + sub + ' desactivado.' : '.'), true);
        }
        break; }
      default: break;
    }
  } catch { return json({ error: 'handler_failed' }, 500); } // Stripe reintentará
  return json({ received: true });
}

// ---- Recuperar el plan por email: se envía el código al correo con el que se pagó (no se revela si el email existe)
const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[A-Za-z]{2,24}$/;
const mailHits = new Map();
async function sha256Hex(t) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function sendRecoveryMail(env, email) {
  const variants = [...new Set([email, email.toLowerCase()])];
  const subs = new Map();
  for (const v of variants) {
    const c = await stripeGet(env, '/customers?limit=10&email=' + encodeURIComponent(v));
    for (const cu of (c.data && c.data.data) || []) {
      const l = await stripeGet(env, '/subscriptions?limit=10&customer=' + encodeURIComponent(cu.id));
      for (const sb of (l.data && l.data.data) || []) if (ACTIVE.has(sb.status) && priceAllowed(env, sb)) subs.set(sb.id, sb);
    }
  }
  const codes = [];
  for (const sb of subs.values()) {
    const p = await registry(env, 'peek', sb.id, '');
    if (p && p.revoked) continue;
    codes.push({ plan: planOf(sb), code: await makeToken(env, sb.id) });
  }
  if (!codes.length) return;
  const label = { monthly: 'mensual', yearly: 'anual', unlimited: 'ilimitado' };
  const text = 'Hola,\n\nHas pedido recuperar tu plan de NextGranMaestro.\n\n' + codes.map((c) => 'Plan ' + label[c.plan] + ' — tu código:\n' + c.code + '\n').join('\n') +
    '\nCómo usarlo: abre la web en el dispositivo donde quieras tener el plan, entra en «Traspasar plan», pega el código en «Recibir el plan en este dispositivo» y pulsa el botón.\n\n' +
    'No compartas este código con nadie: quien lo tenga puede quedarse con tu plan. Si no lo has pedido tú, ignora este mensaje.\n';
  await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject: 'Tu código de NextGranMaestro', text }) });
}
async function recover(request, env, ctx, ip) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return json({ ok: false, error: 'recovery_not_configured' }, 503);
  const now = Date.now(); const h = mailHits.get(ip);
  if (mailHits.size > 2000) mailHits.clear();
  if (h && now - h.t < 3600000 && h.n >= 5) return json({ ok: false, error: 'rate_limited' }, 429, { 'retry-after': '3600' });
  mailHits.set(ip, h && now - h.t < 3600000 ? { t: h.t, n: h.n + 1 } : { t: now, n: 1 });
  const body = await readBody(request);
  const email = body && typeof body.email === 'string' ? body.email.trim() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ ok: false, error: 'invalid_email' }, 400);
  const th = await registry(env, 'throttle', 'mail:' + (await sha256Hex(email.toLowerCase())), '');
  if (th && th.ok === false) return json({ ok: true }); // ya se envió hace poco: misma respuesta
  const job = sendRecoveryMail(env, email).catch(() => alert(env, ctx, '⚠️ Falló el envío del correo de recuperación (Resend o Stripe).'));
  if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
  return json({ ok: true });
}

// ---- Datos que se sincronizan con la cuenta (progreso del entrenamiento y marcas contra bots)
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const clampInt = (v, max) => { v = Math.floor(Number(v)); return Number.isFinite(v) && v > 0 ? Math.min(v, max) : 0; };
function cleanData(d) {
  const out = {};
  if (d && d.train && typeof d.train === 'object') {
    const t = d.train;
    out.train = {
      done: [...new Set((Array.isArray(t.done) ? t.done : []).map((n) => Math.floor(Number(n))).filter((n) => n >= 1 && n <= 5000))].sort((a, b) => a - b).slice(0, 5000),
      day: DAY_RE.test(t.day) ? t.day : '', today: clampInt(t.today, 1000), streak: clampInt(t.streak, 100000), lastDay: DAY_RE.test(t.lastDay) ? t.lastDay : '',
    };
  }
  if (d && d.quota && typeof d.quota === 'object' && DAY_RE.test(d.quota.day)) out.quota = { day: d.quota.day, n: clampInt(d.quota.n, 100000) };
  if (d && d.bots && typeof d.bots === 'object') {
    out.bots = {};
    for (const id of Object.keys(d.bots).slice(0, 40)) {
      if (!/^[a-z0-9]{1,24}$/.test(id)) continue;
      const b = d.bots[id] || {}; out.bots[id] = { w: clampInt(b.w, 100000), d: clampInt(b.d, 100000), l: clampInt(b.l, 100000) };
    }
  }
  return out;
}
export function mergeData(a, b) {
  a = cleanData(a); b = cleanData(b); const out = {};
  if (a.train || b.train) {
    const x = a.train || { done: [], day: '', today: 0, streak: 0, lastDay: '' }; const y = b.train || x;
    const lastDay = x.lastDay >= y.lastDay ? x.lastDay : y.lastDay;
    const streak = Math.max(x.lastDay === lastDay ? x.streak : 0, y.lastDay === lastDay ? y.streak : 0);
    const day = x.day >= y.day ? x.day : y.day;
    const today = Math.max(x.day === day ? x.today : 0, y.day === day ? y.today : 0);
    out.train = { done: [...new Set([...x.done, ...y.done])].sort((m, n) => m - n), day, today, streak, lastDay };
  }
  if (a.quota || b.quota) {
    const x = a.quota || { day: '', n: 0 }, y = b.quota || x; const day = x.day >= y.day ? x.day : y.day;
    out.quota = { day, n: Math.max(x.day === day ? x.n : 0, y.day === day ? y.n : 0) };
  }
  if (a.bots || b.bots) {
    out.bots = {};
    for (const id of new Set([...Object.keys(a.bots || {}), ...Object.keys(b.bots || {})])) {
      const x = (a.bots || {})[id] || { w: 0, d: 0, l: 0 }, y = (b.bots || {})[id] || { w: 0, d: 0, l: 0 };
      out.bots[id] = { w: Math.max(x.w, y.w), d: Math.max(x.d, y.d), l: Math.max(x.l, y.l) };
    }
  }
  return out;
}

// ---- Cuentas (Durable Object). El hash de contraseñas se hace aquí dentro (PBKDF2 nativo, 100 000 iteraciones).
const EMAIL_OK = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[A-Za-z]{2,24}$/;
const SESSION_DAYS = 30; const MAX_SESSIONS = 8; const LOGIN_MAX_FAILS = 8; const LOGIN_WINDOW = 900;
const randHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const randB64 = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(t) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function pbkdf2(password, saltB64, iters) {
  const salt = Uint8Array.from(atob(saltB64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, key, 256));
}
const ITERS = 100000;
export class AccountStore {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const r = await request.json(); const st = this.state.storage; const now = r.now || Math.floor(Date.now() / 1000);
    const reply = (o) => new Response(JSON.stringify(o));
    const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
    const view = (a) => ({ id: a.id, email: a.email, linked: !!a.sub, verified: !!a.verified, data: a.data || {} });
    const newVerify = async (ek) => { const tok = randB64(32); await st.put('vf:' + (await sha256(tok)), { ek, exp: now + 86400 }); return tok; };
    const newSession = async (a, ek) => {
      const tok = randB64(32); const h = await sha256(tok);
      await st.put('s:' + h, { ek, exp: now + SESSION_DAYS * 86400 });
      a.ss = [...(a.ss || []), h];
      while (a.ss.length > MAX_SESSIONS) await st.delete('s:' + a.ss.shift());
      return tok;
    };
    const sessionAcct = async () => {
      if (typeof r.session !== 'string' || r.session.length > 100) return null;
      const h = await sha256(r.session); const sess = await st.get('s:' + h);
      if (!sess) return null;
      if (sess.exp < now) { await st.delete('s:' + h); return null; }
      const a = await st.get('a:' + sess.ek); if (!a) return null;
      if (!(await st.get('i:' + a.id))) await st.put('i:' + a.id, sess.ek);
      return { a, ek: sess.ek, h };
    };
    const wipeSessions = async (a) => { for (const h of a.ss || []) await st.delete('s:' + h); a.ss = []; };

    if (r.op === 'register') {
      if (!EMAIL_OK.test(email) || email.length > 254) return reply({ err: 'invalid_email' });
      if (typeof r.password !== 'string' || r.password.length < 8 || r.password.length > 128) return reply({ err: 'weak_password' });
      const ek = await sha256(email);
      if (await st.get('a:' + ek)) return reply({ err: 'exists' });
      const salt = randB64(16);
      const a = { id: 'acc' + randHex(10), email, salt, hash: await pbkdf2(r.password, salt, ITERS), iters: ITERS, created: now, sub: null, data: {}, ss: [], f: { n: 0, t: 0 }, verified: false, vr: now };
      const session = await newSession(a, ek); const vtoken = await newVerify(ek); await st.put('a:' + ek, a); await st.put('i:' + a.id, ek);
      return reply({ ok: true, session, user: view(a), vtoken });
    }
    if (r.op === 'login') {
      const ek = await sha256(email); const a = await st.get('a:' + ek);
      if (!a || typeof r.password !== 'string' || r.password.length > 128) { await pbkdf2(String(r.password || '').slice(0, 128), 'AAAAAAAAAAAAAAAAAAAAAA', ITERS); return reply({ err: 'bad_credentials' }); }
      if (a.f && a.f.n >= LOGIN_MAX_FAILS && now - a.f.t < LOGIN_WINDOW) return reply({ err: 'locked', wait: LOGIN_WINDOW - (now - a.f.t) });
      const h = await pbkdf2(r.password, a.salt, a.iters || ITERS);
      if (!safeEqual(h, a.hash)) { a.f = { n: (a.f && now - a.f.t < LOGIN_WINDOW ? a.f.n : 0) + 1, t: now }; await st.put('a:' + ek, a); return reply({ err: 'bad_credentials' }); }
      a.f = { n: 0, t: 0 };
      const session = await newSession(a, ek); await st.put('a:' + ek, a);
      return reply({ ok: true, session, user: view(a) });
    }
    if (r.op === 'logout') { const s = await sessionAcct(); if (s) { await st.delete('s:' + s.h); s.a.ss = (s.a.ss || []).filter((x) => x !== s.h); await st.put('a:' + s.ek, s.a); } return reply({ ok: true }); }
    if (r.op === 'me') { const s = await sessionAcct(); return reply(s ? { ok: true, user: view(s.a) } : { ok: false }); }
    if (r.op === 'sync') {
      const s = await sessionAcct(); if (!s) return reply({ ok: false });
      s.a.data = mergeData(s.a.data || {}, r.data || {}); await st.put('a:' + s.ek, s.a);
      return reply({ ok: true, data: s.a.data });
    }
    if (r.op === 'link') {
      const s = await sessionAcct(); if (!s) return reply({ ok: false, err: 'no_session' });
      const other = await st.get('u:' + r.sub);
      if (other && other !== s.ek) return reply({ ok: false, err: 'already_linked' });
      if (s.a.sub && s.a.sub !== r.sub) await st.delete('u:' + s.a.sub);
      s.a.sub = r.sub; await st.put('u:' + r.sub, s.ek); await st.put('a:' + s.ek, s.a);
      return reply({ ok: true });
    }
    if (r.op === 'verifysend') {
      const s = await sessionAcct(); if (!s) return reply({ ok: false, err: 'no_session' });
      if (s.a.verified) return reply({ ok: true, already: true });
      if (s.a.vr && now - s.a.vr < 600) return reply({ ok: false, err: 'rate_limited' });
      s.a.vr = now; await st.put('a:' + s.ek, s.a);
      return reply({ ok: true, token: await newVerify(s.ek), email: s.a.email });
    }
    if (r.op === 'verify') {
      if (typeof r.token !== 'string' || r.token.length > 100) return reply({ ok: false, err: 'invalid_token' });
      const h = await sha256(r.token); const v = await st.get('vf:' + h);
      if (!v || v.exp < now) { if (v) await st.delete('vf:' + h); return reply({ ok: false, err: 'invalid_token' }); }
      const a = await st.get('a:' + v.ek); await st.delete('vf:' + h); if (!a) return reply({ ok: false, err: 'invalid_token' });
      a.verified = true; await st.put('a:' + v.ek, a); return reply({ ok: true });
    }
    // ---- Duelos en línea: apodo, Elo, historial y cupo diario (el Elo solo lo cambia el servidor al acabar una partida)
    const og = (a) => a.og || (a.og = { e: START_ELO, g: 0, w: 0, d: 0, l: 0, h: [], q: { day: '', n: 0 } });
    const nickOf = (a) => a.nick || 'Jugador' + a.id.slice(3, 7);
    if (r.op === 'oprofile') {
      const s = await sessionAcct(); if (!s) return reply({ ok: false, err: 'no_session' });
      if (r.nick !== undefined && r.nick !== null && r.nick !== '') { if (!validNick(r.nick)) return reply({ ok: false, err: 'invalid_nick' }); s.a.nick = r.nick; }
      const o = og(s.a); await st.put('a:' + s.ek, s.a);
      const day = new Date(now * 1000).toISOString().slice(0, 10);
      return reply({ ok: true, id: s.a.id, nick: nickOf(s.a), elo: o.e, games: o.g, w: o.w, d: o.d, l: o.l, hist: o.h.slice(0, 15).map((x) => ({ id: x.id, t: x.t, opp: x.opp, oe: x.oe, c: x.c, r: x.r, d: x.d })), verified: !!s.a.verified, sub: s.a.sub || null, used: o.q.day === day ? o.q.n : 0 });
    }
    if (r.op === 'ocount') { // r.inc=false: solo mira si queda cupo; inc=true: cuenta una partida
      const ek = await st.get('i:' + r.id); const a = ek && await st.get('a:' + ek); if (!a) return reply({ ok: false, err: 'no_account' });
      const o = og(a); const day = new Date(now * 1000).toISOString().slice(0, 10); if (o.q.day !== day) o.q = { day, n: 0 };
      if (!r.inc) return reply(o.q.n >= r.limit ? { ok: false, limit: r.limit, used: o.q.n } : { ok: true, used: o.q.n });
      o.q.n++; await st.put('a:' + ek, a); return reply({ ok: true, used: o.q.n });
    }
    if (r.op === 'orate') {
      const ek = await st.get('i:' + r.id); const a = ek && await st.get('a:' + ek); if (!a) return reply({ ok: false, err: 'no_account' });
      const o = og(a); if (o.h.some((x) => x.id === r.game.id)) return reply({ ok: true, elo: o.e, games: o.g }); // ya contada
      o.e = Math.max(100, o.e + Math.trunc(r.delta)); o.g++; o[r.res]++;
      o.h.unshift({ id: String(r.game.id).slice(0, 20), t: now, opp: String(r.game.opp).slice(0, 20), oe: r.game.oe, c: r.game.c, r: r.res, d: Math.trunc(r.delta), pgn: String(r.game.pgn || '').slice(0, 3500) }); o.h = o.h.slice(0, 15);
      await st.put('a:' + ek, a); return reply({ ok: true, elo: o.e, games: o.g });
    }
    if (r.op === 'opgn') {
      const s = await sessionAcct(); if (!s) return reply({ ok: false, err: 'no_session' });
      const x = og(s.a).h.find((h) => h.id === r.game); return reply(x ? { ok: true, pgn: x.pgn || '' } : { ok: false });
    }
    if (r.op === 'plan') { const s = await sessionAcct(); return reply(s ? { ok: true, sub: s.a.sub || null } : { ok: false }); }
    if (r.op === 'password') {
      const s = await sessionAcct(); if (!s) return reply({ ok: false, err: 'no_session' });
      if (typeof r.password !== 'string' || typeof r.newPassword !== 'string' || r.newPassword.length < 8 || r.newPassword.length > 128) return reply({ ok: false, err: 'weak_password' });
      if (s.a.f && s.a.f.n >= LOGIN_MAX_FAILS && now - s.a.f.t < LOGIN_WINDOW) return reply({ ok: false, err: 'locked' });
      if (!safeEqual(await pbkdf2(r.password, s.a.salt, s.a.iters || ITERS), s.a.hash)) { s.a.f = { n: (s.a.f && now - s.a.f.t < LOGIN_WINDOW ? s.a.f.n : 0) + 1, t: now }; await st.put('a:' + s.ek, s.a); return reply({ ok: false, err: 'bad_credentials' }); }
      s.a.salt = randB64(16); s.a.hash = await pbkdf2(r.newPassword, s.a.salt, ITERS); s.a.iters = ITERS; s.a.f = { n: 0, t: 0 };
      await wipeSessions(s.a); const session = await newSession(s.a, s.ek); await st.put('a:' + s.ek, s.a); // cierra las demás sesiones
      return reply({ ok: true, session });
    }
    if (r.op === 'delete') {
      const s = await sessionAcct(); if (!s) return reply({ ok: false, err: 'no_session' });
      if (s.a.f && s.a.f.n >= LOGIN_MAX_FAILS && now - s.a.f.t < LOGIN_WINDOW) return reply({ ok: false, err: 'locked' });
      if (typeof r.password !== 'string' || !safeEqual(await pbkdf2(r.password.slice(0, 128), s.a.salt, s.a.iters || ITERS), s.a.hash)) { s.a.f = { n: (s.a.f && now - s.a.f.t < LOGIN_WINDOW ? s.a.f.n : 0) + 1, t: now }; await st.put('a:' + s.ek, s.a); return reply({ ok: false, err: 'bad_credentials' }); }
      await wipeSessions(s.a); if (s.a.sub) await st.delete('u:' + s.a.sub); await st.delete('a:' + s.ek); await st.delete('i:' + s.a.id);
      return reply({ ok: true });
    }
    if (r.op === 'forgot') {
      const ek = await sha256(email); const a = await st.get('a:' + ek);
      if (!a || (a.fr && now - a.fr < 600)) return reply({ ok: true }); // sin aviso de si existe o ya se envió
      const tok = randB64(32); await st.put('rs:' + (await sha256(tok)), { ek, exp: now + 3600 }); a.fr = now; await st.put('a:' + ek, a);
      return reply({ ok: true, token: tok, email: a.email });
    }
    if (r.op === 'reset') {
      if (typeof r.token !== 'string' || r.token.length > 100) return reply({ ok: false, err: 'invalid_token' });
      if (typeof r.password !== 'string' || r.password.length < 8 || r.password.length > 128) return reply({ ok: false, err: 'weak_password' });
      const h = await sha256(r.token); const rs = await st.get('rs:' + h);
      if (!rs || rs.exp < now) { if (rs) await st.delete('rs:' + h); return reply({ ok: false, err: 'invalid_token' }); }
      const a = await st.get('a:' + rs.ek); await st.delete('rs:' + h); if (!a) return reply({ ok: false, err: 'invalid_token' });
      a.salt = randB64(16); a.hash = await pbkdf2(r.password, a.salt, ITERS); a.iters = ITERS; a.f = { n: 0, t: 0 }; await wipeSessions(a); await st.put('a:' + rs.ek, a);
      return reply({ ok: true });
    }
    return reply({ ok: false, err: 'bad_op' });
  }
}
async function accounts(env, op, payload) {
  if (!env.ACCOUNTS) return { ok: false, err: 'accounts_unavailable' };
  try {
    const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'));
    const r = await stub.fetch('https://accounts/', { method: 'POST', body: JSON.stringify({ op, ...payload, now: Math.floor(Date.now() / 1000) }) });
    return await r.json();
  } catch { return { ok: false, err: 'accounts_unavailable' }; }
}
const COOKIE = 'ngm_s';
function sessionOf(request) {
  const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([A-Za-z0-9_-]{20,80})').exec(request.headers.get('cookie') || '');
  return m ? m[1] : null;
}
const sessionCookie = (v, maxAge) => COOKIE + '=' + v + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + maxAge;
const authHits = new Map();
function authLimited(ip, kind, max) { // límite por IP y hora para registro y «olvidé mi contraseña»
  const now = Date.now(); const k = kind + ip; const h = authHits.get(k);
  if (authHits.size > 3000) authHits.clear();
  if (!h || now - h.t > 3600000) { authHits.set(k, { t: now, n: 1 }); return false; }
  h.n++; return h.n > max;
}
const ACCOUNT_ERRORS = { invalid_nick: 400, invalid_email: 400, weak_password: 400, exists: 409, bad_credentials: 401, locked: 429, no_session: 401, invalid_token: 400, accounts_unavailable: 503, already_linked: 409 };
const failAcc = (r) => json({ ok: false, error: r.err || 'error', ...(r.wait ? { wait: r.wait } : {}) }, ACCOUNT_ERRORS[r.err] || 400, r.wait ? { 'retry-after': String(r.wait) } : {});

async function sendMail(env, to, subject, text) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }) });
  return r.ok;
}
const mailOn = (env) => !!(env.RESEND_API_KEY && env.MAIL_FROM);
const pub = (env, u) => ({ ...u, verifyRequired: mailOn(env) }); // verifyRequired: el servidor puede enviar correos y por tanto exige email verificado para comprar
const needsVerify = (env, u) => mailOn(env) && !u.verified;
async function sendVerifyMail(env, ctx, url, email, token) {
  const job = sendMail(env, email, 'Confirma tu email en NextGranMaestro', 'Hola,\n\nConfirma tu email abriendo este enlace (vale 24 horas):\n\n' + url.origin + '/entrar?verify=' + token + '\n\nSi no has creado tú la cuenta, ignora este mensaje.\n').catch(() => alert(env, ctx, '⚠️ Falló el envío del correo de verificación (Resend).'));
  if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
}
async function stripePost(env, path, params) {
  try {
    const r = await fetch('https://api.stripe.com/v1' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    return { status: r.status, data: r.ok ? await r.json() : null };
  } catch { return { status: 0, data: null }; }
}
const stub2 = (ns, name) => ns.get(ns.idFromName(name));
async function authRoute(path, request, env, ctx, ip, url) {
  const body = (await readBody(request, path === '/api/account/sync' ? 40000 : 2000)) || {};
  const session = sessionOf(request);
  if (path === '/api/auth/register' || path === '/api/auth/login') {
    if (path.endsWith('register') && authLimited(ip, 'reg', 10)) return json({ ok: false, error: 'rate_limited' }, 429, { 'retry-after': '3600' });
    const r = await accounts(env, path.endsWith('register') ? 'register' : 'login', { email: body.email, password: body.password });
    if (!r.ok) return failAcc(r);
    if (r.vtoken && mailOn(env)) await sendVerifyMail(env, ctx, url, r.user.email, r.vtoken);
    return json({ ok: true, user: pub(env, r.user) }, 200, { 'set-cookie': sessionCookie(r.session, SESSION_DAYS * 86400) });
  }
  if (path === '/api/auth/logout') { if (session) await accounts(env, 'logout', { session }); return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) }); }
  if (path === '/api/auth/me') { if (!session) return json({ ok: true, user: null }); const r = await accounts(env, 'me', { session }); return r.ok ? json({ ok: true, user: pub(env, r.user) }) : json({ ok: true, user: null }, 200, { 'set-cookie': sessionCookie('', 0) }); }
  if (path === '/api/auth/password') { const r = await accounts(env, 'password', { session, password: body.password, newPassword: body.newPassword }); return r.ok ? json({ ok: true }, 200, { 'set-cookie': sessionCookie(r.session, SESSION_DAYS * 86400) }) : failAcc(r); }
  if (path === '/api/auth/delete') { const who = session && env.LOBBY ? await accounts(env, 'me', { session }) : null; const r = await accounts(env, 'delete', { session, password: body.password }); if (r.ok && who && who.ok) { try { await stub2(env.LOBBY, 'main').fetch('https://lobby/forget', { method: 'POST', body: JSON.stringify({ a: who.user.id }) }); } catch {} } return r.ok ? json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) }) : failAcc(r); }
  if (path === '/api/auth/verify') { const r = await accounts(env, 'verify', { token: body.token }); return r.ok ? json({ ok: true }) : failAcc(r); }
  if (path === '/api/auth/resend') {
    if (!mailOn(env)) return json({ ok: false, error: 'mail_not_configured' }, 503);
    const r = await accounts(env, 'verifysend', { session }); if (!r.ok) return r.err === 'rate_limited' ? json({ ok: false, error: 'rate_limited' }, 429) : failAcc(r);
    if (r.token) await sendVerifyMail(env, ctx, url, r.email, r.token);
    return json({ ok: true, already: !!r.already });
  }
  if (path === '/api/checkout') { // crea el pago de Stripe desde la web: solo con sesión iniciada (y email verificado si hay correo configurado)
    if (!session) return json({ ok: false, error: 'no_session' }, 401);
    const me = await accounts(env, 'me', { session }); if (!me.ok) return json({ ok: false, error: 'no_session' }, 401);
    if (needsVerify(env, me.user)) return json({ ok: false, error: 'email_not_verified' }, 403);
    const price = body.plan === 'yearly' ? env.PRICE_YEARLY : body.plan === 'monthly' ? env.PRICE_MONTHLY : null;
    if (!price || !/^price_[A-Za-z0-9]{6,100}$/.test(String(price))) return json({ ok: false, error: body.plan === 'yearly' || body.plan === 'monthly' ? 'checkout_not_configured' : 'invalid_plan' }, body.plan === 'yearly' || body.plan === 'monthly' ? 503 : 400);
    const params = new URLSearchParams({ mode: 'subscription', 'line_items[0][price]': String(price), 'line_items[0][quantity]': '1', success_url: url.origin + '/gracias?session_id={CHECKOUT_SESSION_ID}', cancel_url: url.origin + '/precios', client_reference_id: me.user.id, customer_email: me.user.email, allow_promotion_codes: 'true', locale: 'es' });
    const c = await stripePost(env, '/checkout/sessions', params);
    if (!c.data || typeof c.data.url !== 'string' || !c.data.url.startsWith('https://checkout.stripe.com/')) { alert(env, ctx, '⚠️ No se pudo crear el pago en Stripe (código ' + c.status + '). Revisa los permisos de la clave (Checkout Sessions: escritura) y los PRICE_*.'); return json({ ok: false, error: 'stripe_unavailable' }, 503); }
    return json({ ok: true, url: c.data.url });
  }
  if (path === '/api/online/ticket' || path === '/api/online/report' || path === '/api/online/pgn') {
    if (!session) return json({ ok: false, error: 'no_session' }, 401);
    if (!env.LOBBY || !env.GAMES) return json({ ok: false, error: 'online_unavailable' }, 503);
    if (path === '/api/online/pgn') { const r = await accounts(env, 'opgn', { session, game: String(body.game || '').slice(0, 20) }); return r.ok ? json({ ok: true, pgn: r.pgn }) : json({ ok: false, error: 'not_found' }, 404); }
    const r = await accounts(env, 'oprofile', { session, nick: typeof body.nick === 'string' ? body.nick.trim() : undefined });
    if (!r.ok) return failAcc(r);
    if (mailOn(env) && !r.verified) return json({ ok: false, error: 'email_not_verified' }, 403);
    if (path === '/api/online/report') {
      const lr = await stub2(env.LOBBY, 'main').fetch('https://lobby/report', { method: 'POST', body: JSON.stringify({ by: r.id, game: body.game, reason: body.reason }) });
      if (lr.ok) alert(env, ctx, '🚩 Denuncia en duelos en línea (partida ' + String(body.game || '').slice(0, 20) + '): ' + String(body.reason || '').slice(0, 120));
      return lr.ok ? json({ ok: true }) : json({ ok: false, error: 'rate_limited' }, 429);
    }
    let premium = false;
    if (r.sub) { const u = await stripeGet(env, '/subscriptions/' + r.sub); premium = !!(u.data && ACTIVE.has(u.data.status) && priceAllowed(env, u.data)); }
    const limit = Number(env.ONLINE_FREE_PER_DAY) || 5;
    const ticket = await makeTicket(env, { a: r.id, n: r.nick, e: r.elo, g: r.games, p: premium ? 1 : 0 });
    return json({ ok: true, ticket, profile: { n: r.nick, e: r.elo, g: r.games, w: r.w, d: r.d, l: r.l, hist: r.hist, premium, limit: premium ? null : limit, used: r.used } });
  }
  if (path === '/api/auth/forgot') {
    if (!env.RESEND_API_KEY || !env.MAIL_FROM) return json({ ok: false, error: 'mail_not_configured' }, 503);
    if (authLimited(ip, 'for', 5)) return json({ ok: false, error: 'rate_limited' }, 429, { 'retry-after': '3600' });
    if (typeof body.email !== 'string' || !EMAIL_OK.test(body.email.trim())) return json({ ok: false, error: 'invalid_email' }, 400);
    const r = await accounts(env, 'forgot', { email: body.email });
    if (r.token) {
      const link = url.origin + '/entrar?reset=' + r.token;
      const job = sendMail(env, r.email, 'Restablece tu contraseña de NextGranMaestro', 'Hola,\n\nHas pedido restablecer tu contraseña. Abre este enlace (vale 1 hora):\n\n' + link + '\n\nSi no lo has pedido tú, ignora este mensaje: tu contraseña no cambia.\n').catch(() => alert(env, ctx, '⚠️ Falló el envío del correo de contraseña (Resend).'));
      if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
    }
    return json({ ok: true });
  }
  if (path === '/api/auth/reset') { const r = await accounts(env, 'reset', { token: body.token, password: body.password }); return r.ok ? json({ ok: true }) : failAcc(r); }
  if (path === '/api/account/sync') {
    if (!session) return json({ ok: false, error: 'no_session' }, 401);
    const r = await accounts(env, 'sync', { session, data: body.data }); return r.ok ? json({ ok: true, data: r.data }) : failAcc(r);
  }
  if (path === '/api/account/link') {
    if (!session) return json({ ok: false, error: 'no_session' }, 401);
    const tk = await readToken(env, body.token); if (!tk) return json({ ok: false, error: 'invalid_token' }, 401);
    const u = await stripeGet(env, '/subscriptions/' + tk.sub);
    if (!u.data) return json({ ok: false, error: 'stripe_unavailable' }, 503);
    if (!(ACTIVE.has(u.data.status) && priceAllowed(env, u.data))) return json({ ok: false, error: 'subscription_inactive' }, 402);
    const me = await accounts(env, 'me', { session }); if (me.ok && needsVerify(env, me.user)) return json({ ok: false, error: 'email_not_verified' }, 403);
    const r = await accounts(env, 'link', { session, sub: tk.sub }); return r.ok ? json({ ok: true, plan: planOf(u.data) }) : failAcc(r);
  }
  if (path === '/api/account/plan') { // devuelve un código nuevo de la suscripción vinculada, para activarla en este dispositivo
    if (!session) return json({ ok: false, error: 'no_session' }, 401);
    const r = await accounts(env, 'plan', { session }); if (!r.ok) return failAcc({ err: 'no_session' });
    if (!r.sub) return json({ ok: true, active: false });
    const u = await stripeGet(env, '/subscriptions/' + r.sub);
    if (!u.data) return json({ ok: false, error: 'stripe_unavailable' }, 503);
    if (!(ACTIVE.has(u.data.status) && priceAllowed(env, u.data))) return json({ ok: true, active: false });
    const pk = await registry(env, 'peek', r.sub, ''); if (pk && pk.revoked) return json({ ok: true, active: false });
    return json({ ok: true, active: true, plan: planOf(u.data), token: await makeToken(env, r.sub) });
  }
  return json({ error: 'not_found' }, 404);
}

function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
  const site = request.headers.get('sec-fetch-site');
  return !site || site === 'same-origin' || site === 'none';
}

// Lecturas públicas y conexiones WebSocket del modo en línea (el WebSocket usa una entrada firmada de 2 minutos, no la cookie).
async function onlineGet(request, env, url) {
  if (!env.LOBBY || !env.GAMES || !env.TOKEN_SECRET) return json({ error: 'online_unavailable' }, 503);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (rateLimited('o' + ip, 6)) return json({ error: 'rate_limited' }, 429, { 'retry-after': '60' });
  const lobby = stub2(env.LOBBY, 'main');
  if (url.pathname === '/api/online/stats') { const r = await lobby.fetch('https://lobby/stats'); return new Response(r.body, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=10' } }); }
  if (url.pathname === '/api/online/leaderboard') { const r = await lobby.fetch('https://lobby/leaderboard'); return new Response(r.body, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30' } }); }
  if (url.pathname === '/api/online/ws' || url.pathname === '/api/online/game') {
    if (request.headers.get('upgrade') !== 'websocket') return json({ error: 'expected_websocket' }, 426);
    const origin = request.headers.get('origin'); if (origin && origin !== url.origin) return json({ error: 'forbidden_origin' }, 403);
    const ticket = url.searchParams.get('ticket') || '';
    if (url.pathname === '/api/online/ws') return lobby.fetch(new Request('https://lobby/ws?ticket=' + encodeURIComponent(ticket), request));
    const id = url.searchParams.get('id') || ''; if (!/^[0-9a-f]{16}$/.test(id)) return json({ error: 'invalid_game' }, 400);
    return stub2(env.GAMES, id).fetch(new Request('https://game/ws?ticket=' + encodeURIComponent(ticket), request));
  }
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/stripe-webhook') return webhook(request, env, ctx);

    if (request.method === 'GET' && url.pathname.startsWith('/api/online/')) return onlineGet(request, env, url);

    if (!env.STRIPE_SECRET_KEY || !env.TOKEN_SECRET || String(env.TOKEN_SECRET).length < 32) return json({ error: 'server_not_configured' }, 503);
    if (!['/api/activate', '/api/status', '/api/transfer', '/api/recover', '/api/checkout'].includes(url.pathname) && !/^\/api\/(auth|account|online)\/[a-z]+$/.test(url.pathname)) return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
    if (!sameOrigin(request, url)) return json({ error: 'forbidden_origin' }, 403);
    if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json({ error: 'unsupported_media_type' }, 415);
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const online = url.pathname.startsWith('/api/online/'); // el modo en línea pide más entradas (conexiones, recargas, varios jugadores tras la misma IP)
    if (online ? rateLimited('o' + ip, 6) : rateLimited(ip)) return json({ error: 'rate_limited' }, 429, { 'retry-after': '60' });
    if (env.RATE_LIMITER && !online) { // límite global de Cloudflare (compartido entre instancias); si falla, no bloquea el servicio
      try { const r = await env.RATE_LIMITER.limit({ key: ip }); if (!r.success) return json({ error: 'rate_limited' }, 429, { 'retry-after': '60' }); } catch {}
    }

    if (url.pathname === '/api/recover') return recover(request, env, ctx, ip);
    if (/^\/api\/(auth|account|online)\/[a-z]+$/.test(url.pathname) || url.pathname === '/api/checkout') return authRoute(url.pathname, request, env, ctx, ip, url);
    return url.pathname === '/api/activate' ? activate(request, env, ctx) : url.pathname === '/api/transfer' ? transfer(request, env) : status(request, env);
  },
};
