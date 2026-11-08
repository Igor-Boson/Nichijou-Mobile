// Sincronização iPhone ↔ iPad por um gist secreto na conta do GitHub.
//
// - O token fica só no aparelho (localStorage) e só fala com api.github.com.
// - Cada sincronização: lê o gist, mescla item a item com o que está aqui, salva o resultado
//   nos dois lados se algo mudou.
// - Usa ETag: quando nada mudou no gist, o GitHub responde 304 e não gasta limite.

import { store } from './store.js';
import { merge, purge, sanitize } from './model.js';

const API = 'https://api.github.com';
export const GIST_FILE = 'nichijou.json';
const GIST_DESC = '日常 · caderno diário (sincronização do app)';
const DEBOUNCE_MS = 2500;
const POLL_MS = 30000;

let status = store.meta.token ? 'idle' : 'off'; // off | idle | syncing | ok | offline | error
let error = null;
let running = null;
let again = false;
let dirty = false;
let etag = null;
let remoteCache = null;
let debounceT = null;
let firstDone = false;
let firstResolve;
const firstSync = new Promise(r => { firstResolve = r; });
const listeners = new Set();

function set(s, err = null) {
  status = s;
  error = err;
  for (const fn of listeners) fn();
}

class GitHubError extends Error {
  constructor(message, httpStatus) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

async function gh(token, path, { method = 'GET', body, headers = {}, keepalive = false } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      cache: 'no-store',
      keepalive,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (_) {
    throw new GitHubError('Sem conexão.', 0);
  }
  if (res.status === 304) return { notModified: true, res };
  if (!res.ok) {
    let msg = `GitHub respondeu ${res.status}.`;
    if (res.status === 401) msg = 'Token inválido ou expirado. Gere outro e conecte de novo.';
    else if (res.status === 403) msg = 'O token não tem permissão de Gists (ou o limite do GitHub estourou).';
    else if (res.status === 404) msg = 'Gist não encontrado.';
    throw new GitHubError(msg, res.status);
  }
  const data = res.status === 204 ? null : await res.json();
  return { data, res };
}

const serialize = doc => JSON.stringify({ app: 'nichijou', version: 1, items: doc.items });

async function findGist(token) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await gh(token, `/gists?per_page=100&page=${page}`);
    const hit = data.find(g => g.files && g.files[GIST_FILE]);
    if (hit) return hit.id;
    if (data.length < 100) break;
  }
  return null;
}

async function createGist(token, doc) {
  const { data } = await gh(token, '/gists', {
    method: 'POST',
    body: { description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: serialize(doc) } } }
  });
  return data.id;
}

async function readGist(token, id) {
  const { data, res, notModified } = await gh(token, `/gists/${id}`, etag && remoteCache ? { headers: { 'If-None-Match': etag } } : {});
  if (notModified) return remoteCache;
  const file = data.files && data.files[GIST_FILE];
  if (!file) throw new GitHubError('O gist existe mas não tem o arquivo do caderno.', 404);
  let content = file.content;
  if (file.truncated) content = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
  const doc = sanitize(JSON.parse(content));
  etag = res.headers.get('ETag');
  remoteCache = doc;
  return doc;
}

async function writeGist(token, id, doc) {
  const content = serialize(doc);
  const { res } = await gh(token, `/gists/${id}`, {
    method: 'PATCH',
    body: { files: { [GIST_FILE]: { content } } },
    keepalive: document.visibilityState === 'hidden' && content.length < 60000
  });
  // A ETag do PATCH pode não bater com a do GET; no pior caso o próximo GET vem completo.
  etag = res.headers.get('ETag');
  remoteCache = sanitize(JSON.parse(content));
}

async function runSync() {
  const { token } = store.meta;
  let { gistId } = store.meta;
  if (!token) { set('off'); return; }
  if (!navigator.onLine) { set('offline'); return; }
  set('syncing');
  try {
    if (!gistId) {
      gistId = (await findGist(token)) || (await createGist(token, store.doc));
      store.setMeta({ gistId });
    }
    let remote;
    try {
      remote = await readGist(token, gistId);
    } catch (e) {
      if (e.httpStatus !== 404) throw e;
      // gist apagado no GitHub: cria outro com o que está aqui
      etag = null; remoteCache = null;
      gistId = (await findGist(token)) || (await createGist(token, store.doc));
      store.setMeta({ gistId });
      remote = await readGist(token, gistId);
    }
    // ponto de sincronização: mescla com o estado local *atual*
    dirty = false;
    const { doc, changedA, changedB } = merge(store.doc, remote);
    purge(doc);
    if (changedA) store.replace(doc);
    if (changedB) await writeGist(token, gistId, doc);
    store.setMeta({ lastSyncAt: Date.now() });
    set('ok');
  } catch (e) {
    if (e.httpStatus === 0) set('offline');
    else set('error', e.message || 'Erro ao sincronizar.');
  }
}

export const sync = {
  get status() { return status; },
  get error() { return error; },
  get connected() { return !!store.meta.token; },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Sincroniza agora; se já estiver rodando, agenda mais uma rodada no fim. */
  now() {
    if (running) { again = true; return running; }
    running = runSync().finally(() => {
      running = null;
      if (!firstDone) { firstDone = true; firstResolve(); }
      if (again || dirty) { again = false; if (store.meta.token && status !== 'error') sync.soon(); }
    });
    return running;
  },

  soon(ms = DEBOUNCE_MS) {
    clearTimeout(debounceT);
    debounceT = setTimeout(() => sync.now(), ms);
  },

  /** Resolve após a primeira sincronização (ou após `timeout` ms). */
  ready(timeout = 4000) {
    if (!store.meta.token || !navigator.onLine) return Promise.resolve();
    return Promise.race([firstSync, new Promise(r => setTimeout(r, timeout))]);
  },

  /** Valida o token, acha (ou cria) o gist e sincroniza. */
  async connect(token) {
    token = String(token || '').trim();
    if (!token) throw new Error('Cole o token primeiro.');
    if (!navigator.onLine) throw new Error('Sem internet agora. Tente quando estiver online.');
    set('syncing');
    try {
      const { data: user } = await gh(token, '/user');
      const gistId = (await findGist(token)) || (await createGist(token, store.doc));
      etag = null; remoteCache = null;
      store.setMeta({ token, gistId, login: user && user.login });
    } catch (e) {
      set(store.meta.token ? 'error' : 'off', e.message);
      throw e;
    }
    await sync.now();
    if (status === 'error') throw new Error(error);
  },

  disconnect() {
    store.setMeta({ token: null, gistId: null, login: null, lastSyncAt: null });
    etag = null; remoteCache = null;
    set('off');
  },

  start() {
    store.subscribe(source => {
      if (source !== 'local' || !store.meta.token) return;
      dirty = true;
      sync.soon();
    });
    document.addEventListener('visibilitychange', () => {
      if (!store.meta.token) return;
      if (document.visibilityState === 'visible') sync.now();
      else if (dirty) { clearTimeout(debounceT); sync.now(); }
    });
    window.addEventListener('online', () => store.meta.token && sync.now());
    window.addEventListener('offline', () => store.meta.token && set('offline'));
    setInterval(() => {
      if (store.meta.token && document.visibilityState === 'visible') sync.now();
    }, POLL_MS);
    if (store.meta.token) sync.now();
    else { firstDone = true; firstResolve(); }
  }
};
