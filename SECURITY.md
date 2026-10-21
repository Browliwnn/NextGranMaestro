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
