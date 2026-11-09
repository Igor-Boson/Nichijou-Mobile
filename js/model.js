// Modelo de dados puro (sem DOM, sem localStorage): fácil de testar.
//
// doc = { version: 1, items: { [id]: Item } }
// Item = { id, text, list: "YYYY-MM-DD" | "dump", status: "open"|"done"|"moved"|"dropped",
//          order, parent?, from?, fromId?, movedTo?, createdAt, updatedAt, deleted? }
// Subtarefa = item com `parent` (id da tarefa principal) e a mesma `list` dela.
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

/** Ordem automática: abertas (na ordem escolhida) → feitas → adiadas → riscadas. */
export const RANK = { open: 0, done: 1, moved: 2, dropped: 3 };
const byRank = (a, b) => (RANK[a.status] ?? 0) - (RANK[b.status] ?? 0) || byOrder(a, b);

/** Tarefas principais de uma folha, já na ordem de exibição. */
export const listItems = (doc, list) =>
  Object.values(doc.items).filter(i => i.list === list && !i.deleted && !i.parent).sort(byRank);

/** Subtarefas de uma tarefa, na ordem de exibição. */
export const children = (doc, parentId) =>
  Object.values(doc.items).filter(i => i.parent === parentId && !i.deleted).sort(byRank);

const siblings = (doc, list, parent) =>
  Object.values(doc.items).filter(i => !i.deleted && (parent ? i.parent === parent : i.list === list && !i.parent));

export const nextOrder = (doc, list, parent = null) => Math.max(0, ...siblings(doc, list, parent).map(i => i.order)) + 1;

/** "1/3": feitas / não riscadas. Vazio se não tem subtarefas. */
export function progress(doc, id) {
  const live = children(doc, id).filter(c => c.status !== 'dropped');
  return live.length ? `${live.filter(c => c.status === 'done').length}/${live.length}` : '';
}

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

export function addSub(doc, parentId, text) {
  const p = doc.items[parentId];
  text = String(text || '').trim();
  if (!p || p.deleted || p.parent || !text) return null;
  const it = put(doc, newId(), { text, list: p.list, parent: parentId, status: 'open', order: nextOrder(doc, p.list, parentId) });
  syncParent(doc, parentId);
  return it;
}

/** Tarefa principal acompanha as subtarefas: todas feitas → feita; alguma reaberta → aberta. */
function syncParent(doc, parentId) {
  const p = doc.items[parentId];
  if (!p || p.deleted) return;
  const live = children(doc, parentId).filter(c => c.status !== 'dropped' && c.status !== 'moved');
  if (!live.length) return;
  const allDone = live.every(c => c.status === 'done');
  if (allDone && p.status === 'open') touch(p, { status: 'done' });
  else if (!allDone && p.status === 'done') touch(p, { status: 'open' });
}

export function editItem(doc, id, text) {
  const it = doc.items[id];
  text = String(text || '').trim();
  if (!it || !text || text === it.text) return;
  touch(it, { text });
}

/** Para onde "adiar" manda: dia seguinte; se a folha já passou, vem pra hoje. */
export const postponeTarget = (it, now) => (it.list < now ? now : addDays(it.list, 1));

export function postpone(doc, id, now, to) {
  const it = doc.items[id];
  if (!it || it.list === DUMP || it.parent) return null;
  to = to || postponeTarget(it, now);
  const subs = children(doc, id).filter(c => c.status === 'open');
  touch(it, { status: 'moved', movedTo: to });
  // id determinístico: se iPhone e iPad adiarem a mesma tarefa, a cópia é a mesma.
  const copyId = `m:${id}:${to}`;
  const copy = put(doc, copyId, {
    text: it.text, list: to, status: 'open', order: nextOrder(doc, to), from: it.list, fromId: id,
    movedTo: undefined, parent: undefined
  });
  // só as subtarefas que faltavam vão junto; as feitas ficam registradas no dia
  for (const c of subs) {
    touch(c, { status: 'moved', movedTo: to });
    put(doc, `m:${c.id}:${to}`, { text: c.text, list: to, parent: copyId, status: 'open', order: c.order, fromId: c.id, from: undefined, movedTo: undefined });
  }
  return copy;
}

export function restore(doc, id) {
  const it = doc.items[id];
  if (!it) return;
  if (it.status === 'moved') {
    const undo = x => {
      for (const c of Object.values(doc.items)) if (c.fromId === x.id && !c.deleted && c.list === x.movedTo) removeItem(doc, c.id);
    };
    undo(it);
    // subtarefas que foram junto voltam também
    for (const c of children(doc, id)) if (c.status === 'moved' && c.movedTo === it.movedTo) { undo(c); touch(c, { status: 'open', movedTo: undefined }); }
  }
  touch(it, { status: 'open', movedTo: undefined });
  if (it.parent) syncParent(doc, it.parent);
}

export function toggle(doc, id) {
  const it = doc.items[id];
  if (!it) return;
  if (it.status === 'moved') return restore(doc, id);
  setStatus(doc, id, it.status === 'open' ? 'done' : 'open');
}

export function setStatus(doc, id, status) {
  const it = doc.items[id];
  if (!it || !STATUSES.includes(status) || status === 'moved') return;
  touch(it, { status });
  // marcar a principal marca as subtarefas abertas junto
  if (!it.parent && status === 'done') for (const c of children(doc, id)) if (c.status === 'open') touch(c, { status: 'done' });
  if (it.parent) syncParent(doc, it.parent);
}

/** Muda a tarefa (e as subtarefas) de folha. */
function relocate(doc, it, list) {
  touch(it, { list, from: it.list, fromId: undefined, status: 'open', movedTo: undefined, order: nextOrder(doc, list) });
  for (const c of children(doc, it.id)) touch(c, { list, fromId: undefined, movedTo: undefined, status: c.status === 'moved' ? 'open' : c.status });
}

export function toDump(doc, id) {
  const it = doc.items[id];
  if (!it || it.list === DUMP || it.parent) return;
  relocate(doc, it, DUMP);
}

export function toDay(doc, id, day) {
  const it = doc.items[id];
  if (!it || it.list === day || it.parent) return;
  relocate(doc, it, day);
}

export function removeItem(doc, id) {
  const it = doc.items[id];
  if (!it || it.deleted) return;
  touch(it, { deleted: true });
  for (const c of Object.values(doc.items)) if (c.parent === id && !c.deleted) touch(c, { deleted: true });
  if (it.parent) syncParent(doc, it.parent);
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
    .filter(i => !i.deleted && !i.parent && i.status === 'open' && isDayKey(i.list) && i.list < now)
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
    if (typeof raw.parent === 'string') it.parent = raw.parent;
    if (typeof raw.from === 'string') it.from = raw.from;
    if (typeof raw.fromId === 'string') it.fromId = raw.fromId;
    if (typeof raw.movedTo === 'string') it.movedTo = raw.movedTo;
    if (raw.deleted === true) it.deleted = true;
    items[id] = it;
  }
  return { version: 1, items };
}
