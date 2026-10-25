# Duelos en línea (web, iOS y Android en una sola sala)

**Qué hay:** página `/online` con cola de emparejamiento por ritmo (1+0, 3+0, 3+2, 5+0, 10+0, 15+10), partidas en tiempo real con relojes, Elo, ranking, historial, denuncias, lista de jugadores conectados y partidas en directo, y contadores públicos de «cuánta gente hay» en la portada y en `/jugar`.

## Cómo funciona (para que no dependa de la plataforma)
- Todo lo decide el **servidor** (`worker/online.js`): jugadas legales (chess.js), relojes, resultado y Elo. Los clientes solo envían intenciones y pintan lo que reciben.
- Hay dos Durable Objects: `Lobby` (una sola sala global: conectados, cola, ranking, denuncias) y `GameRoom` (una por partida; sobrevive a recargas y desconexiones).
- **Cuentas:** hace falta cuenta (y email verificado si Resend está activo). El Elo vive en la cuenta, así que es el mismo en web, iOS y Android.
- **Protocolo:** el cliente pide una entrada firmada de 2 minutos (`POST /api/online/ticket`, con la sesión) y abre un WebSocket:
  - Sala: `wss://TU-DOMINIO/api/online/ws?ticket=…` → mensajes `hello`, `stats`, `seeking`, `match`, `resume`, `err`; envía `{"t":"seek","tc":"5+0"}`, `{"t":"cancel"}`.
  - Partida: `wss://TU-DOMINIO/api/online/game?id=…&ticket=…` → `state` (tablero, jugadas, relojes…) y `say`; envía `move`, `resign`, `draw`, `nodraw`, `abort`, `say`.
  - Cliente de referencia sin DOM: `src/utils/online-client.ts`.
- **Reglas del servidor:** sin mover en 40 s la partida se anula (sin Elo); desconectado más de 60 s pierde; tablas por acuerdo, repetición, 50 movimientos, ahogado o material; solo mensajes rápidos (sin chat libre); 5 denuncias al día por cuenta.
- **Elo:** inicial 1200; K=40 las primeras 30 partidas y K=20 después; mínimo 100. Las anuladas no cuentan.
- **Límite gratis:** `ONLINE_FREE_PER_DAY` (por defecto 5 duelos al día; variable del Worker). El plan ilimitado no tiene límite. El plan debe estar guardado en la cuenta para contar como ilimitado.

## Cuando hagas las apps de iOS y Android
1. La opción más simple y que mantiene **todo vinculado**: la app carga esta misma web (Capacitor con `server.url` = tu dominio). Usa la misma cuenta, cookies, Elo y sala; no hay que reescribir nada.
2. Si algún día haces una app nativa, usa el protocolo de arriba. Falta una cosa: ahora la entrada se pide con la cookie de sesión; en nativo habría que añadir inicio de sesión con token (te lo preparo cuando llegue el momento).
3. Apple y Google exigen en apps con contenido de otros usuarios: **denunciar** (ya está) y **bloquear** (pendiente), política de privacidad y borrado de cuenta (ya están). Y, si cobras dentro de la app, usar sus sistemas de pago (ver conversación sobre RevenueCat).

## Qué debes hacer tú
- Nada para que funcione: el despliegue crea los Durable Objects solos (migración `v3` en `wrangler.jsonc`).
- Para recibir las denuncias, configura `ALERT_WEBHOOK_URL` (Discord, ver `PAGOS.md` E.2): cada denuncia llega como aviso. Revísalas y, si procede, suspende la cuenta (hoy a mano; si lo necesitas te preparo un botón de baneo).
- Recuerda: con pocos jugadores la cola puede quedarse vacía. La página lo dice y enlaza a los bots. Promociona un horario fijo («cada día a las 20:00») para juntar gente.

## Límites honestos
- No se pueden impedir las trampas con motor; hay denuncias y revisión manual. Una IA de detección de trampas queda para el futuro.
- Una cuenta puede crear otra para «regalar» Elo a la primera. La verificación de email y el límite diario lo dificultan, pero no lo impiden.
- Los WebSockets cuentan en el uso de Cloudflare: con mucha gente, el plan gratis de Workers se queda corto (Workers Paid, 5 $/mes).
- Probado con navegadores reales sobre el Worker en local (dos jugadores, mate, rendición, recarga, desconexión, denuncia) y con pruebas automáticas del servidor; no se ha probado con miles de jugadores a la vez.
