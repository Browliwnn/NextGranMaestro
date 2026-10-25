# Seguridad de NextGranMaestro

## Cómo está protegido
- **Web 100 % estática**: no hay base de datos ni panel de administración que atacar. El único código de servidor es `worker/index.js` (2 rutas: `/api/activate` y `/api/status`).
- **Pagos**: los gestiona Stripe. La web nunca ve ni guarda datos de tarjeta. La clave de Stripe vive solo como *secreto* de Cloudflare (nunca en GitHub) y se recomienda una clave **restringida de solo lectura**.
- **Activación del plan**: el servidor comprueba el pago directamente con Stripe y firma un código con HMAC-SHA256 (`TOKEN_SECRET`). Un código inventado o modificado se rechaza; la suscripción se revalida cada día, así que si se cancela o falla el pago, el plan se apaga.
- **API endurecida**: solo POST, solo JSON, solo desde el propio dominio, cuerpo máximo 2 KB, identificadores validados con expresiones estrictas, límite de peticiones por IP (en memoria y con el limitador de Cloudflare), errores genéricos y cabeceras de seguridad en cada respuesta.
- **Cabeceras del navegador** (se generan en cada compilación): política CSP estricta (los scripts en línea solo valen si coincide su hash), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Cross-Origin-Opener-Policy`, `Permissions-Policy` sin cámara, micro ni ubicación, y `frame-ancestors 'none'` contra *clickjacking*.
- **Sin terceros en la web**: ni analítica, ni fuentes externas, ni CDN. El motor de ajedrez se sirve desde tu propio dominio.
- **Dependencias**: `npm audit` sin vulnerabilidades conocidas en el momento de la entrega y Dependabot activado para avisarte de las siguientes.

## Límites honestos (ningún sistema es «inhackeable»)
- El motor de ajedrez se ejecuta **en el navegador del usuario**; por tanto, el contador de 5 análisis gratis y el bloqueo de la profundidad «Máxima» se pueden saltar con conocimientos técnicos. No afecta a tu dinero: el pago y la suscripción se verifican siempre en el servidor. Bloquearlo del todo exigiría ejecutar el motor en un servidor de pago por uso.
- Quien tenga el enlace `/gracias?session_id=…` o el código de activación puede activar el plan en su navegador (por eso se pide no compartirlo). Si quieres cerrar esto, el siguiente paso son cuentas de usuario.
- La seguridad de tu cuenta de GitHub, Cloudflare y Stripe es **tu** responsabilidad: activa la verificación en dos pasos (2FA) en las tres.

## Qué debes hacer tú
1. Activa 2FA en GitHub, Cloudflare y Stripe.
2. No pegues nunca claves (`sk_…`, `rk_…`, `TOKEN_SECRET`) en archivos del repositorio, mensajes ni capturas.
3. Usa una clave de Stripe **restringida** y rótala si sospechas que se ha filtrado (Stripe → Desarrolladores → Claves de API).
4. Acepta las propuestas de Dependabot (botón verde «Merge») cuando compile bien.
5. En Cloudflare, activa en tu dominio las reglas gratuitas: **Security → WAF → Rate limiting rules** y **Bot Fight Mode**.

## Informar de un fallo
Escribe a [AÑADIR EMAIL DE CONTACTO] describiendo el problema. No publiques el fallo antes de que se corrija.

## Registro de dispositivos (un plan, un dispositivo)
- El servidor guarda por suscripción solo un identificador aleatorio del navegador y la fecha del último traspaso (Durable Object de Cloudflare). No guarda datos personales ni de tarjeta.
- Un código de activación no se puede inventar (va firmado con `TOKEN_SECRET`) y deja de servir si la suscripción se cancela o no se paga.
- Límites honestos: quien consiga tu código podría traspasar el plan a su dispositivo; la espera de 24 h entre traspasos y la cancelación en Stripe limitan el daño. El avance del entrenamiento y el límite diario gratuito se controlan en el navegador y un usuario con conocimientos podría saltárselos.

## Webhook y recuperación por email
- `/api/stripe-webhook` solo acepta eventos con firma válida de Stripe (HMAC-SHA256 con `STRIPE_WEBHOOK_SECRET`) y con menos de 5 minutos de antigüedad. Sin firma válida responde 400.
- `/api/recover` responde siempre lo mismo exista o no el email (no se puede averiguar qué emails tienen plan), limita a 5 peticiones por hora y por IP y a 1 correo cada 10 minutos por email.
- El código del correo es el mismo código de «Traspasar plan»: quien lo tenga puede mover el plan (una vez cada 24 h). Por eso solo llega al email con el que se pagó.
- Los avisos a Discord solo se envían a `discord.com`.

## Duelos en línea
- El servidor valida cada jugada y lleva los relojes; el cliente no puede mover fuera de turno, jugar ilegal ni tocar el Elo. El WebSocket se abre con una entrada firmada (HMAC) de 2 minutos y se rechaza si el origen no es la propia web. Los apodos se validan y no admiten nombres que imiten al equipo; no hay chat libre. Límite diario de duelos gratis aplicado en el servidor.

## Cuentas
- Contraseñas: PBKDF2-SHA256, 100 000 iteraciones, sal aleatoria por cuenta; nunca se guardan ni se devuelven en claro.
- Sesión: cookie `ngm_s` con `HttpOnly`, `Secure` y `SameSite=Strict` (el JavaScript de la web no puede leerla); el servidor guarda solo un resumen SHA-256 del identificador; caduca a los 30 días; máximo 8 sesiones por cuenta.
- Verificación de email (solo si Resend está configurado): enlace de un solo uso que vale 24 h; sin verificar no se puede pagar ni vincular un plan. Pagos desde la web (`/api/checkout`) y, con `REQUIRE_ACCOUNT=1`, el servidor solo acepta pagos hechos por la cuenta que los inició.
- Bloqueo tras 8 intentos fallidos durante 15 minutos; registro limitado a 10 por IP y hora; «olvidé mi contraseña» a 5 por IP y hora y 1 correo cada 10 minutos por cuenta.
- Cambiar o restablecer la contraseña cierra las demás sesiones. El enlace de restablecimiento vale 1 hora y un solo uso.
- Todas las peticiones de cuentas exigen mismo origen y JSON (protección contra CSRF), además de la cookie `SameSite=Strict`.
