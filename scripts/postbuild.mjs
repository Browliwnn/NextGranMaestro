// Se ejecuta tras "astro build". Genera dist/_headers con una política CSP ESTRICTA:
// los scripts en línea solo se permiten si su hash SHA-256 coincide con el de los que hay en las páginas compiladas.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const hashes = new Set();
for (const f of readdirSync('dist').filter((n) => n.endsWith('.html'))) {
  const html = readFileSync('dist/' + f, 'utf8');
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc\s*=/.test(m[1]) || /application\/ld\+json/.test(m[1])) continue; // externos y JSON-LD (datos) no necesitan hash
    hashes.add(`'sha256-${createHash('sha256').update(m[2]).digest('base64')}'`);
  }
}
const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(' ')} 'wasm-unsafe-eval'`.replace('  ', ' '),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

writeFileSync('dist/_headers', `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Strict-Transport-Security: max-age=31536000
  Content-Security-Policy: ${csp}
/engine/*
  Cache-Control: public, max-age=31536000, immutable
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
`);
// ---- Índice del buscador: título, descripción, encabezados y texto de cada página pública (se genera en cada build)
const decode = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ');
const clean = (h) => decode(h.replace(/<(script|style|svg|template)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const index = [];
for (const f of readdirSync('dist').filter((n) => n.endsWith('.html'))) {
  const html = readFileSync('dist/' + f, 'utf8');
  if (/name="robots" content="noindex/.test(html) || f === '404.html') continue;
  const title = clean((/<title>([\s\S]*?)<\/title>/.exec(html) || [, ''])[1]).replace(/ \| NextGranMaestro$/, '');
  const desc = decode((/<meta name="description" content="([^"]*)"/.exec(html) || [, ''])[1]);
  const main = (/<main[^>]*>([\s\S]*?)<\/main>/.exec(html) || [, ''])[1];
  const heads = [...main.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/g)].map((m) => clean(m[1])).filter(Boolean).join(' · ');
  const url = f === 'index.html' ? '/' : '/' + f.replace(/\.html$/, '');
  index.push({ u: url, t: title, d: desc, h: heads, x: clean(main).slice(0, 4000) });
}
writeFileSync('dist/search-index.json', JSON.stringify(index));
console.log(`índice del buscador: ${index.length} páginas`);
console.log(`_headers generado (${hashes.size} scripts en línea con hash)`);
