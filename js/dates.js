// Datas como chaves "YYYY-MM-DD" no fuso local do aparelho.

const pad = n => String(n).padStart(2, '0');

export const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseKey = k => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (k, n) => {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return keyOf(d);
};

export const today = () => keyOf(new Date());

export const isDayKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);

const WEEK = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export const weekday = k => WEEK[parseKey(k).getDay()];

/** "hoje", "ontem", "amanhã" ou "" */
export const relative = (k, now = today()) =>
  k === now ? 'hoje' : k === addDays(now, -1) ? 'ontem' : k === addDays(now, 1) ? 'amanhã' : '';

/** 08/11/26 */
export const dmy = k => {
  const d = parseKey(k);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
};

/** 8/11 */
export const dm = k => {
  const d = parseKey(k);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

/** Rótulo curto de onde/para onde: "dump", "ontem", "8/11"... */
export const placeLabel = (k, now = today()) => (k === 'dump' ? 'dump' : relative(k, now) || dm(k));
