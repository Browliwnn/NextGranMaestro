// Crea en TU cuenta de Stripe los productos, precios y enlaces de pago de NextGranMaestro y los pone en src/config.ts.
// Uso:  npm run setup-stripe        (te pregunta lo necesario; la clave no se guarda en ningún archivo)
// Se puede repetir sin miedo: reutiliza lo que ya existe en vez de duplicarlo.
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const API = process.env.STRIPE_API_BASE || 'https://api.stripe.com';
const CONFIG = 'src/config.ts';
const say = (m = '') => console.log(m);
const die = (m) => { console.error('\n✗ ' + m + '\n'); process.exit(1); };

// ---------- entrada (clave oculta al teclear) ----------
const mute = new Writable({ write(chunk, enc, cb) { if (!mute.muted) stdout.write(chunk, enc); cb(); } });
const rl = readline.createInterface({ input: stdin, output: mute, terminal: !!stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
async function ask(q, { hidden = false } = {}) {
  stdout.write(q);
  mute.muted = hidden;
  const { value } = await lines.next();
  mute.muted = false;
  if (hidden) stdout.write('\n');
  return (value || '').trim();
}

// ---------- config.ts ----------
let cfg = readFileSync(CONFIG, 'utf8');
const siteDefault = (/export const SITE_URL = '([^']+)'/.exec(cfg) || [])[1] || '';
const priceOf = (plan) => (new RegExp(plan + ':\\s*\\{[^}]*priceNumber:\\s*\'([0-9.]+)\'').exec(cfg) || [])[1];
const PLANS = [
  { id: 'monthly', name: 'NextGranMaestro Ilimitado mensual', interval: 'month', amount: Math.round(parseFloat(priceOf('monthly')) * 100) },
  { id: 'yearly', name: 'NextGranMaestro Ilimitado anual', interval: 'year', amount: Math.round(parseFloat(priceOf('yearly')) * 100) },
];
if (PLANS.some((p) => !Number.isInteger(p.amount) || p.amount < 50)) die('No he podido leer los precios de src/config.ts (priceNumber). Revisa ese archivo.');

// ---------- Stripe ----------
function flat(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') flat(v, key, out); else if (v !== undefined) out.push([key, String(v)]);
  }
  return out;
}
let KEY = '';
async function stripe(method, path, body) {
  const init = { method, headers: { Authorization: 'Bearer ' + KEY } };
  if (body) { init.headers['content-type'] = 'application/x-www-form-urlencoded'; init.body = flat(body).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); }
  let r; try { r = await fetch(API + path, init); } catch { die('No hay conexión con Stripe. Comprueba tu Internet y vuelve a ejecutarlo.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (j.error && j.error.message) || 'error desconocido';
    if (r.status === 401) die('Stripe no acepta esa clave. Cópiala de nuevo (empieza por sk_test_ o sk_live_).');
    if (r.status === 403) die('Esa clave no tiene permisos para crear productos, precios y enlaces de pago. Usa la «clave secreta» completa (no la restringida) solo para este paso. Detalle: ' + m);
    die('Stripe respondió con un error: ' + m);
  }
  return j;
}

say('\n=== NextGranMaestro · alta automática en Stripe ===\n');
KEY = process.env.STRIPE_SECRET_KEY || await ask('Pega tu clave secreta de Stripe (sk_test_… para probar, sk_live_… para cobrar; no se verá al escribir): ', { hidden: true });
const m = /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.exec(KEY);
if (!m) die('Esa clave no tiene el formato correcto. Debe empezar por sk_test_ o sk_live_ (Stripe → Desarrolladores → Claves de API).');
const mode = m[2];
let site = (process.env.SITE_URL || await ask(`Dirección de tu web [${siteDefault}]: `) || siteDefault).replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(site)) die('La dirección debe empezar por https:// y no llevar nada detrás, por ejemplo https://nextgranmaestro.tuusuario.workers.dev');
if (mode === 'live') {
  say('\n⚠  Es una clave REAL (sk_live): se crearán productos y enlaces de cobro reales.');
  const ok = process.env.SETUP_CONFIRM || await ask('Escribe SI para continuar: ');
  if (ok.toUpperCase() !== 'SI') die('Cancelado, no se ha creado nada.');
}
say(`\nModo: ${mode === 'test' ? 'PRUEBAS (dinero ficticio)' : 'REAL'} · Web: ${site}\n`);

const redirect = `${site}/gracias?session_id={CHECKOUT_SESSION_ID}`;
const results = {};
for (const plan of PLANS) {
  // producto (reutiliza si ya existe)
  const prods = await stripe('GET', '/v1/products?active=true&limit=100');
  let product = prods.data.find((p) => p.metadata && p.metadata.ngm_plan === plan.id);
  if (!product) product = await stripe('POST', '/v1/products', { name: plan.name, description: 'Análisis de ajedrez ilimitados y profundidad máxima en NextGranMaestro.', metadata: { ngm_plan: plan.id } });
  // precio
  const prices = await stripe('GET', `/v1/prices?product=${product.id}&active=true&limit=100`);
  let price = prices.data.find((p) => p.unit_amount === plan.amount && p.currency === 'eur' && p.recurring && p.recurring.interval === plan.interval);
  if (!price) price = await stripe('POST', '/v1/prices', { product: product.id, unit_amount: plan.amount, currency: 'eur', recurring: { interval: plan.interval }, metadata: { ngm_plan: plan.id } });
  // enlace de pago
  const links = await stripe('GET', '/v1/payment_links?active=true&limit=100');
  const mine = links.data.filter((l) => l.metadata && l.metadata.ngm_plan === plan.id);
  let link = mine.find((l) => l.after_completion && l.after_completion.redirect && l.after_completion.redirect.url === redirect);
  if (link) {
    const items = await stripe('GET', `/v1/payment_links/${link.id}/line_items?limit=5`);
    if (!items.data.some((i) => i.price && i.price.id === price.id)) link = null;
  }
  if (!link) {
    link = await stripe('POST', '/v1/payment_links', {
      line_items: { 0: { price: price.id, quantity: 1 } },
      after_completion: { type: 'redirect', redirect: { url: redirect } },
      allow_promotion_codes: 'true',
      billing_address_collection: 'auto',
      custom_text: { submit: { message: `Herramienta de análisis y estudio: no usar en partidas contra otras personas. Condiciones: ${site}/condiciones` } },
      subscription_data: { metadata: { ngm_plan: plan.id } },
      metadata: { ngm_plan: plan.id },
    });
    for (const old of mine) await stripe('POST', `/v1/payment_links/${old.id}`, { active: 'false' }); // desactiva enlaces antiguos
  }
  results[plan.id] = { url: link.url, price: price.id };
  say(`✓ ${plan.name}: ${link.url}`);
}

// ---------- parchear src/config.ts ----------
cfg = cfg.split('\n').map((line) => {
  const id = /^\s*(monthly|yearly):/.exec(line) && /^\s*(monthly|yearly):/.exec(line)[1];
  if (!id || !line.includes('checkout:')) return line;
  return line.replace(/checkout:\s*(null|'[^']*')(\s+as string \| null)?/, `checkout: '${results[id].url}' as string | null`).replace(/\s*\/\/ \[AÑADIR ENLACE DE PAGO REAL\]/, '');
}).join('\n');
cfg = cfg.replace(/export const SITE_URL = '[^']*';[^\n]*/, `export const SITE_URL = '${site}';`);
writeFileSync(CONFIG, cfg);
say('\n✓ src/config.ts actualizado con tus enlaces y tu dirección.');

const tokenSecret = randomBytes(32).toString('hex');
say(`
=============================== QUÉ HACER AHORA ===============================
1) Sube a GitHub el archivo  src/config.ts  (GitHub → src → config.ts → lápiz → pega el contenido → Commit changes).
   Cloudflare publicará la web solo.

2) En Cloudflare → tu proyecto → Settings → Variables and Secrets → Add (tipo Secret):
     TOKEN_SECRET       =  ${tokenSecret}
     STRIPE_SECRET_KEY  =  una clave RESTRINGIDA de solo lectura (ver PAGOS.md, paso 5)
   (Copia el TOKEN_SECRET de arriba ahora; no se vuelve a mostrar y no lo compartas.)
   Opcional (más seguridad): añade también ALLOWED_PRICE_IDS = ${results.monthly.price},${results.yearly.price}
   (así solo estos dos precios dan acceso al plan ilimitado).

3) IMPORTANTE: la clave sk_ que acabas de usar tiene permisos de escritura. Cuando termines,
   en Stripe → Desarrolladores → Claves de API → «Revertir clave» (rollover) para anularla.
   No la pegues en GitHub ni en Cloudflare.

4) Portal para que tus clientes cancelen: Stripe → Ajustes → Facturación → Portal de clientes
   → activar → copiar el enlace → pegarlo en PORTAL_URL de src/config.ts.
===============================================================================
`);
rl.close();
