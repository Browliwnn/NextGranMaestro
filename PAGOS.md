# Cobrar con NextGranMaestro (Stripe)

**Cómo funciona:** el cliente paga en una página de Stripe → vuelve a tu web (`/gracias`) → tu servidor pregunta a Stripe si el pago es real y la suscripción está activa → activa el plan ilimitado. Cada día se revalida: si cancela o no paga, se apaga solo. Para usar el plan en otro dispositivo, el cliente copia su código en **Mi plan** (`/cuenta`).

> Los nombres de los menús de Stripe/Cloudflare cambian a veces: busca el más parecido.

## A. Atajo automático (recomendado)

**1. Cuenta de Stripe** → https://dashboard.stripe.com/register (España). Empieza en **modo de pruebas** (interruptor «Entorno de pruebas»): no hace falta activar nada para probar.

**2. Instala Node.js** (22 LTS) desde https://nodejs.org → Siguiente a todo. Reinicia la terminal si ya estaba abierta.

**3. Clave de Stripe:** Stripe → **Desarrolladores → Claves de API** → copia la **Clave secreta** (`sk_test_…`) de pruebas.

**4. Abre una terminal en la carpeta del proyecto** (en el explorador, clic en la barra de direcciones, escribe `cmd`, Enter) y ejecuta:
```
node scripts/setup-stripe.mjs
```
Te pide (1) la clave (no se ve al escribir) y (2) la dirección de tu web (`https://…workers.dev`). Crea los dos productos, los dos precios y los dos enlaces de pago con la vuelta a `/gracias` ya configurada, y **actualiza `src/config.ts`**. Se puede repetir sin duplicar nada.
- Si dice «clave no válida»: cópiala completa. Si dice «sin permisos»: usa la clave secreta completa, no una restringida.

**5. Sube `src/config.ts` a GitHub** (abre el archivo en GitHub → lápiz → pega el contenido nuevo → Commit). Cloudflare publica solo y los botones pasan de «Próximamente» a «Elegir mensual / anual».

**6. Secretos en Cloudflare** → tu proyecto → **Settings → Variables and Secrets → Add** (tipo **Secret**):
- `TOKEN_SECRET`: el texto que imprime el script al terminar (o genera uno con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
- `STRIPE_SECRET_KEY`: una clave **restringida de solo lectura**. En Stripe → Claves de API → **Crear clave restringida** → permisos **Lectura** en *Checkout Sessions* y *Suscripciones*, nada más → copia `rk_test_…`.
- Opcional (más seguridad): `ALLOWED_PRICE_IDS` = los dos `price_…` que imprime el script, separados por coma.
- Después **vuelve a desplegar** (Deployments → ⋯ → Retry) para que los coja.

**7. Revierte la clave de escritura:** la `sk_` del paso 3 puede crear cosas en tu cuenta. En Stripe → Claves de API → ⋯ → **Revertir clave**. No la pegues nunca en GitHub ni en Cloudflare.

**8. Prueba con dinero falso:** abre tu web → Precios → **Elegir mensual** → tarjeta `4242 4242 4242 4242`, fecha futura, CVC cualquiera. Debes volver a `/gracias` con «¡Plan ilimitado activado!» y ver «✓ Plan ilimitado activo» en el analizador. Para probar la cancelación: Stripe → **Clientes** → el cliente → **Cancelar suscripción** (el plan se apaga en menos de un día).

**9. Portal para que cancelen solos:** Stripe → **Ajustes → Facturación → Portal de clientes** → activar (con «cancelar suscripción») → copia el enlace → ponlo en `PORTAL_URL` de `src/config.ts` → Commit.

**10. Pasar a cobrar de verdad**
1. Activa tu cuenta de Stripe (datos del titular y cuenta bancaria). Si vas a vender de forma habitual, consulta con una gestoría el alta (autónomo/sociedad) y el IVA.
2. Desactiva el modo de pruebas y copia la clave secreta **real** (`sk_live_…`).
3. Repite los pasos 4 a 7 con esa clave (el script te pedirá escribir `SI`). Se crean productos y enlaces **reales** nuevos y `config.ts` se actualiza con ellos.
4. En Cloudflare cambia `STRIPE_SECRET_KEY` por una clave restringida **real** (`rk_live_…`) y, si lo usas, `ALLOWED_PRICE_IDS` por los `price_` reales.
5. Haz una compra real pequeña tú mismo y reembólsala (Stripe → Pagos → ⋯ → Reembolsar).
6. Antes de cobrar completa `LEGAL` y las condiciones (ver README, sección 6).

## B. Hacerlo a mano (alternativa)
1. Stripe → **Catálogo de productos** → crea `NextGranMaestro Ilimitado mensual` (4,99 €, recurrente, mensual) y `… anual` (39,99 €, recurrente, anual). Si cambias los precios, cámbialos también en `PLANS` de `src/config.ts`.
2. Stripe → **Enlaces de pago** → uno por producto. En **Después del pago** elige redirigir a tu web con:
   `https://TU-WEB/gracias?session_id={CHECKOUT_SESSION_ID}` (deja las llaves tal cual; Stripe pone el identificador del pago).
3. Pega cada enlace `https://buy.stripe.com/…` en `checkout:` de `PLANS` en `src/config.ts`, y sigue en el paso 6 de arriba.

## C. Modo de prueba o modo real
- Con enlaces `buy.stripe.com/test_…` **nadie paga de verdad**: cualquiera que encuentre el enlace puede «comprar» con la tarjeta `4242 4242 4242 4242` y obtener el plan gratis. Es solo para probar.
- Para vender de verdad: activa tu cuenta de Stripe, desactiva el modo de pruebas, crea los dos enlaces **reales** (mismos pasos que en B), pega los enlaces `https://buy.stripe.com/…` (sin `test_`) en `PLANS` de `src/config.ts`, y en Cloudflare cambia `STRIPE_SECRET_KEY` por la clave restringida **real** (`rk_live_…`). Los enlaces de prueba dejan de dar plan en cuanto el servidor usa la clave real.
- Completa antes `LEGAL` y los textos legales.

## D. Un plan, un dispositivo
El servidor guarda, para cada suscripción, qué navegador la tiene activa (Durable Object `DEVICES`, ya declarado en `wrangler.jsonc`; no necesitas configurar nada). Al comprar, el plan queda en ese dispositivo. Para cambiar de móvil: **Traspasar plan** (saca el código en el dispositivo viejo, pégalo en el nuevo). El dispositivo anterior pierde el plan en cuanto vuelve a conectarse (se comprueba cada 15 minutos). Tras un traspaso hay que esperar 24 h para repetirlo. Si algún día quieres cambiar esa espera, es `MOVE_COOLDOWN` en `worker/index.js`.

## E. Webhooks de Stripe, avisos y recuperar plan por email (opcional, muy recomendado)
Todo el código ya está hecho; solo falta darle las claves. Es todo gratis salvo que superes los límites gratuitos de Resend.

**1. Webhook de Stripe (reembolsos, disputas y bajas al instante)**
1. Stripe → **Desarrolladores → Webhooks → Añadir destino**.
2. URL: `https://TU-DOMINIO/api/stripe-webhook`.
3. Eventos: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`.
4. Copia el **secreto de firma** (`whsec_…`) → Cloudflare → Settings → Variables and Secrets → Add → tipo **Secret**: `STRIPE_WEBHOOK_SECRET`.
5. Amplía los permisos de tu clave restringida `rk_…` (Stripe → Claves de API → Editar): **Lectura** en *Customers*, *Invoices* y *Charges*, además de *Checkout Sessions* y *Subscriptions*. Si cambias la clave, actualiza `STRIPE_SECRET_KEY` en Cloudflare.
6. En modo de prueba y en modo real el webhook es distinto: crea uno en cada modo, con su propio `whsec_`.

**2. Avisos en tu Discord (ventas, pagos fallidos, reembolsos y fallos)**
1. En tu servidor de Discord: canal privado de avisos → ⚙ Editar canal → **Integraciones → Webhooks → Nuevo webhook → Copiar URL**.
2. En Cloudflare, Secret `ALERT_WEBHOOK_URL` = esa URL (empieza por `https://discord.com/api/webhooks/`).

**3. Recuperar el plan por email («¿Perdiste el código?»)**
1. Crea una cuenta en https://resend.com y **verifica tu dominio** (te da unos registros DNS; si compraste el dominio en Cloudflare se añaden con un clic). Necesitas tener ya el dominio.
2. Resend → **API Keys → Create** → copia la clave `re_…`.
3. En Cloudflare, Secrets: `RESEND_API_KEY` = la clave y `MAIL_FROM` = `NextGranMaestro <no-reply@tudominio.com>`.
4. En `src/config.ts` pon `EMAIL_RECOVERY = true` y sube el cambio. Hasta entonces el formulario no se muestra.
5. Prueba: en otro navegador, Traspasar plan → «¿Perdiste el código?» → tu email del pago → debe llegarte el correo.

Después de añadir secretos hay que volver a desplegar (Deployments → ⋯ → Retry).

## F. Cuentas de usuario (ya incluidas)
- **Qué hay:** registro e inicio de sesión con email y contraseña (`/entrar`), cuenta en `/cuenta`, sincronización del progreso (entrenamiento y bots superados) y plan guardado en la cuenta. **No hace falta cuenta** para analizar, entrenar ni jugar; **sí para comprar** (los botones de «Elegir mensual/anual» llevan a `/entrar` si no has iniciado sesión).
- **Cómo funciona el plan con cuenta:** al pagar con la sesión iniciada, la suscripción queda vinculada a la cuenta. Si el cliente inicia sesión en otro dispositivo, el plan se activa allí solo (sigue valiendo «un dispositivo a la vez», con espera de 24 h entre cambios). Quien pagó sin cuenta ve en `/gracias` un aviso para crearla, y al registrarse su plan se vincula solo.
- **No necesitas configurar nada más** para que funcionen el registro, el inicio de sesión y la sincronización: el Durable Object `ACCOUNTS` ya está en `wrangler.jsonc` (migración `v2`). Al subir el proyecto, Cloudflare lo crea solo.
- **«Olvidé mi contraseña»** envía un enlace por email: necesita Resend (paso E.3). Mientras no lo configures, la página avisa de que el envío no está activo y el cliente debe escribir a soporte.
- **Límites honestos:** (1) Mientras no hagas el paso G, el cliente puede pagar con el enlace de Stripe sin pasar por tu web; el plan funciona igual y puede guardarlo en una cuenta después. (2) El email se verifica solo si has configurado Resend (E.3); sin Resend no hay forma de enviar el enlace y no se exige. (3) Las contraseñas se guardan con PBKDF2-SHA256 (100 000 iteraciones) dentro del Durable Object. (4) Si en los registros de Cloudflare ves errores «Exceeded CPU», el plan gratuito de Workers (10 ms de CPU) se queda corto para cifrar contraseñas: pasa a Workers Paid (5 $/mes) o dímelo y lo ajusto.
- **RGPD:** el cliente puede descargar sus datos y borrar su cuenta desde `/cuenta`. Las páginas de privacidad, cookies y condiciones ya lo explican.

## G. Obligar a tener cuenta para pagar (recomendado, 5 minutos)
Los enlaces de pago públicos de Stripe se pueden abrir sin cuenta. Para que **solo se pueda pagar desde una cuenta** (y con el email verificado):
1. En Stripe → Productos, copia el **ID de precio** (`price_...`) del plan mensual y del anual (el script `setup-stripe.mjs` también los imprime).
2. En Cloudflare → Worker → Variables: `PRICE_MONTHLY` y `PRICE_YEARLY` con esos IDs (texto normal).
3. En Stripe → Developers → API keys, edita la clave restringida `rk_` y dale permiso de **escritura** en **Checkout Sessions** (además de lo que ya tenía).
4. En `src/config.ts` pon `SERVER_CHECKOUT = true` y sube el proyecto. Los botones de `/precios` crearán el pago en el servidor con tu cuenta.
5. Añade la variable `REQUIRE_ACCOUNT` = `1`. Desde ese momento el servidor **rechaza** cualquier pago que no venga de la cuenta que lo hizo.
6. En Stripe, **desactiva los Payment Links antiguos** (si no, quien pague con ellos no recibirá plan; el dinero se reembolsa desde Stripe).
Prueba siempre en modo de prueba con la tarjeta 4242 4242 4242 4242 antes de pasar a real.

## Cosas que debes saber (límites honestos)
- **El plan funciona en un dispositivo a la vez** (ver D). Quien consiga el código puede pasar el plan a su dispositivo y dejarte sin él; por eso se pide no compartirlo, y por eso hay una espera de 24 h entre traspasos. Si alguien lo roba, cancela la suscripción en Stripe: el código deja de valer.
- **Los 20 análisis gratis y el bloqueo de la profundidad «Máxima»** se controlan en el navegador. Con cuenta, el contador del día se sincroniza entre dispositivos (se queda el mayor), así que cambiar de móvil a PC no da más análisis; pero un visitante sin cuenta, o alguien con conocimientos técnicos, puede saltárselos. No afecta a tu dinero (el pago se verifica en el servidor). Bloquearlo del todo exigiría ejecutar el motor en un servidor de pago por uso.
- **Webhooks:** sin el paso E, los reembolsos y las disputas no desactivan el plan hasta que la suscripción se cancele en Stripe. Con el paso E surten efecto al instante.
- **Impuestos y consumidores:** IVA, facturas, desistimiento en servicios digitales y condiciones de venta tienen requisitos legales. Revísalos con una gestoría.
- Stripe cobra comisión por pago: https://stripe.com/es/pricing

Fuente: [documentación de Stripe sobre qué hacer tras un pago con enlace de pago](https://docs.stripe.com/payment-links/post-payment).
