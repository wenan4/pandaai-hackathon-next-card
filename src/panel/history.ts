export interface History<T> { past: T[]; present: T; future: T[] }
export const createHistory = <T>(present: T): History<T> => ({ past: [], present: structuredClone(present), future: [] });
export function pushHistory<T>(h: History<T>, next: T): History<T> {
  if (JSON.stringify(h.present) === JSON.stringify(next)) return h;
  return { past: [...h.past, structuredClone(h.present)], present: structuredClone(next), future: [] };
}
export function undoHistory<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0,-1), present: structuredClone(h.past.at(-1)!), future: [structuredClone(h.present), ...h.future] };
}
export function redoHistory<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, structuredClone(h.present)], present: structuredClone(h.future[0]!), future: h.future.slice(1) };
}
