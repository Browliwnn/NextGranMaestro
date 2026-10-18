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
console.log(`_headers generado (${hashes.size} scripts en línea con hash)`);
