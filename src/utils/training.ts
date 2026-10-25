import { queueSync } from './account';
// Progreso del entrenamiento (se guarda en este navegador) y reglas de avance diario.
export interface TrainState { done: number[]; day: string; today: number; streak: number; lastDay: string }
const KEY = 'ngm-train';
export const todayStr = () => new Date().toLocaleDateString('sv'); // AAAA-MM-DD en hora local
const yesterdayStr = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('sv'); };

export function load(): TrainState {
  const empty: TrainState = { done: [], day: todayStr(), today: 0, streak: 0, lastDay: '' };
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return empty;
    const s = JSON.parse(raw);
    const st: TrainState = { done: Array.isArray(s.done) ? s.done.filter((n: unknown) => Number.isInteger(n)) : [], day: String(s.day || ''), today: Number(s.today) || 0, streak: Number(s.streak) || 0, lastDay: String(s.lastDay || '') };
    if (st.day !== todayStr()) { st.day = todayStr(); st.today = 0; }
    if (st.lastDay && st.lastDay !== todayStr() && st.lastDay !== yesterdayStr()) st.streak = 0;
    return st;
  } catch { return empty; }
}
export function save(s: TrainState) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} queueSync(); }
/** Primer nivel sin superar (1..total) o total+1 si ya están todos. */
export const currentLevel = (s: TrainState, total: number) => { for (let i = 1; i <= total; i++) if (!s.done.includes(i)) return i; return total + 1; };
/** Marca un nivel nuevo como superado: suma al cupo de hoy y a la racha. */
export function complete(s: TrainState, level: number): TrainState {
  if (s.done.includes(level)) return s;
  const n = { ...s, done: [...s.done, level].sort((a, b) => a - b), today: s.today + 1 };
  if (n.lastDay !== todayStr()) { n.streak = n.lastDay === yesterdayStr() ? n.streak + 1 : 1; n.lastDay = todayStr(); }
  save(n); return n;
}
