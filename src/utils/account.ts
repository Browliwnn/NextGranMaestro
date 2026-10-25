// Cuentas opcionales (registro/inicio de sesión). La sesión vive en una cookie HttpOnly que el navegador envía solo al servidor.
// Aquí solo se guarda en localStorage un resumen (sin secretos) para pintar la interfaz sin esperar a la red.
import { getToken, transferWithCode, type TransferResult } from './premium';

export interface User { id: string; email: string; linked: boolean; verified?: boolean; verifyRequired?: boolean }
const KEY = 'ngm-user'; const SYNC_TS = 'ngm-sync-ts';
export const cachedUser = (): User | null => { try { const u = JSON.parse(localStorage.getItem(KEY) || 'null'); return u && typeof u.email === 'string' && typeof u.id === 'string' ? u : null; } catch { return null; } };
function setUser(u: User | null) {
  try { u ? localStorage.setItem(KEY, JSON.stringify({ id: u.id, email: u.email, linked: !!u.linked, verified: !!u.verified, verifyRequired: !!u.verifyRequired })) : localStorage.removeItem(KEY); } catch {}
  if (u) document.documentElement.setAttribute('data-user', '1'); else document.documentElement.removeAttribute('data-user');
}
const post = (path: string, body: object = {}) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
type R = { ok: boolean; error?: string; wait?: number };
async function call(path: string, body: object = {}): Promise<R & Record<string, any>> {
  try { const r = await post(path, body); const j = await r.json().catch(() => ({})); return { ...j, ok: !!j.ok && r.ok, error: j.error || (r.ok ? undefined : r.status === 429 ? 'rate_limited' : 'error') }; }
  catch { return { ok: false, error: 'network' }; }
}

/** Consulta al servidor quién eres. Solo llama si hay resumen guardado (los visitantes sin cuenta no hacen ninguna petición). */
export async function me(force = false): Promise<User | null> {
  if (!force && !cachedUser()) return null;
  const r = await call('/api/auth/me');
  if (r.ok && r.user) { setUser(r.user); return r.user; }
  if (r.ok) setUser(null); // el servidor dice que no hay sesión
  else return cachedUser(); // fallo de red: se conserva lo que había
  return null;
}
export async function register(email: string, password: string) { const r = await call('/api/auth/register', { email, password }); if (r.ok) setUser(r.user); return r; }
export async function login(email: string, password: string) { const r = await call('/api/auth/login', { email, password }); if (r.ok) setUser(r.user); return r; }
export async function logout() { await call('/api/auth/logout'); setUser(null); try { localStorage.removeItem(SYNC_TS); } catch {} }
export const verifyEmail = async (token: string) => { const r = await call('/api/auth/verify', { token }); if (r.ok) await me(true); return r; };
export const resendVerify = () => call('/api/auth/resend');
/** Crea el pago en el servidor (exige cuenta) y devuelve la URL de Stripe. */
export const startCheckout = (plan: 'monthly' | 'yearly') => call('/api/checkout', { plan });
export const needsVerify = (u: User | null) => !!(u && u.verifyRequired && !u.verified);
export const forgot = (email: string) => call('/api/auth/forgot', { email });
export const resetPassword = (token: string, password: string) => call('/api/auth/reset', { token, password });
export const changePassword = (password: string, newPassword: string) => call('/api/auth/password', { password, newPassword });
export async function deleteAccount(password: string) { const r = await call('/api/auth/delete', { password }); if (r.ok) setUser(null); return r; }

// ---- Progreso sincronizado (entrenamiento y marcas contra bots)
const readLocal = () => {
  const j = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const data: Record<string, unknown> = {}; const t = j('ngm-train'); const b = j('ngm-bots');
  if (t) data.train = t; if (b) data.bots = b;
  const day = new Date().toISOString().slice(0, 10); const n = Number(localStorage.getItem('ngm-quota-' + day) || 0); if (n > 0) data.quota = { day, n };
  return data;
};
/** Fusiona el progreso de este dispositivo con el de la cuenta (nunca se pierde nada) y guarda el resultado en ambos sitios. */
export async function syncNow(): Promise<boolean> {
  if (!cachedUser()) return false;
  const r = await call('/api/account/sync', { data: readLocal() });
  if (!r.ok) { if (r.error === 'no_session') setUser(null); return false; }
  const d = (r as any).data || {}; let changed = false;
  try {
    if (d.train) { const s = JSON.stringify(d.train); if (s !== localStorage.getItem('ngm-train')) { localStorage.setItem('ngm-train', s); changed = true; } }
    const day = new Date().toISOString().slice(0, 10);
    if (d.quota && d.quota.day === day) { const k = 'ngm-quota-' + day; if (Number(localStorage.getItem(k) || 0) < d.quota.n) { localStorage.setItem(k, String(d.quota.n)); changed = true; } }
    if (d.bots) { const s = JSON.stringify(d.bots); if (s !== localStorage.getItem('ngm-bots')) { localStorage.setItem('ngm-bots', s); changed = true; } }
    localStorage.setItem(SYNC_TS, String(Date.now()));
  } catch {}
  return changed;
}
/** Sincroniza como mucho cada 10 minutos (para las páginas que no dependen del progreso). */
export async function syncIfStale(): Promise<boolean> {
  try { if (Date.now() - Number(localStorage.getItem(SYNC_TS) || 0) < 600000) return false; } catch {}
  return syncNow();
}
let timer: number | undefined;
/** Programa una sincronización unos segundos después del último cambio de progreso. */
export function queueSync() { if (!cachedUser()) return; clearTimeout(timer); timer = window.setTimeout(() => { syncNow(); }, 3000); }

// ---- Plan
/** Vincula a la cuenta el plan que tiene ESTE dispositivo (comprado como invitado). */
export async function linkLocalPlan(): Promise<boolean> {
  const t = getToken(); if (!t) return false;
  const r = await call('/api/account/link', { token: t });
  if (r.ok) { const u = cachedUser(); if (u) setUser({ ...u, linked: true }); }
  return r.ok;
}
export type RestoreResult = { result: 'ok' | 'none' | 'wait' | 'error'; waitHours?: number };
/** Activa en este dispositivo el plan vinculado a la cuenta (aplica el límite de un dispositivo a la vez). */
export async function restorePlan(): Promise<RestoreResult> {
  const r = await call('/api/account/plan');
  if (!r.ok) return { result: 'error' };
  if (!r.active || !(r as any).token) return { result: 'none' };
  const t: { result: TransferResult; waitHours?: number } = await transferWithCode((r as any).token);
  return t.result === 'ok' ? { result: 'ok' } : t.result === 'wait' ? { result: 'wait', waitHours: t.waitHours } : t.result === 'inactive' ? { result: 'none' } : { result: 'error' };
}
/** Tras entrar o registrarse: trae el progreso y deja el plan donde corresponda. */
export async function afterAuth(): Promise<{ plan: 'restored' | 'linked' | 'wait' | 'none'; waitHours?: number }> {
  await syncNow();
  const u = cachedUser();
  if (u?.linked) { const r = await restorePlan(); if (r.result === 'ok') return { plan: 'restored' }; if (r.result === 'wait') return { plan: 'wait', waitHours: r.waitHours }; }
  else if (getToken() && (await linkLocalPlan())) return { plan: 'linked' };
  return { plan: 'none' };
}
/** Solo rutas internas (evita redirecciones a otras webs). */
export const safeNext = (n: string | null) => (n && /^\/[A-Za-z0-9\-_\/?=&.%]*$/.test(n) && !n.startsWith('//') ? n : '/cuenta');
