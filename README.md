# NextGranMaestro — guía para principiantes

Web de análisis de ajedrez: motor Stockfish en el navegador, flecha con la mejor jugada, plan gratis y plan ilimitado de pago (Stripe). Se publica gratis en Cloudflare desde GitHub.

**Archivos importantes:** `src/config.ts` (tus datos, precios, enlace de soporte y límites) · `PAGOS.md` (cobrar) · `SECURITY.md` (seguridad) · `worker/index.js` (servidor de pagos y registro de dispositivos) · `wrangler.jsonc` (configuración de Cloudflare) · `src/data/puzzles.json` (los 100 niveles del entrenamiento) · `scripts/setup-stripe.mjs` (crea tus planes en Stripe automáticamente).

---

## 1. Subir el proyecto a GitHub (sin comandos)
1. Descomprime el ZIP. **Entra en la carpeta** `nextgranmaestro`: lo que hay dentro es lo que se sube (`src`, `public`, `package.json`…).
2. Crea cuenta en https://github.com/signup y activa la verificación en dos pasos (Settings → Password and authentication).
3. Pulsa **+** → **New repository** → nombre `NextGranMaestro` → **Create repository**.
4. Pulsa **uploading an existing file** (o **Add file → Upload files**), selecciona **todo el contenido** de la carpeta con Ctrl+A y arrástralo. Espera a que termine → **Commit changes**.
5. Si ya tenías archivos antiguos en el repositorio, bórralos antes (abre cada archivo → papelera → Commit) o crea un repositorio nuevo.
6. Comprueba que ves `src`, `public`, `worker`, `scripts`, `package.json`, `wrangler.jsonc` y `.node-version`.

## 2. Publicar en Cloudflare (gratis)
1. Cuenta en https://dash.cloudflare.com/sign-up (activa también 2FA).
2. **Workers & Pages → Create → Import a repository (Connect to Git)** → autoriza GitHub → elige `NextGranMaestro`.
3. Rellena: **Build command** `npm run build` · **Deploy command** `npx wrangler deploy`.
4. **Deploy** y espera 1-3 minutos. Cloudflare te dará una dirección `https://…workers.dev`.
5. Si el registro dice que la versión de Node es antigua: en **Settings → Variables and Secrets** añade una variable (tipo *Text*) `NODE_VERSION` con valor `22.22.0` y vuelve a desplegar.
6. Copia esa dirección en `SITE_URL` de `src/config.ts` (en GitHub: abre el archivo → lápiz → edita → Commit). Cloudflare publica solo cada vez que cambias algo.

## 3. Activar los cobros
Sigue **`PAGOS.md`**. En resumen: `node scripts/setup-stripe.mjs` crea los dos planes en Stripe y rellena `config.ts`; después pones dos secretos en Cloudflare y haces una compra de prueba.

## 4. Dominio y HTTPS
1. Compra el dominio en Cloudflare: **Domain Registration → Register Domains** (precio de coste; comprueba el importe en pantalla). DNS = sistema que conecta tu dominio con tu web.
2. En tu proyecto: **Settings → Domains & Routes → Add → Custom domain** → escribe `tudominio.com` → Add. Repite con `www.tudominio.com`.
3. En **Rules → Redirect Rules** redirige `www` → dominio principal (evita contenido duplicado). Si tienes `.es` y `.com`, elige uno como principal y redirige el otro.
4. HTTPS es automático (en **SSL/TLS** déjalo en «Full»). Puede tardar unos minutos.
5. Cambia `SITE_URL` por tu dominio, y **vuelve a ejecutar `setup-stripe`** (PAGOS.md) para que el enlace de vuelta tras el pago apunte al dominio nuevo.

## 5. Google Search Console
1. https://search.google.com/search-console → **Añadir propiedad → Dominio** → escribe tu dominio.
2. Te da un registro TXT: Cloudflare → **DNS → Records → Add record** → Type `TXT`, Name `@`, Content = el texto de Google → Save → vuelve a Google → **Verificar**.
3. **Sitemaps** → escribe `sitemap-index.xml` → Enviar.
4. **Inspección de URL** → `https://tudominio.com/` → **Solicitar indexación** (repite con `/analizador` y `/precios`).
5. Revisa en **Páginas** qué está indexado (tarda días o semanas).

## 6. Qué debes completar antes de cobrar
- `LEGAL` en `src/config.ts` (nombre/razón social, NIF, domicilio, email) y `CONTACT_EMAIL`.
- Textos legales (`privacidad`, `cookies`, `aviso-legal`, `condiciones`): ya están redactados. Solo faltan tus datos en `LEGAL` (`src/config.ts`: nombre, NIF, domicilio); mientras tengan `[AÑADIR…]` se ven en rojo. Revísalos una vez con una gestoría. En Stripe, al crear el enlace de pago, activa «Términos de servicio» o un texto de consentimiento con el enlace a /condiciones.
- Logotipo oficial (hay uno provisional) y, cuando existan, opiniones reales en `TESTIMONIALS`.
- Activa 2FA en GitHub, Cloudflare y Stripe (ver `SECURITY.md`).

## 7. Qué incluye la web
- **Analizador** con Stockfish y una flecha con la mejor jugada.
- **Entrenamiento** (`/entrenamiento`): 100 niveles de «encuentra la mejor jugada», de fácil a difícil. Cada solución fue comprobada con Stockfish. Plan gratis: 1 nivel nuevo al día; plan ilimitado: 5 (cámbialo en `TRAINING` de `src/config.ts`). El progreso se guarda en el dispositivo.
- **Un plan, un dispositivo a la vez** y **Traspasar plan** (`/traspasar`): el plan se pasa de un dispositivo a otro con un código; el anterior deja de tenerlo. Tras un traspaso hay que esperar 24 h para volver a pasarlo.
- **Mi plan** (`/cuenta`): muestra el plan (mensual/anual). Quien tiene plan no ve los avisos de compra.
- **Buscador** (`/buscar`): busca en todas las páginas; el índice se genera solo en cada build.
- **Atención al cliente** (`/soporte`): lleva a tu Discord (`SUPPORT_URL` en `src/config.ts`).
- **Logotipo** en archivos: `public/logo.svg`, `public/logo-1024.png` y `public/logo-horizontal.png` (se regeneran con `node scripts/make-images.mjs`).

## 8. Mantenimiento
- **Textos:** edita el archivo de `src/pages/`, guarda y haz Commit en GitHub.
- **Precios:** `PLANS` en `src/config.ts` y vuelve a ejecutar `setup-stripe` (crea los precios nuevos).
- **Preguntas frecuentes:** `src/utils/faq.ts`. **Menú:** `NAV` en `src/config.ts`. **Colores:** variables al inicio de `src/styles/global.css`.
- **Actualizaciones de seguridad:** GitHub te enviará propuestas (Dependabot). Acéptalas con el botón verde cuando compilen bien.
- **Soporte:** cambia `SUPPORT_URL` en `src/config.ts` si cambias de servidor o de enlace de invitación de Discord.
- **Probar en tu PC (opcional):** instala Node.js 22 LTS desde https://nodejs.org, abre una terminal en la carpeta y ejecuta `npm install` y luego `npm run dev` → http://localhost:4321.

## Estructura
`src/data` niveles del entrenamiento · `src/pages` páginas · `src/components` tablero, piezas y cabecera · `src/layouts/Base.astro` SEO común · `src/utils` piezas, flechas, preguntas frecuentes y plan · `src/styles` diseño · `worker` servidor de pagos · `scripts` motor Stockfish, cabeceras de seguridad y alta en Stripe · `public` iconos y manifest · `.github` actualizaciones automáticas.

## Licencias
Stockfish es GPLv3 (ver `/engine/LICENSE-stockfish-GPLv3.txt`, enlazado en el Aviso legal).
