// Interface do 日常: renderização, gestos e folhas (menu, revisão da manhã, ajustes).

import * as M from './model.js';
import * as D from './dates.js';
import { store } from './store.js';
import { sync } from './sync.js';

const VERSION = '1.4.0';
const $app = document.getElementById('app');
const wide = window.matchMedia('(min-width: 820px)');

const UI = {
  now: D.today(),
  day: D.today(),
  view: 'day',            // iPhone: 'day' | 'dump'
  turn: '',
  sheet: null,            // { type: 'menu', id } | { type: 'review' } | { type: 'settings' }
  editing: null,
  expanded: new Set(),    // tarefas com as subtarefas abertas (só neste aparelho)
  reviewSel: {},
  reviewDrop: false,
  toast: null,
  drawId: null,
  connectError: null,
  connecting: false
};

/** Primeira letra maiúscula, sem estragar palavras como "iPhone". */
const capitalize = s => {
  const t = String(s).trimStart();
  return /^\p{Ll}(?!\p{Lu})/u.test(t) ? t[0].toLocaleUpperCase('pt-BR') + t.slice(1) : t;
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const doc = () => store.doc;
const isTablet = () => wide.matches;
const place = k => D.placeLabel(k, UI.now);

function toast(msg) {
  UI.toast = msg;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { UI.toast = null; render(); }, 2400);
  render();
}

function act(fn) { store.update(fn); } // store.update dispara render via subscribe

/* ---------- desenho das marcas (caneta) ---------- */
const BOX = 'M3.6 4.3 C8 3.7 14.6 3.9 19.7 3.5 C20.3 8.2 20.1 14 20.5 19.9 C14.2 20.4 8.6 20.1 3.9 20.5 C3.5 14.2 4 9 3.6 4.3Z';
const MARK = {
  done: 'M6.4 12.6 L10.3 16.6 L21.5 3.2',
  moved: 'M6 12.3 C10 12 14 12.2 18 12 M14 8 L18.6 12.1 L14.2 16.3',
  dropped: 'M6 12.6 C10 12.2 14 12.4 18.2 12.1'
};
const boxSvg = (status, draw) => {
  const m = MARK[status];
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="frame" d="${BOX}"/>${m ? `<path class="mark${draw ? ' draw' : ''}" d="${m}"/>` : ''}</svg>`;
};
const STATUS_LABEL = { open: 'pendente', done: 'feita', moved: 'adiada', dropped: 'riscada' };
const ARROW_BACK = '↩︎'; // ↩ como texto (sem virar emoji no iOS)

/* ---------- partes da tela ---------- */
// Caixinha marca; o "V" no fim da linha abre/fecha as subtarefas (sanfona). Subtarefas ficam recuadas.
function row(it, sub = false) {
  const cls = `row ${sub ? 'sub ' : ''}`;
  if (UI.editing === it.id) {
    return `<div class="${cls}" data-id="${it.id}"><div class="mnote"></div><div class="box">${boxSvg(it.status)}</div>
      <input class="edit" id="edit-${it.id}" data-edit="${it.id}" value="${esc(it.text)}" aria-label="Editar tarefa" enterkeyhint="done" autocomplete="off" autocapitalize="sentences"><span></span><span></span><span></span></div>`;
  }
  const note = !sub && it.from ? `${ARROW_BACK} ${place(it.from)}` : '';
  const tail = !sub && it.status === 'moved' && it.movedTo ? `<span class="tail">→ ${place(it.movedTo)}</span>` : '';
  const prog = sub ? '' : M.progress(doc(), it.id);
  const open = !sub && UI.expanded.has(it.id);
  const vLabel = `${open ? 'Fechar' : prog ? 'Abrir' : 'Adicionar'} subtarefas de ${esc(it.text)}`;
  const vbtn = sub ? '<span></span>' : `<button class="vbtn${prog ? ' has' : ''}${open ? ' open' : ''}" data-act="open" data-id="${it.id}" aria-expanded="${open}" aria-label="${vLabel}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6 8 10.5 12.5 6"/></svg></button>`;
  return `<div class="${cls}${it.status}" data-id="${it.id}" data-key="${it.id}">
    <div class="mnote">${note}</div>
    <span class="box" role="button" tabindex="0" data-act="check" data-id="${it.id}" aria-label="${esc(it.text)}: ${STATUS_LABEL[it.status]}. Marcar">${boxSvg(it.status, UI.drawId === it.id)}</span>
    <span class="txt">${esc(it.text)}${tail}</span>
    ${prog ? `<span class="prog">${prog}</span>` : '<span></span>'}${vbtn}
    <button class="more" data-act="more" data-id="${it.id}" aria-label="Opções de ${esc(it.text)}">⋯</button></div>`;
}

/** Tarefa principal + (se aberta) subtarefas e a linha para escrever mais uma. */
function group(it) {
  const open = UI.expanded.has(it.id);
  const subs = open ? M.children(doc(), it.id) : [];
  return `<div class="group" data-id="${it.id}" data-key="g:${it.id}">${row(it)}${open ? `<div class="subs" data-parent="${it.id}">${subs.map(c => row(c, true)).join('')}</div>${addSubRow(it.id)}` : ''}</div>`;
}

const addSubRow = pid => `<div class="add sub"><span class="plus" aria-hidden="true">+</span>
  <input id="sub-${pid}" data-subadd="${pid}" placeholder="subtarefa…" aria-label="Nova subtarefa" autocomplete="off" autocorrect="on" autocapitalize="sentences" enterkeyhint="enter"></div>`;

const addRow = list => `<div class="add"><span class="plus" aria-hidden="true">+</span>
  <input id="add-${list}" data-add="${list}" placeholder="${list === M.DUMP ? '…' : 'escreva aqui…'}" aria-label="Nova tarefa" autocomplete="off" autocorrect="on" autocapitalize="sentences" enterkeyhint="enter"></div>`;

function daySheet() {
  const k = UI.day, its = M.listItems(doc(), k);
  const rel = D.relative(k, UI.now);
  const firstUse = Object.keys(doc().items).length === 0;
  return `<section class="sheet" data-sheet="day" aria-label="Página do dia">
    <div class="sheet-inner ${UI.turn}">
      <div class="head">
        <div class="h1"><span class="printed">Data</span><span class="blank">${D.dmy(k)}</span></div>
        <div class="h2"><button class="nav" data-act="prev" aria-label="Dia anterior">‹</button>
          <button class="weekday" data-act="today" title="Voltar pra hoje">${D.weekday(k)}</button><span class="rel">${rel}</span><span></span>
          <button class="nav next" data-act="next" aria-label="Próximo dia">›</button></div>
      </div>
      <div class="list" data-list="${k}">${its.map(group).join('')}</div>
      <div class="empty" ${its.length ? 'hidden' : ''}>${k > UI.now ? 'folha em branco, planeja aqui' : k < UI.now ? 'nada anotado' : ''}</div>
      ${addRow(k)}
      ${firstUse && k === UI.now ? '<div class="hint">caixinha marca · V abre subtarefas · segure e arraste pra reordenar</div>' : ''}
    </div>
  </section>`;
}

function dumpSheet() {
  const its = M.listItems(doc(), M.DUMP);
  const open = its.filter(i => i.status === 'open').length;
  return `<section class="sheet" data-sheet="dump" aria-label="Dump">
    <div class="sheet-inner">
      <div class="head">
        <div class="h1"><span class="printed">Sem data</span><span class="blank">${open} ${open === 1 ? 'aberta' : 'abertas'}</span></div>
        <div class="h2"><span></span><span class="weekday">Dump</span><span></span><span></span><span></span></div>
      </div>
      <div class="list" data-list="dump">${its.map(group).join('')}</div>
      ${addRow(M.DUMP)}
    </div>
  </section>`;
}

function syncLabel() {
  if (!sync.connected) return ['off', 'só neste aparelho'];
  switch (sync.status) {
    case 'ok': return ['ok', 'sincronizado'];
    case 'syncing': case 'idle': return ['syncing', 'sincronizando…'];
    case 'offline': return ['offline', 'offline'];
    case 'error': return ['error', 'erro no sync'];
    default: return ['off', 'só neste aparelho'];
  }
}

const ICON = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/></svg>',
  page: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/></svg>',
  dump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13.5 6.6 6h10.8L20 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13.5h4.5l1.2 2.2h4.6l1.2-2.2H20"/></svg>'
};

function chrome() {
  const [s, label] = syncLabel();
  // no iPad os ajustes ficam na barra lateral
  return `<div class="chrome"><span class="brand">日常</span><span class="chrome-right">
    <button class="sync" data-act="settings" data-s="${s}"><span class="dot"></span>${label}</button>
    ${isTablet() ? '' : `<button class="gear" data-act="settings" aria-label="Ajustes: sincronizar, backup e ajuda">${ICON.gear}</button>`}
  </span></div>`;
}

function tabs() {
  return `<nav class="tabs" role="tablist">
    <button role="tab" data-act="tab-day" aria-selected="${UI.view === 'day'}"><span>Hoje</span></button>
    <button role="tab" data-act="tab-dump" aria-selected="${UI.view === 'dump'}"><span>Dump</span></button>
  </nav>`;
}

/** iPad: barra lateral fixa; uma página por vez. */
function rail() {
  return `<nav class="rail" aria-label="Páginas">
    <button data-act="tab-day" aria-current="${UI.view === 'day'}">${ICON.page}<span>Hoje</span></button>
    <button data-act="tab-dump" aria-current="${UI.view === 'dump'}">${ICON.dump}<span>Dump</span></button>
    <span class="rail-space"></span>
    <button data-act="settings" aria-label="Ajustes: sincronizar, backup e ajuda">${ICON.gear}<span>Ajustes</span></button>
  </nav>`;
}

function menuPanel(it) {
  const inDump = it.list === M.DUMP;
  const b = (a, g, label, cls = '') => `<button data-act="${a}" data-id="${it.id}" class="${cls}"><span class="g">${g}</span>${label}</button>`;
  const list = [];
  const parent = it.parent && doc().items[it.parent];
  if (parent) {
    // subtarefa: vai e vem junto com a principal; aqui só conclui, risca, edita ou exclui
    if (it.status === 'open') { list.push(b('m-done', '✓', 'Concluir')); list.push(b('m-drop', '—', 'Riscar')); }
    else list.push(b('m-restore', '↺', 'Voltar a pendente'));
    list.push(b('m-edit', '✎', 'Editar texto'));
    list.push(b('m-del', '×', 'Excluir', 'danger'));
    return `<p class="muted">Subtarefa de “${esc(parent.text)}” · ${STATUS_LABEL[it.status]}</p>
      <div class="quote">${esc(it.text)}</div><div class="actions">${list.join('')}</div>`;
  }
  if (it.status === 'open') {
    list.push(b('m-done', '✓', 'Concluir'));
    if (inDump) list.push(b('m-today', '↑', 'Puxar pra hoje'));
    else {
      const to = M.postponeTarget(it, UI.now);
      const label = to === UI.now ? 'Trazer pra hoje' : to === D.addDays(UI.now, 1) ? 'Adiar pra amanhã' : `Passar pra ${D.dm(to)}`;
      list.push(b('m-post', '→', label));
    }
    list.push(b('m-drop', '—', 'Riscar'));
    if (!inDump) list.push(b('m-dump', '↓', 'Mandar pro dump'));
  } else {
    list.push(b('m-restore', '↺', it.status === 'moved' ? 'Desfazer adiamento' : 'Voltar a pendente'));
  }
  list.push(b('m-edit', '✎', 'Editar texto'));
  list.push(b('m-del', '×', 'Excluir', 'danger'));
  return `<p class="muted">${inDump ? 'Dump' : (D.relative(it.list, UI.now) || D.dm(it.list))} · ${STATUS_LABEL[it.status]}</p>
    <div class="quote">${esc(it.text)}</div><div class="actions">${list.join('')}</div>`;
}

function reviewPanel() {
  const p = M.pending(doc(), UI.now);
  if (!p.length) return `<h2>Bom dia</h2><p>Nada ficou pendente. Folha nova, pode escrever.</p><div class="btn-row"><button class="btn" data-act="rv-close">Começar o dia</button></div>`;
  const anyOff = p.some(i => UI.reviewSel[i.id] === false);
  return `<h2>Bom dia</h2><p>Sobraram ${p.length} ${p.length === 1 ? 'coisa' : 'coisas'} dos dias anteriores. O que vem pra hoje?</p>
    <div class="rv">${p.map(it => {
      const on = UI.reviewSel[it.id] !== false;
      return `<label class="${on ? '' : 'off'}"><input type="checkbox" id="rv-${it.id}" data-rv="${it.id}" ${on ? 'checked' : ''}><span class="box">${boxSvg(on ? 'moved' : 'open')}</span><span class="txt">${esc(it.text)}</span><span class="from">${place(it.list)}</span></label>`;
    }).join('')}</div>
    ${anyOff ? `<label class="opt"><input type="checkbox" id="rv-drop" ${UI.reviewDrop ? 'checked' : ''}>Riscar as que ficaram desmarcadas</label>` : '<p class="muted" style="margin-top:12px">Desmarque o que não vem. O que ficar de fora continua no dia original.</p>'}
    <div class="btn-row two"><button class="btn ghost" data-act="rv-close">Agora não</button><button class="btn" data-act="rv-go">Trazer pra hoje</button></div>`;
}

function settingsPanel() {
  const m = store.meta;
  let syncBlock;
  if (sync.connected) {
    const [s] = syncLabel();
    const when = m.lastSyncAt ? new Date(m.lastSyncAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
    const state = s === 'error' ? esc(sync.error || 'erro') : s === 'syncing' ? 'sincronizando…' : s === 'offline' ? `offline · última às ${when}` : `última sincronização às ${when}`;
    syncBlock = `<div class="conn" data-s="${s}"><span class="dot"></span><span style="flex:1;min-width:0">Conectado${m.login ? ` como <b>${esc(m.login)}</b>` : ''}<br><span class="muted">${state}</span></span></div>
      <div class="btn-row two"><button class="btn ghost" data-act="disconnect">Desconectar</button><button class="btn" data-act="sync-now">Sincronizar agora</button></div>
      ${m.gistId ? `<p class="muted" style="margin-top:10px">Dados no gist secreto <a href="https://gist.github.com/${esc(m.gistId)}" target="_blank" rel="noopener">${GIST_SHORT(m.gistId)}</a>.</p>` : ''}`;
  } else {
    syncBlock = `<p>Mantém iPhone e iPad com o mesmo caderno usando um gist secreto na sua conta do GitHub. Custo zero.</p>
      <textarea class="field" id="token" rows="2" placeholder="cole aqui o token (github_pat_…)" aria-label="Token do GitHub" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
      ${UI.connectError ? `<p class="err">${esc(UI.connectError)}</p>` : ''}
      <div class="btn-row"><button class="btn" data-act="connect" ${UI.connecting ? 'disabled' : ''}>${UI.connecting ? 'Conectando…' : 'Conectar'}</button></div>
      <details><summary>Como criar o token (1 minuto)</summary><ol class="steps">
        <li>Abra <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a> (Settings → Developer settings → Fine-grained tokens).</li>
        <li>Nome: “日常”. Validade: a maior que quiser (dá pra escolher “No expiration”).</li>
        <li>Em <b>Permissions → Account</b>, adicione só <b>Gists: Read and write</b>.</li>
        <li>Gere, copie e cole aqui. No outro aparelho, cole o mesmo token.</li></ol>
        <p class="muted">Gist secreto não aparece em lugar nenhum, mas quem tiver o link exato consegue ler. Ok pra tarefas; não anote senhas.</p></details>`;
  }
  const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  const theme = m.theme || 'system';
  const tb = (v, label) => `<button data-act="theme" data-id="${v}" aria-pressed="${theme === v}">${label}</button>`;
  return `<h2>Caderno</h2>
    <h3>Aparência</h3><div class="seg" role="group" aria-label="Tema">${tb('system', 'Sistema')}${tb('light', 'Claro')}${tb('dark', 'Escuro')}</div>
    <h3>Sincronizar iPhone e iPad</h3>${syncBlock}
    <h3>Backup</h3><p class="muted">Um arquivo com tudo. No iPhone, abre o Compartilhar pra salvar no Arquivos/iCloud. Importar junta o backup com o que já está aqui.</p>
    <div class="btn-row two"><button class="btn ghost" data-act="export">Exportar</button><button class="btn ghost" data-act="import">Importar</button></div>
    <h3>Lembrete diário</h3><p class="muted">Pelo app Atalhos, sem servidor:</p>
    <ol class="steps"><li>Atalhos → <b>Automação</b> → <b>+</b> → <b>Hora do Dia</b>: 8:00, Diariamente.</li><li>Escolha <b>Executar Imediatamente</b>.</li><li>Ação <b>Mostrar Notificação</b>: “Monte sua página de hoje”.</li></ol>
    ${standalone ? '' : '<h3>Instalar</h3><p class="muted">No Safari: Compartilhar → <b>Adicionar à Tela de Início</b>. Abre como app, sem barra do navegador, e funciona offline.</p>'}
    ${store.saveFailed ? '<p class="err">Atenção: o aparelho não conseguiu salvar a última mudança (armazenamento cheio?). Exporte um backup.</p>' : ''}
    <div class="btn-row"><button class="btn ghost" data-act="close">Fechar</button></div>
    <p class="foot">日常 ${VERSION}</p>`;
}
const GIST_SHORT = id => esc(id.slice(0, 7)) + '…';

function overlay() {
  const sh = UI.sheet;
  if (!sh) return '';
  let body = '';
  if (sh.type === 'menu') {
    const it = doc().items[sh.id];
    if (!it || it.deleted) { UI.sheet = null; return ''; }
    body = menuPanel(it);
  } else if (sh.type === 'review') body = reviewPanel();
  else if (sh.type === 'settings') body = settingsPanel();
  const center = sh.type === 'menu';
  return `<div class="overlay${center ? ' center' : ''}" data-act="scrim"><div class="panel" role="dialog" aria-modal="true">${center ? '' : '<div class="grab"></div>'}${body}</div></div>`;
}

/* ---------- render ---------- */
// Enquanto você digita, o campo não pode ser recriado (no iPhone o teclado fecharia).
// Então, com um campo de escrita focado, só as listas, o topo e as abas são atualizados.
let lastLayout = '';
let deferred = false;
const layoutKey = () => `${isTablet()}|${UI.view}|${UI.day}|${UI.sheet ? UI.sheet.type : ''}|${UI.editing || ''}`;

function render() {
  if (G && G.lifted) { deferred = true; return; }
  const ae = document.activeElement;
  const typingAdd = ae && $app.contains(ae) && ae.matches('[data-add]');
  const typingEdit = ae && $app.contains(ae) && ae.matches('[data-edit]') && UI.editing;
  const typingSub = ae && $app.contains(ae) && ae.matches('[data-subadd]');
  if (typingEdit) { softRender(false); deferred = true; return; }
  // escrevendo subtarefas: só a tarefa em questão é redesenhada; a reordenação da página espera o fim
  if (typingSub && layoutKey() === lastLayout) { softRender(false); softRenderGroup(ae.dataset.subadd); deferred = true; return; }
  if (typingAdd && layoutKey() === lastLayout && !UI.turn) { softRender(true); return; }
  fullRender();
}

function softRender(lists) {
  const c = $app.querySelector('.chrome');
  if (c) c.outerHTML = chrome();
  const t = $app.querySelector('.tabs');
  if (t) t.outerHTML = tabs();
  const r = $app.querySelector('.rail');
  if (r) r.outerHTML = rail();
  if (lists) {
    $app.querySelectorAll('.sheet').forEach(s => {
      const list = s.querySelector('.list');
      const its = M.listItems(doc(), list.dataset.list);
      list.innerHTML = its.map(group).join('');
      const empty = s.querySelector('.empty');
      if (empty) empty.hidden = its.length > 0;
      if (s.dataset.sheet === 'dump') {
        const open = its.filter(i => i.status === 'open').length;
        const b = s.querySelector('.blank');
        if (b) b.textContent = `${open} ${open === 1 ? 'aberta' : 'abertas'}`;
      }
    });
  }
  $app.querySelector('.toast')?.remove();
  if (UI.toast) $app.insertAdjacentHTML('beforeend', `<div class="toast" role="status">${esc(UI.toast)}</div>`);
  UI.drawId = null;
}

function softRenderGroup(pid) {
  const g = $app.querySelector(`.group[data-id="${CSS.escape(pid)}"]`);
  const it = doc().items[pid];
  if (!g || !it) return;
  const main = g.querySelector(':scope > .row');
  if (main) main.outerHTML = row(it);
  const subs = g.querySelector(':scope > .subs');
  if (subs) subs.innerHTML = M.children(doc(), pid).map(c => row(c, true)).join('');
}

function fullRender() {
  deferred = false;
  // FLIP: na mesma página, linhas que mudam de lugar (ordem automática) deslizam até a nova posição
  const animate = layoutKey() === lastLayout && !UI.turn && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = {};
  if (animate) $app.querySelectorAll('.list [data-key]').forEach(el => { before[el.dataset.key] = el.getBoundingClientRect().top; });
  lastLayout = layoutKey();
  const scroll = {};
  $app.querySelectorAll('.sheet').forEach(s => { scroll[s.dataset.sheet] = s.scrollTop; });
  const ae = document.activeElement;
  const focusId = ae && $app.contains(ae) && ae.id ? ae.id : null;
  const caret = focusId && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null;
  const panelScroll = $app.querySelector('.panel')?.scrollTop || 0;
  const tokenVal = $app.querySelector('#token')?.value || '';
  const addVals = {};
  $app.querySelectorAll('[data-add], [data-subadd]').forEach(i => { if (i.value) addVals[i.id] = i.value; });
  const editVal = UI.editing ? $app.querySelector(`#edit-${CSS.escape(UI.editing)}`)?.value : null;

  const tablet = isTablet();
  $app.className = tablet ? 'tablet' : 'phone';
  const page = UI.view === 'day' ? daySheet() : dumpSheet();
  $app.innerHTML = `${chrome()}<div class="pages">${tablet ? rail() : ''}${page}</div>${tablet ? '' : tabs()}${overlay()}${UI.toast ? `<div class="toast" role="status">${esc(UI.toast)}</div>` : ''}`;

  $app.querySelectorAll('.sheet').forEach(s => { if (scroll[s.dataset.sheet] != null && !(UI.turn && s.dataset.sheet === 'day')) s.scrollTop = scroll[s.dataset.sheet]; });
  const p = $app.querySelector('.panel');
  if (p) p.scrollTop = panelScroll;
  const tk = $app.querySelector('#token');
  if (tk) tk.value = tokenVal;
  for (const [id, v] of Object.entries(addVals)) { const el = $app.querySelector('#' + CSS.escape(id)); if (el) el.value = v; }
  if (UI.editing) {
    const e = $app.querySelector(`#edit-${CSS.escape(UI.editing)}`);
    if (e) {
      if (editVal != null) e.value = editVal;
      if (document.activeElement !== e) { e.focus({ preventScroll: false }); e.setSelectionRange(e.value.length, e.value.length); }
    }
  } else if (focusId) {
    const f = $app.querySelector('#' + CSS.escape(focusId));
    if (f) {
      f.focus({ preventScroll: true });
      if (caret && f.setSelectionRange) try { f.setSelectionRange(caret[0], caret[1]); } catch (_) {}
    }
  }
  if (animate) {
    $app.querySelectorAll('.list [data-key]').forEach(el => {
      const old = before[el.dataset.key];
      if (old == null) return;
      const dy = old - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform .35s cubic-bezier(.2,.8,.2,1)';
        el.style.transform = '';
        el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
      });
    });
  }
  UI.turn = '';
  UI.drawId = null;
}

/* ---------- navegação ---------- */
function goDay(n) {
  UI.day = D.addDays(UI.day, n);
  UI.turn = n > 0 ? 'turn-next' : 'turn-prev';
  UI.editing = null;
  render();
}

/* ---------- revisão da manhã / virada do dia ---------- */
let reviewChecking = false;
async function maybeReview() {
  if (reviewChecking || store.meta.lastReview === UI.now) return;
  reviewChecking = true;
  try {
    await sync.ready(); // evita trazer a mesma tarefa duas vezes (iPhone e iPad)
    if (store.meta.lastReview === UI.now) return;
    if (M.pending(doc(), UI.now).length === 0) { store.setMeta({ lastReview: UI.now }); return; }
    if (UI.sheet) return; // tenta de novo na próxima abertura
    UI.reviewSel = {};
    UI.reviewDrop = false;
    UI.sheet = { type: 'review' };
    render();
  } finally {
    reviewChecking = false;
  }
}

function checkDayChange() {
  const t = D.today();
  if (t === UI.now) return;
  const wasToday = UI.day === UI.now;
  UI.now = t;
  if (wasToday) UI.day = t;
  render();
  maybeReview();
}

/* ---------- gestos: tocar, segurar e arrastar, deslizar ---------- */
let G = null;
// Depois de um gesto (arrastar/deslizar) o navegador ainda manda um clique: descartamos só esse.
let suppressUntil = 0;
const suppressClick = () => { suppressUntil = Date.now() + 350; };

$app.addEventListener('pointerdown', e => {
  if (e.button > 0 || UI.sheet) return;
  const sheet = e.target.closest('.sheet');
  if (!sheet) return;
  if (e.target.closest('input,textarea,button')) return;
  const r = e.target.closest('.row[data-id]');
  // arrasta a tarefa inteira (com as subtarefas) ou só a subtarefa, entre as irmãs
  const el = r && !UI.editing ? (r.classList.contains('sub') ? r : r.closest('.group')) : null;
  G = { x: e.clientX, y: e.clientY, row: el, sheet, lifted: false, dragged: false, t: null };
  if (G.row) G.t = setTimeout(lift, 420);
});

function lift() {
  if (!G) return;
  G.lifted = true;
  G.row.classList.add('lifted');
  G.rows = [...G.row.parentNode.children].filter(c => c.matches('.group, .row[data-id]'));
  G.idx = G.rows.indexOf(G.row);
  G.rects = G.rows.map(r => r.getBoundingClientRect());
  G.h = G.rects[G.idx].height;
  G.newIdx = G.idx;
  try { navigator.vibrate && navigator.vibrate(8); } catch (_) {}
}

window.addEventListener('pointermove', e => {
  if (!G) return;
  const dx = e.clientX - G.x, dy = e.clientY - G.y;
  if (!G.lifted) { if (Math.hypot(dx, dy) > 8) clearTimeout(G.t); return; }
  e.preventDefault();
  if (Math.abs(dy) > 5) G.dragged = true;
  G.row.style.transform = `translateY(${dy}px) scale(1.02)`;
  // troca quando a borda da linha arrastada passa do meio da vizinha
  const top = G.rects[G.idx].top + dy, bottom = top + G.h;
  let ni = G.idx;
  G.rows.forEach((r, i) => {
    if (i === G.idx) return;
    const mid = G.rects[i].top + G.rects[i].height / 2;
    if (i > G.idx && bottom > mid) { r.style.transform = `translateY(${-G.h}px)`; ni = Math.max(ni, i); }
    else if (i < G.idx && top < mid) { r.style.transform = `translateY(${G.h}px)`; ni = Math.min(ni, i); }
    else r.style.transform = '';
  });
  G.newIdx = ni;
}, { passive: false });

$app.addEventListener('touchmove', e => { if (G && G.lifted) e.preventDefault(); }, { passive: false });
$app.addEventListener('contextmenu', e => { if (e.target.closest('.row')) e.preventDefault(); });

window.addEventListener('pointerup', e => {
  if (!G) return;
  const g = G; G = null;
  clearTimeout(g.t);
  const dx = e.clientX - g.x, dy = e.clientY - g.y;
  if (g.lifted) {
    suppressClick();
    g.rows.forEach(r => { r.style.transform = ''; });
    g.row.classList.remove('lifted');
    if (g.dragged && g.newIdx !== g.idx) {
      const ids = g.rows.map(r => r.dataset.id);
      const [moved] = ids.splice(g.idx, 1);
      ids.splice(g.newIdx, 0, moved);
      act(d => M.reorder(d, ids));
    } else if (deferred) render();
    return;
  }
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    suppressClick();
    if (g.sheet.dataset.sheet === 'day') goDay(dx < 0 ? 1 : -1);
    return;
  }
  if (Math.hypot(dx, dy) > 10) suppressClick();
});

window.addEventListener('pointercancel', () => {
  if (!G) return;
  clearTimeout(G.t);
  if (G.lifted) { G.rows.forEach(r => { r.style.transform = ''; }); G.row.classList.remove('lifted'); }
  G = null;
});

/* ---------- cliques e teclado ---------- */
$app.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  // botões nunca são ambíguos; só um toque solto na linha logo após um gesto é descartado
  if (Date.now() < suppressUntil) {
    suppressUntil = 0;
    if (!t || t.dataset.act === 'scrim' || (t.closest('.row') && !t.matches('.more, .vbtn'))) return;
  }
  if (t && !(t.dataset.act === 'scrim' && e.target !== t)) onAction(t.dataset.act, t.dataset.id);
});

$app.addEventListener('keydown', e => {
  const add = e.target.closest('[data-add]');
  if (add && e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    const list = add.dataset.add, text = capitalize(add.value);
    if (!text.trim()) return;
    add.value = '';
    // iPhone: depois de limpar o campo por código o teclado não religa o Shift.
    // Tirar e devolver o foco no mesmo toque faz ele recomeçar a frase.
    add.blur();
    add.focus();
    act(d => M.addItem(d, list, text));
    const n = $app.querySelector(`#add-${CSS.escape(list)}`);
    if (n) { n.focus(); n.scrollIntoView({ block: 'nearest' }); }
    return;
  }
  const sub = e.target.closest('[data-subadd]');
  if (sub && e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    const pid = sub.dataset.subadd, text = capitalize(sub.value);
    if (!text.trim()) { sub.blur(); return; } // Enter vazio: terminou
    sub.value = '';
    sub.blur();
    sub.focus();
    act(d => M.addSub(d, pid, text));
    $app.querySelector(`#sub-${CSS.escape(pid)}`)?.scrollIntoView({ block: 'nearest' });
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed && (e.key === 'Enter' || e.key === 'Escape') && !e.isComposing) {
    e.preventDefault();
    const id = ed.dataset.edit, text = ed.value;
    UI.editing = null;
    if (e.key === 'Enter') act(d => M.editItem(d, id, text)); else render();
    return;
  }
  const rb = e.target.closest('[role="button"][data-act]');
  if (rb && e.target === rb && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onAction(rb.dataset.act, rb.dataset.id); return; }
  if (e.key === 'Escape' && UI.sheet) { closeSheet(); }
});

$app.addEventListener('focusout', e => {
  const ed = e.target.closest && e.target.closest('[data-edit]');
  if (ed && UI.editing === ed.dataset.edit) {
    const id = ed.dataset.edit, text = ed.value;
    UI.editing = null;
    setTimeout(() => act(d => M.editItem(d, id, text)), 0);
    return;
  }
  // saiu da linha de subtarefa sem escrever nada numa tarefa sem subtarefas: fecha a sanfona
  const sa = e.target.closest && e.target.closest('[data-subadd]');
  if (sa && !sa.value.trim()) {
    const pid = sa.dataset.subadd;
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a.matches && a.matches(`#sub-${CSS.escape(pid)}`)) return;
      if (!M.children(doc(), pid).length && UI.expanded.delete(pid)) render();
      else if (deferred) render();
    }, 150);
    return;
  }
  // terminou de digitar: aplica o que ficou adiado
  if (deferred) setTimeout(() => { const a = document.activeElement; if (!(a && $app.contains(a) && a.matches('input,textarea'))) render(); }, 0);
});

$app.addEventListener('change', e => {
  const rv = e.target.closest('[data-rv]');
  if (rv) { UI.reviewSel[rv.dataset.rv] = rv.checked; render(); }
  if (e.target.id === 'rv-drop') UI.reviewDrop = e.target.checked;
});

function closeSheet() {
  if (UI.sheet?.type === 'review') store.setMeta({ lastReview: UI.now });
  UI.sheet = null;
  UI.connectError = null;
  render();
}

async function onAction(a, id) {
  const close = () => { UI.sheet = null; };
  switch (a) {
    case 'prev': return goDay(-1);
    case 'next': return goDay(1);
    case 'today':
      if (UI.day !== UI.now) { const n = UI.day < UI.now ? 1 : -1; UI.day = UI.now; UI.turn = n > 0 ? 'turn-next' : 'turn-prev'; }
      break;
    case 'tab-day': UI.view = 'day'; break;
    case 'tab-dump': UI.view = 'dump'; break;
    case 'settings': UI.sheet = { type: 'settings' }; break;
    case 'more': UI.sheet = { type: 'menu', id }; break;
    case 'check':
      if (doc().items[id]?.status === 'open') UI.drawId = id;
      return act(d => M.toggle(d, id));
    case 'open': {
      // o V abre/fecha as subtarefas; sem subtarefas, já abre a linha para escrever a primeira
      if (UI.expanded.has(id)) { UI.expanded.delete(id); break; }
      UI.expanded.add(id);
      render();
      if (!M.children(doc(), id).length) $app.querySelector(`#sub-${CSS.escape(id)}`)?.focus();
      return;
    }
    case 'scrim': case 'close': case 'rv-close': return closeSheet();
    case 'm-done': close(); return act(d => { UI.drawId = id; M.setStatus(d, id, 'done'); });
    case 'm-post': {
      close();
      const it = doc().items[id], to = M.postponeTarget(it, UI.now);
      act(d => M.postpone(d, id, UI.now));
      return toast(to === UI.now ? 'Trazida pra hoje' : `Adiada pra ${place(to)}`);
    }
    case 'm-drop': close(); return act(d => M.setStatus(d, id, 'dropped'));
    case 'm-dump': close(); act(d => M.toDump(d, id)); return toast('Foi pro dump');
    case 'm-today': close(); act(d => M.toDay(d, id, UI.now)); return toast('Puxada pra hoje');
    case 'm-restore': close(); return act(d => M.restore(d, id));
    case 'm-edit': close(); UI.editing = id; break;
    case 'm-del': {
      close();
      const withSubs = M.children(doc(), id).length > 0;
      act(d => M.removeItem(d, id));
      return toast(withSubs ? 'Excluída, com as subtarefas' : 'Excluída');
    }
    case 'rv-go': {
      const p = M.pending(doc(), UI.now);
      const bring = p.filter(i => UI.reviewSel[i.id] !== false).map(i => i.id);
      store.setMeta({ lastReview: UI.now });
      close();
      UI.day = UI.now;
      UI.view = 'day';
      act(d => M.review(d, bring, UI.reviewDrop, UI.now));
      return toast(bring.length ? `${bring.length} ${bring.length === 1 ? 'tarefa trazida' : 'tarefas trazidas'} pra hoje` : 'Ok, nada trazido');
    }
    case 'connect': {
      const token = $app.querySelector('#token')?.value || '';
      UI.connecting = true; UI.connectError = null; render();
      try {
        await sync.connect(token);
        UI.connecting = false;
        toast('Conectado. Sincronizando com o GitHub.');
      } catch (err) {
        UI.connecting = false;
        UI.connectError = err.message || 'Não deu pra conectar.';
      }
      break;
    }
    case 'theme': store.setMeta({ theme: id === 'system' ? null : id }); applyTheme(); break;
    case 'disconnect': sync.disconnect(); toast('Desconectado. Os dados continuam neste aparelho.'); return;
    case 'sync-now': sync.now(); break;
    case 'export': return exportBackup();
    case 'import': return pickImport();
  }
  render();
}

/* ---------- backup ---------- */
async function exportBackup() {
  const name = `nichijou-backup-${UI.now}.json`;
  const blob = new Blob([JSON.stringify(store.exportBackup(), null, 1)], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: '日常 backup' });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Backup baixado');
}

function pickImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      const n = store.importBackup(JSON.parse(await f.text()));
      toast(`Backup importado (${n} ${n === 1 ? 'tarefa' : 'tarefas'})`);
    } catch (err) {
      toast(err.message && err.message.includes('日常') ? err.message : 'Esse arquivo não é um backup válido.');
    }
  };
  input.click();
}

/* ---------- tema ---------- */
const PAPER = { light: '#efe5d0', dark: '#27221c' };
function applyTheme() {
  const t = store.meta.theme;
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    const own = m.media.includes('dark') ? PAPER.dark : PAPER.light;
    m.content = t === 'light' || t === 'dark' ? PAPER[t] : own;
  });
}

/* ---------- início ---------- */
applyTheme();
store.subscribe(() => render());
sync.subscribe(() => render());
wide.addEventListener('change', () => render());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkDayChange(); });
setInterval(checkDayChange, 60 * 1000);

render();
sync.start();
maybeReview();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    // só recarrega se não estiver no meio de uma digitação
    const busy = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.value;
    if (!busy) location.reload();
  });
}
