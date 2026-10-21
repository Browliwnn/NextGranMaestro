// Estado "plan ilimitado" en el navegador. El token lo firma el servidor (worker/index.js) tras verificar el pago en Stripe.
// Un plan = un dispositivo a la vez: cada navegador tiene un identificador propio y el servidor recuerda cuál es el activo.
const TK = 'ngm-token';
const OK = 'ngm-prem-ok';
const PL = 'ngm-plan';
const DV = 'ngm-dev';
const MV = 'ngm-moved';
const RECHECK = 15 * 60e3; // cada cuánto se pregunta al servidor si el plan sigue activo en este dispositivo
const GRACE = 3 * 864e5; // sin conexión se mantiene el plan hasta 3 días desde la última comprobación

export type PlanKind = 'monthly' | 'yearly' | 'unlimited';

export function getToken(): string | null { try { return localStorage.getItem(TK); } catch { return null; } }
export function getPlan(): PlanKind { try { const p = localStorage.getItem(PL); return p === 'monthly' || p === 'yearly' ? p : 'unlimited'; } catch { return 'unlimited'; } }
export function planLabel(p: PlanKind = getPlan()): string { return p === 'monthly' ? 'Plan mensual' : p === 'yearly' ? 'Plan anual' : 'Plan ilimitado'; }

/** Identificador aleatorio de este navegador (no es personal: solo sirve para saber qué dispositivo tiene el plan). */
export function getDevice(): string {
  try {
    let d = localStorage.getItem(DV);
    if (!d || !/^[a-f0-9]{32}$/.test(d)) {
      const b = crypto.getRandomValues(new Uint8Array(16));
      d = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(DV, d);
    }
    return d;
  } catch { return '0'.repeat(32); }
}

function save(token: string | null, plan?: string) {
  try {
    if (token) {
      localStorage.setItem(TK, token); localStorage.setItem(OK, String(Date.now()));
      if (plan) localStorage.setItem(PL, plan);
      localStorage.removeItem(MV);
      document.documentElement.setAttribute('data-prem', plan || '1');
    } else {
      localStorage.removeItem(TK); localStorage.removeItem(OK); localStorage.removeItem(PL);
      document.documentElement.removeAttribute('data-prem');
    }
  } catch {}
}
export function setToken(t: string, plan?: string) { save(t, plan); }
export function clearToken() { save(null); }

/** Avisa (una sola vez) de que el plan se pasó a otro dispositivo. */
export function consumeMoved(): boolean { try { const m = localStorage.getItem(MV) === '1'; localStorage.removeItem(MV); return m; } catch { return false; } }

/** Lectura rápida (sin red): hay token y se verificó hace menos de 3 días. */
export function isPremium(): boolean {
  if (!getToken()) return false;
  try { return Date.now() - Number(localStorage.getItem(OK) || 0) < GRACE; } catch { return false; }
}

const post = (path: string, body: object) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Reverifica con el servidor como mucho cada 15 minutos. Un fallo de red mantiene el estado actual. */
export async function refreshPremium(force = false): Promise<boolean> {
  const t = getToken();
  if (!t) return false;
  try {
    if (!force && Date.now() - Number(localStorage.getItem(OK) || 0) < RECHECK) return true;
    const r = await post('/api/status', { token: t, device: getDevice() });
    if (r.ok) {
      const j = await r.json();
      if (j.active) { save(t, j.plan); return true; }
      clearToken(); return false;
    }
    if (r.status === 409) { clearToken(); try { localStorage.setItem(MV, '1'); } catch {} return false; }
    if (r.status === 401) { clearToken(); return false; }
    return isPremium();
  } catch { return isPremium(); }
}

/** Activa el plan tras pagar (página /gracias). */
export async function activateFromCheckout(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await post('/api/activate', { session_id: sessionId, device: getDevice() });
    const j = await r.json();
    if (j.ok && j.token) { save(j.token, j.plan); return { ok: true }; }
    return { ok: false, error: j.error };
  } catch { return { ok: false, error: 'network' }; }
}

export type TransferResult = 'ok' | 'invalid' | 'inactive' | 'wait' | 'error';
/** Pasa el plan a ESTE dispositivo con el código copiado del dispositivo anterior (página /traspasar). */
export async function transferWithCode(raw: string): Promise<{ result: TransferResult; waitHours?: number }> {
  const code = raw.trim();
  if (!/^[A-Za-z0-9_-]{20,600}\.[A-Za-z0-9_-]{20,100}$/.test(code)) return { result: 'invalid' };
  try {
    const r = await post('/api/transfer', { token: code, device: getDevice() });
    if (r.status === 401) return { result: 'invalid' };
    if (r.status === 429) { const j = await r.json().catch(() => ({})); return { result: 'wait', waitHours: Math.max(1, Math.ceil((j.wait || 3600) / 3600)) }; }
    if (!r.ok) return { result: 'error' };
    const j = await r.json();
    if (j.active) { save(code, j.plan); return { result: 'ok' }; }
    return { result: 'inactive' };
  } catch { return { result: 'error' }; }
}
