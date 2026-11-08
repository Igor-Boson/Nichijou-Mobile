// Modelo de dados puro (sem DOM, sem localStorage): fácil de testar.
//
// doc = { version: 1, items: { [id]: Item } }
// Item = { id, text, list: "YYYY-MM-DD" | "dump", status: "open"|"done"|"moved"|"dropped",
//          order, from?, fromId?, movedTo?, createdAt, updatedAt, deleted? }
//
// Toda mudança atualiza `updatedAt`. A sincronização mescla item a item: vence o mais recente.
// Exclusões viram "lápide" (deleted: true) para não ressuscitarem na mesclagem.

import { addDays, isDayKey } from './dates.js';

export const DUMP = 'dump';
export const STATUSES = ['open', 'done', 'moved', 'dropped'];
export const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000;

export const emptyDoc = () => ({ version: 1, items: {} });

export function newId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

let lastTs = 0;
/** Relógio monotônico: nunca repete nem volta no mesmo aparelho. */
export function stamp() {
  const t = Date.now();
  lastTs = t > lastTs ? t : lastTs + 1;
  return lastTs;
}

const byOrder = (a, b) => a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const listItems = (doc, list) =>
  Object.values(doc.items).filter(i => i.list === list && !i.deleted).sort(byOrder);

export const nextOrder = (doc, list) => Math.max(0, ...listItems(doc, list).map(i => i.order)) + 1;

function touch(it, patch) {
  Object.assign(it, patch);
  for (const k of Object.keys(it)) if (it[k] === undefined) delete it[k];
  it.updatedAt = stamp();
  return it;
}

/** Cria (ou revive, se o id já existir) um item. */
function put(doc, id, fields) {
  const existing = doc.items[id];
  if (existing) return touch(existing, { deleted: undefined, ...fields });
  const t = stamp();
  doc.items[id] = { id, createdAt: t, updatedAt: t, ...fields };
  return doc.items[id];
}

export function addItem(doc, list, text) {
  text = String(text || '').trim();
  if (!text) return null;
  return put(doc, newId(), { text, list, status: 'open', order: nextOrder(doc, list) });
}

export function editItem(doc, id, text) {
  const it = doc.items[id];
  text = String(text || '').trim();
  if (!it || !text || text === it.text) return;
  touch(it, { text });
}

/** Para onde "adiar" manda: dia seguinte; se a folha já passou, vem pra hoje. */
export const postponeTarget = (it, now) => (it.list < now ? now : addDays(it.list, 1));

export function postpone(doc, id, now, to = postponeTarget(doc.items[id], now)) {
  const it = doc.items[id];
  if (!it || it.list === DUMP) return null;
  touch(it, { status: 'moved', movedTo: to });
  // id determinístico: se iPhone e iPad adiarem a mesma tarefa, a cópia é a mesma.
  return put(doc, `m:${id}:${to}`, {
    text: it.text, list: to, status: 'open', order: nextOrder(doc, to), from: it.list, fromId: id,
    movedTo: undefined
  });
}

export function restore(doc, id) {
  const it = doc.items[id];
  if (!it) return;
  if (it.status === 'moved') {
    for (const c of Object.values(doc.items)) if (c.fromId === id && !c.deleted && c.list === it.movedTo) touch(c, { deleted: true });
  }
  touch(it, { status: 'open', movedTo: undefined });
}

export function toggle(doc, id) {
  const it = doc.items[id];
  if (!it) return;
  if (it.status === 'open') touch(it, { status: 'done' });
  else if (it.status === 'moved') restore(doc, id);
  else touch(it, { status: 'open' });
}

export function setStatus(doc, id, status) {
  const it = doc.items[id];
  if (it && STATUSES.includes(status) && status !== 'moved') touch(it, { status });
}

export function toDump(doc, id) {
  const it = doc.items[id];
  if (!it || it.list === DUMP) return;
  touch(it, { list: DUMP, from: it.list, fromId: undefined, status: 'open', movedTo: undefined, order: nextOrder(doc, DUMP) });
}

export function toDay(doc, id, day) {
  const it = doc.items[id];
  if (!it || it.list === day) return;
  touch(it, { list: day, from: it.list, fromId: undefined, status: 'open', movedTo: undefined, order: nextOrder(doc, day) });
}

export function removeItem(doc, id) {
  const it = doc.items[id];
  if (it && !it.deleted) touch(it, { deleted: true });
}

/** ids na nova ordem; só toca nos que mudaram de posição. */
export function reorder(doc, ids) {
  ids.forEach((id, i) => {
    const it = doc.items[id];
    if (it && it.order !== i + 1) touch(it, { order: i + 1 });
  });
}

/** Tarefas abertas em dias anteriores a hoje. */
export const pending = (doc, now) =>
  Object.values(doc.items)
    .filter(i => !i.deleted && i.status === 'open' && isDayKey(i.list) && i.list < now)
    .sort((a, b) => (a.list < b.list ? -1 : a.list > b.list ? 1 : byOrder(a, b)));

export function review(doc, bringIds, dropRest, now) {
  const bring = new Set(bringIds);
  for (const it of pending(doc, now)) {
    if (bring.has(it.id)) postpone(doc, it.id, now, now);
    else if (dropRest) touch(it, { status: 'dropped' });
  }
}

/* ---------- mesclagem (sincronização) ---------- */

const newer = (a, b) => {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  // empate: escolha determinística, igual nos dois aparelhos
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
};

/**
 * Mescla dois docs item a item.
 * Retorna { doc, changedA, changedB }: se o resultado difere de `a` e/ou de `b`.
 */
export function merge(a, b) {
  const items = {};
  let changedA = false, changedB = false;
  const ids = new Set([...Object.keys(a.items), ...Object.keys(b.items)]);
  for (const id of ids) {
    const x = a.items[id], y = b.items[id];
    const pick = x && y ? newer(x, y) : x || y;
    items[id] = { ...pick };
    if (!x || (pick !== x && JSON.stringify(x) !== JSON.stringify(pick))) changedA = true;
    if (!y || (pick !== y && JSON.stringify(y) !== JSON.stringify(pick))) changedB = true;
  }
  return { doc: { version: 1, items }, changedA, changedB };
}

/** Remove lápides antigas. */
export function purge(doc, nowMs = Date.now()) {
  for (const [id, it] of Object.entries(doc.items)) {
    if (it.deleted && nowMs - it.updatedAt > TOMBSTONE_TTL) delete doc.items[id];
  }
  return doc;
}

/** Valida/normaliza um doc vindo de fora (backup, gist). Lança erro se for lixo. */
export function sanitize(input) {
  if (!input || typeof input !== 'object' || typeof input.items !== 'object' || input.items === null) {
    throw new Error('Arquivo não parece um backup do 日常.');
  }
  const items = {};
  for (const [id, raw] of Object.entries(input.items)) {
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.text !== 'string' || typeof raw.list !== 'string') continue;
    if (raw.list !== DUMP && !isDayKey(raw.list)) continue;
    const it = {
      id,
      text: raw.text.slice(0, 2000),
      list: raw.list,
      status: STATUSES.includes(raw.status) ? raw.status : 'open',
      order: Number.isFinite(raw.order) ? raw.order : 0,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
    };
    if (typeof raw.from === 'string') it.from = raw.from;
    if (typeof raw.fromId === 'string') it.fromId = raw.fromId;
    if (typeof raw.movedTo === 'string') it.movedTo = raw.movedTo;
    if (raw.deleted === true) it.deleted = true;
    items[id] = it;
  }
  return { version: 1, items };
}
