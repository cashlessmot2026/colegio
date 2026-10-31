export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const toISO = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const fmtDate = (d) => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtTime = (t) => t ? String(t).slice(0, 5) : '';
export const weekStart = (d = new Date()) => {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(12, 0, 0, 0); return x;
};
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const nowHHMM = () => new Date().toTimeString().slice(0, 5);
export const isoDay = (d = new Date()) => { const g = d.getDay(); return g === 0 ? 7 : g; }; // 1 = lunes
export const monthLabel = (ym) => new Date(ym + '-15').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

// bloque de horario que ocurre ahora mismo
export function currentBlock(schedule, d = new Date()) {
  const day = isoDay(d); const t = d.toTimeString().slice(0, 5);
  return schedule.find((b) => b.day === day && fmtTime(b.start_time) <= t && fmtTime(b.end_time) > t) || null;
}
export function nextBlock(schedule, d = new Date()) {
  const day = isoDay(d); const t = d.toTimeString().slice(0, 5);
  return schedule.filter((b) => b.day === day && fmtTime(b.start_time) > t).sort((a, b) => a.start_time.localeCompare(b.start_time))[0] || null;
}
