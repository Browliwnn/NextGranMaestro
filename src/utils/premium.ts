// Estado "plan ilimitado" en el navegador. El token lo firma el servidor (worker/index.js) tras verificar el pago en Stripe.
const TK = 'ngm-token';
const OK = 'ngm-prem-ok';
const DAY = 864e5;

export function getToken(): string | null { try { return localStorage.getItem(TK); } catch { return null; } }
export function setToken(t: string) { try { localStorage.setItem(TK, t); localStorage.setItem(OK, String(Date.now())); } catch {} }
export function clearToken() { try { localStorage.removeItem(TK); localStorage.removeItem(OK); } catch {} }

/** Lectura rápida (sin red): hay token y se verificó hace menos de 3 días. */
export function isPremium(): boolean {
  if (!getToken()) return false;
  try { return Date.now() - Number(localStorage.getItem(OK) || 0) < 3 * DAY; } catch { return false; }
}

/** Reverifica con el servidor como mucho una vez al día. Si hay un fallo de red, mantiene el estado actual. */
export async function refreshPremium(): Promise<boolean> {
  const t = getToken();
  if (!t) return false;
  try {
    if (Date.now() - Number(localStorage.getItem(OK) || 0) < DAY) return true;
    const r = await fetch('/api/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t }) });
    if (r.ok) {
      const j = await r.json();
      if (j.active) { localStorage.setItem(OK, String(Date.now())); return true; }
      clearToken(); return false;
    }
    if (r.status === 401) { clearToken(); return false; }
    return isPremium();
  } catch { return isPremium(); }
}

/** Activa el plan en este navegador con un código copiado de otro dispositivo (página /cuenta). */
export async function activateWithCode(raw: string): Promise<'ok' | 'invalid' | 'inactive' | 'error'> {
  const code = raw.trim();
  if (!/^[A-Za-z0-9_-]{20,600}\.[A-Za-z0-9_-]{20,100}$/.test(code)) return 'invalid';
  try {
    const r = await fetch('/api/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: code }) });
    if (r.status === 401) return 'invalid';
    if (!r.ok) return 'error';
    const j = await r.json();
    if (j.active) { setToken(code); return 'ok'; }
    return 'inactive';
  } catch { return 'error'; }
}
