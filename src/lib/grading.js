// Escalas de valoración usadas en colegios de Colombia.
// El Decreto 1290 de 2009 obliga a cada institución a definir su escala propia
// y a hacerla equivalente a la escala nacional: Superior, Alto, Básico y Bajo.
export const SCALES = {
  '1-5': {
    id: '1-5', label: 'Numérica 1.0 a 5.0 (la más común)', min: 1, max: 5, step: 0.1, decimals: 1,
    levels: [
      { name: 'Bajo', from: 1.0, to: 2.9, color: '#ff4d6d' },
      { name: 'Básico', from: 3.0, to: 3.9, color: '#ffb547' },
      { name: 'Alto', from: 4.0, to: 4.5, color: '#3ddc97' },
      { name: 'Superior', from: 4.6, to: 5.0, color: '#4cc9f0' },
    ],
  },
  '1-10': {
    id: '1-10', label: 'Numérica 1 a 10', min: 1, max: 10, step: 0.1, decimals: 1,
    levels: [
      { name: 'Bajo', from: 1.0, to: 5.9, color: '#ff4d6d' },
      { name: 'Básico', from: 6.0, to: 7.9, color: '#ffb547' },
      { name: 'Alto', from: 8.0, to: 9.4, color: '#3ddc97' },
      { name: 'Superior', from: 9.5, to: 10, color: '#4cc9f0' },
    ],
  },
  '0-100': {
    id: '0-100', label: 'Numérica 0 a 100', min: 0, max: 100, step: 1, decimals: 0,
    levels: [
      { name: 'Bajo', from: 0, to: 59, color: '#ff4d6d' },
      { name: 'Básico', from: 60, to: 79, color: '#ffb547' },
      { name: 'Alto', from: 80, to: 94, color: '#3ddc97' },
      { name: 'Superior', from: 95, to: 100, color: '#4cc9f0' },
    ],
  },
};

export const getScale = (id) => SCALES[id] || SCALES['1-5'];

export function levelFor(value, scaleId) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const s = getScale(scaleId);
  const v = Number(value);
  // se usa "from" del siguiente nivel como umbral para que 2.95 no quede en un hueco
  let lvl = s.levels[0];
  for (const l of s.levels) if (v >= l.from - 1e-9) lvl = l;
  return lvl;
}

export const passes = (value, scaleId) => {
  const l = levelFor(value, scaleId);
  return !!l && l.name !== 'Bajo';
};

// 0..1, para comparar notas de asignaturas con escalas distintas
export function normalize(value, scaleId) {
  const s = getScale(scaleId);
  return (Number(value) - s.min) / (s.max - s.min);
}

// convierte una fracción 0..1 a la escala indicada
export function fromNormalized(frac, scaleId) {
  const s = getScale(scaleId);
  return s.min + frac * (s.max - s.min);
}

export function fmt(value, scaleId) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(getScale(scaleId).decimals);
}

// promedio ponderado de tareas (weight = porcentaje relativo)
export function weightedAverage(items) {
  const valid = items.filter((i) => i.value != null && !Number.isNaN(Number(i.value)));
  if (!valid.length) return null;
  const tw = valid.reduce((a, i) => a + (Number(i.weight) || 1), 0);
  return valid.reduce((a, i) => a + Number(i.value) * (Number(i.weight) || 1), 0) / tw;
}

export const PERIODS = [1, 2, 3, 4];
export const DAYS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// muestra un valor normalizado (0..1) en la escala indicada
export const fmtNorm = (frac, scaleId) => (frac == null ? '—' : fmt(fromNormalized(frac, scaleId), scaleId));
