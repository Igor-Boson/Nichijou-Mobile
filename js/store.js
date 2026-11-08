// Estado do app + persistência no aparelho (localStorage).

import { emptyDoc, purge, sanitize, merge } from './model.js';

const DOC_KEY = 'nichijou:v1';
const META_KEY = 'nichijou:meta';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

function loadDoc() {
  const raw = read(DOC_KEY);
  if (!raw) return emptyDoc();
  try {
    return purge(sanitize(raw));
  } catch (_) {
    return emptyDoc();
  }
}

const listeners = new Set();
let doc = loadDoc();
let meta = { lastReview: null, token: null, gistId: null, login: null, lastSyncAt: null, ...(read(META_KEY) || {}) };
let saveFailed = false;

function emit(source) {
  for (const fn of listeners) fn(source);
}

export const store = {
  get doc() { return doc; },
  get meta() { return meta; },
  get saveFailed() { return saveFailed; },

  /** Aplica uma mudança local (fn recebe o doc) e salva. */
  update(fn) {
    fn(doc);
    saveFailed = !write(DOC_KEY, doc);
    emit('local');
  },

  /** Troca o doc inteiro (vindo da sincronização). */
  replace(next) {
    doc = next;
    saveFailed = !write(DOC_KEY, doc);
    emit('remote');
  },

  /** Mescla um backup importado com o que já existe. */
  importBackup(json) {
    const incoming = sanitize(json);
    const { doc: merged } = merge(doc, incoming);
    doc = merged;
    saveFailed = !write(DOC_KEY, doc);
    emit('local');
    return Object.values(incoming.items).filter(i => !i.deleted).length;
  },

  exportBackup() {
    return { app: 'nichijou', exportedAt: new Date().toISOString(), version: 1, items: doc.items };
  },

  setMeta(patch) {
    meta = { ...meta, ...patch };
    write(META_KEY, meta);
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
};

// Pede ao Safari para não apagar os dados por falta de espaço.
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}
