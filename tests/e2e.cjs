// Teste ponta a ponta no navegador (iPhone e iPad emulados), com um GitHub simulado.
// Rodar: npm run e2e   (precisa de Playwright instalado)
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..');
const PORT = 8765;
const URL = `http://localhost:${PORT}/`;
const SHOTS = path.join(__dirname, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });

const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = keyOf(new Date());
const YDAY = keyOf(new Date(Date.now() - 86400000));
const TOMORROW = keyOf(new Date(Date.now() + 86400000));

/* ---------- GitHub simulado ---------- */
const gh = { gist: null, etag: 1, calls: [], history: [] };
const saveRevision = () => gh.history.unshift({ version: `v${gh.history.length + 1}`, committed_at: new Date().toISOString(), content: gh.gist.content });
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag'
};
async function githubRoute(route) {
  const req = route.request();
  const u = new globalThis.URL(req.url());
  const method = req.method();
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  gh.calls.push(`${method} ${u.pathname}`);
  const json = (status, body, extra = {}) => route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  if ((req.headers()['authorization'] || '') !== 'Bearer test-token') return json(401, { message: 'Bad credentials' });
  if (u.pathname === '/user') return json(200, { login: 'igor-boson' });
  if (u.pathname === '/gists' && method === 'GET') return json(200, gh.gist ? [{ id: gh.gist.id, files: { 'nichijou.json': {} } }] : []);
  if (u.pathname === '/gists' && method === 'POST') {
    const body = JSON.parse(req.postData());
    gh.gist = { id: 'g1', content: body.files['nichijou.json'].content };
    saveRevision();
    gh.etag++;
    return json(201, { id: 'g1' });
  }
  if (u.pathname === '/gists/g1' && method === 'GET') {
    const tag = `"e${gh.etag}"`;
    if (req.headers()['if-none-match'] === tag) return route.fulfill({ status: 304, headers: { ...CORS, ETag: tag } });
    return json(200, { id: 'g1', files: { 'nichijou.json': { content: gh.gist.content, truncated: false } }, history: gh.history.map(h => ({ version: h.version, committed_at: h.committed_at })) }, { ETag: tag });
  }
  const rev = u.pathname.match(/^\/gists\/g1\/(v\d+)$/);
  if (rev && method === 'GET') {
    const h = gh.history.find(x => x.version === rev[1]);
    return h ? json(200, { id: 'g1', files: { 'nichijou.json': { content: h.content, truncated: false } } }) : json(404, { message: 'Not Found' });
  }
  if (u.pathname === '/gists/g1' && method === 'PATCH') {
    gh.gist.content = JSON.parse(req.postData()).files['nichijou.json'].content;
    saveRevision();
    gh.etag++;
    return json(200, { id: 'g1' }, { ETag: `"e${gh.etag}"` });
  }
  return json(404, { message: 'Not Found' });
}

/* ---------- ajudantes ---------- */
const rows = page => page.$$eval('[data-sheet="day"] .row[data-id] .txt', els => els.map(e => e.childNodes[0].textContent.trim()));
const dumpRows = page => page.$$eval('[data-sheet="dump"] .row[data-id] .txt', els => els.map(e => e.childNodes[0].textContent.trim()));
async function add(page, list, text) {
  await page.click(`#add-${list}`);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}
async function newPage(browser, device, errors) {
  const ctx = await browser.newContext({ ...device, deviceScaleFactor: 1 });
  await ctx.route('https://api.github.com/**', githubRoute);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForSelector('.sheet');
  return { ctx, page };
}
const step = (name) => console.log('•', name);

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  let failed = false;
  try {
    /* ===== iPhone ===== */
    const { ctx: phoneCtx, page: phone } = await newPage(browser, devices['iPhone 13'], errors);

    step('primeira abertura: folha de hoje vazia, dia com maiúscula');
    const wd = await phone.$eval('.weekday', e => e.textContent);
    assert.match(wd, /^[A-ZÀ-Ú]/);
    await phone.screenshot({ path: `${SHOTS}/01-iphone-vazio.png` });

    step('adicionar 3 tarefas com Enter, campo continua focado');
    await add(phone, TODAY, 'Academia');
    await add(phone, TODAY, 'Ligar pro dentista');
    await add(phone, TODAY, 'Comprar café');
    assert.deepEqual(await rows(phone), ['Academia', 'Ligar pro dentista', 'Comprar café']);
    assert.equal(await phone.evaluate(() => document.activeElement.id), `add-${TODAY}`);

    step('caixinha marca; a feita desce pro fim (ordem automática)');
    await phone.click('.row:has-text("Academia") .box');
    assert.ok(await phone.$eval('.row:has-text("Academia")', e => e.classList.contains('done')));
    await phone.waitForTimeout(400);
    assert.deepEqual(await rows(phone), ['Ligar pro dentista', 'Comprar café', 'Academia']);

    step('menu ⋯ (popup no meio) → adiar pra amanhã; adiada fica depois das feitas');
    await phone.click('.row:has-text("Ligar pro dentista") .more');
    assert.ok(await phone.$('.overlay.center'));
    await phone.screenshot({ path: `${SHOTS}/02-iphone-menu.png` });
    await phone.click('[data-act="m-post"]');
    assert.ok(await phone.$eval('.row:has-text("Ligar pro dentista")', e => e.classList.contains('moved')));
    assert.deepEqual(await rows(phone), ['Comprar café', 'Academia', 'Ligar pro dentista']);
    await phone.click('[data-act="next"]');
    assert.deepEqual(await rows(phone), ['Ligar pro dentista']);
    assert.match(await phone.$eval('.mnote', e => e.textContent), /hoje/);
    await phone.click('[data-act="prev"]');

    step('deslizar a folha muda o dia');
    const box = await phone.$eval('.sheet', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 500 }; });
    await phone.mouse.move(box.x + 120, box.y);
    await phone.mouse.down();
    await phone.mouse.move(box.x - 60, box.y, { steps: 6 });
    await phone.mouse.up();
    assert.equal(await phone.$eval('.blank', e => e.textContent), (() => { const [y, m, d] = TOMORROW.split('-'); return `${d}/${m}/${y.slice(2)}`; })());
    await phone.click('.weekday'); // volta pra hoje
    assert.deepEqual(await rows(phone), ['Comprar café', 'Academia', 'Ligar pro dentista']);

    step('segurar e arrastar reordena as abertas');
    await add(phone, TODAY, 'Pagar conta');
    await phone.click('.sheet .head'); // tira o foco do campo
    assert.deepEqual(await rows(phone), ['Comprar café', 'Pagar conta', 'Academia', 'Ligar pro dentista']);
    const r2 = await phone.$eval('.row:has-text("Pagar conta") .txt', e => { const r = e.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2, h: r.height }; });
    await phone.mouse.move(r2.x, r2.y);
    await phone.mouse.down();
    await phone.waitForTimeout(550);
    await phone.mouse.move(r2.x, r2.y - r2.h * 1.2, { steps: 8 });
    await phone.mouse.up();
    await phone.waitForTimeout(400);
    assert.deepEqual(await rows(phone), ['Pagar conta', 'Comprar café', 'Academia', 'Ligar pro dentista']);
    assert.equal(await phone.$('.group:has-text("Pagar conta") .subs'), null, 'arrastar pelo texto não abre a sanfona');

    step('editar texto pelo menu');
    await phone.click('.row:has-text("Comprar café") .more');
    await phone.click('[data-act="m-edit"]');
    await phone.fill('.edit', 'Comprar café e pão');
    await phone.keyboard.press('Enter');
    assert.ok((await rows(phone)).includes('Comprar café e pão'));

    step('subtarefas: sem V em tarefa sem subtarefa; cria pelo ⋯; Enter adiciona e continua no campo');
    await add(phone, TODAY, 'Estudar');
    await phone.click('.sheet .head');
    await phone.click('.row:has-text("Estudar") .txt');
    assert.equal(await phone.$('.add.sub'), null, 'texto não abre');
    assert.ok(await phone.$eval('.row:has-text("Estudar")', e => e.classList.contains('open')), 'texto não marca');
    assert.equal(await phone.$('.row:has-text("Estudar") .vbtn'), null, 'sem V enquanto não tem subtarefa');
    await phone.click('.row:has-text("Estudar") .more');
    await phone.click('[data-act="m-sub"]');
    const subInput = await phone.evaluate(() => document.activeElement.dataset.subadd);
    assert.ok(subInput, 'campo de subtarefa focado');
    await phone.keyboard.type('anatomia'); await phone.keyboard.press('Enter');
    await phone.keyboard.type('fisiologia'); await phone.keyboard.press('Enter');
    assert.equal(await phone.evaluate(() => document.activeElement.dataset.subadd), subInput);
    const subs = () => phone.$$eval('.group:has(.row:not(.sub):has-text("Estudar")) .row.sub .txt', els => els.map(e => e.textContent.trim()));
    assert.deepEqual(await subs(), ['Anatomia', 'Fisiologia']);
    assert.ok(await phone.$('.row:not(.sub):has-text("Estudar") .vbtn'), 'com subtarefas, aparece o V');
    assert.equal(await phone.$('.row:has-text("Pagar conta") .vbtn'), null);
    assert.match(await phone.$eval('.row:not(.sub):has-text("Estudar") .prog', e => e.textContent), /0\/2/);
    await phone.waitForTimeout(500); // deixa a animação de reordenar terminar
    const overlap = await phone.$$eval('.list > .group', gs => gs.some((g, i) => i && g.getBoundingClientRect().top < gs[i - 1].getBoundingClientRect().bottom - 1));
    assert.equal(overlap, false, 'nenhuma tarefa por cima da outra');
    await phone.screenshot({ path: `${SHOTS}/10-iphone-subtarefas.png` });

    step('terminar as subtarefas marca a principal e ela desce');
    await phone.click('.row.sub:has-text("Anatomia") .box');
    await phone.click('.row.sub:has-text("Fisiologia") .box');
    await phone.waitForTimeout(400);
    assert.ok(await phone.$eval('.row:not(.sub):has-text("Estudar")', e => e.classList.contains('done')));
    assert.match(await phone.$eval('.row:not(.sub):has-text("Estudar") .prog', e => e.textContent), /2\/2/);
    await phone.click('.row.sub:has-text("Fisiologia") .box'); // reabrir reabre a principal
    assert.ok(await phone.$eval('.row:not(.sub):has-text("Estudar")', e => e.classList.contains('open')));
    await phone.click('.row:not(.sub):has-text("Estudar") .vbtn'); // fecha a sanfona
    assert.deepEqual(await subs(), []);
    await phone.reload();
    await phone.waitForSelector('.sheet');
    await phone.click('.row:not(.sub):has-text("Estudar") .vbtn');
    assert.deepEqual(await subs(), ['Fisiologia', 'Anatomia'], 'subtarefas salvas, feita depois da aberta');
    await phone.click('.row:not(.sub):has-text("Estudar") .vbtn');

    step('dump: adicionar e puxar pra hoje; tarefa do dia vai pro dump');
    await phone.click('[data-act="tab-dump"]');
    await add(phone, 'dump', 'Organizar fotos');
    await add(phone, 'dump', 'Trocar pneu da bike');
    await phone.click('[data-sheet="dump"] .row:has-text("Organizar fotos") .more');
    await phone.click('[data-act="m-today"]');
    assert.deepEqual(await dumpRows(phone), ['Trocar pneu da bike']);
    await phone.click('[data-act="tab-day"]');
    assert.ok((await rows(phone)).includes('Organizar fotos'));
    await phone.click('.row:has-text("Comprar café e pão") .more');
    await phone.click('[data-act="m-dump"]');
    await phone.click('[data-act="tab-dump"]');
    assert.ok((await dumpRows(phone)).includes('Comprar café e pão'));
    await phone.click('[data-act="tab-day"]');

    step('recarregar mantém tudo');
    const before = await rows(phone);
    await phone.reload();
    await phone.waitForSelector('.sheet');
    assert.deepEqual(await rows(phone), before);
    await phone.screenshot({ path: `${SHOTS}/03-iphone-hoje.png` });

    step('revisão da manhã: pendentes de ontem');
    await phone.evaluate(({ YDAY }) => {
      const doc = JSON.parse(localStorage.getItem('nichijou:v1'));
      const t = Date.now();
      doc.items.y1 = { id: 'y1', text: 'Mandar orçamento', list: YDAY, status: 'open', order: 1, createdAt: t, updatedAt: t };
      doc.items.y2 = { id: 'y2', text: 'Responder e-mail', list: YDAY, status: 'open', order: 2, createdAt: t, updatedAt: t };
      doc.items.y3 = { id: 'y3', text: 'Feita ontem', list: YDAY, status: 'done', order: 3, createdAt: t, updatedAt: t };
      localStorage.setItem('nichijou:v1', JSON.stringify(doc));
      const meta = JSON.parse(localStorage.getItem('nichijou:meta') || '{}');
      meta.lastReview = YDAY;
      localStorage.setItem('nichijou:meta', JSON.stringify(meta));
    }, { YDAY });
    await phone.reload();
    await phone.waitForSelector('.rv');
    await phone.screenshot({ path: `${SHOTS}/04-iphone-revisao.png` });
    await phone.click('label:has([data-rv="y2"])');
    await phone.check('#rv-drop');
    await phone.click('[data-act="rv-go"]');
    const after = await rows(phone);
    assert.ok(after.includes('Mandar orçamento') && !after.includes('Responder e-mail'));
    await phone.click('[data-act="prev"]');
    assert.ok(await phone.$eval('.row[data-id="y2"]', e => e.classList.contains('dropped')));
    await phone.click('.weekday');
    await phone.reload();
    await phone.waitForSelector('.sheet');
    assert.equal(await phone.$('.rv'), null, 'revisão não deve reaparecer no mesmo dia');

    step('exportar e importar backup');
    await phone.evaluate(() => { navigator.canShare = undefined; });
    await phone.click('.gear');
    const [download] = await Promise.all([phone.waitForEvent('download'), phone.click('[data-act="export"]')]);
    const backupPath = path.join(SHOTS, 'backup.json');
    await download.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert.ok(Object.keys(backup.items).length >= 6);
    const { ctx: freshCtx, page: fresh } = await newPage(browser, devices['iPhone 13'], errors);
    await fresh.click('.gear');
    const [chooser] = await Promise.all([fresh.waitForEvent('filechooser'), fresh.click('[data-act="import"]')]);
    await chooser.setFiles(backupPath);
    await fresh.waitForSelector('.toast');
    await fresh.click('[data-act="close"]');
    assert.deepEqual(await rows(fresh), await rows(phone));
    await freshCtx.close();

    step('offline: abre sem internet depois da primeira visita');
    await phone.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 5000 }).catch(() => {});
    await phone.reload();
    await phone.waitForFunction(() => navigator.serviceWorker.controller);
    await phoneCtx.setOffline(true);
    await phone.reload();
    await phone.waitForSelector('.row[data-id]');
    assert.ok((await rows(phone)).length > 0);
    await phoneCtx.setOffline(false);

    step('modo escuro');
    await phone.emulateMedia({ colorScheme: 'dark' });
    await phone.screenshot({ path: `${SHOTS}/05-iphone-escuro.png` });

    step('seletor de tema: sistema escuro, mas "Claro" força papel bege e fica salvo');
    const paper = () => phone.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(await paper(), 'rgb(39, 34, 28)');
    await phone.click('.gear');
    await phone.click('[data-act="theme"][data-id="light"]');
    assert.equal(await paper(), 'rgb(239, 229, 208)');
    assert.ok(await phone.$('.overlay .seg'), 'ajustes continuam abertos');
    await phone.waitForTimeout(300);
    await phone.screenshot({ path: `${SHOTS}/08-iphone-ajustes-tema.png` });
    await phone.click('[data-act="close"]');
    await phone.reload();
    await phone.waitForSelector('.sheet');
    assert.equal(await paper(), 'rgb(239, 229, 208)');
    await phone.click('.gear');
    await phone.click('[data-act="theme"][data-id="dark"]');
    await phone.emulateMedia({ colorScheme: 'light' });
    assert.equal(await paper(), 'rgb(39, 34, 28)');
    await phone.click('[data-act="theme"][data-id="system"]');
    assert.equal(await paper(), 'rgb(239, 229, 208)');
    await phone.click('[data-act="close"]');

    step('primeira letra maiúscula (sem estragar "iPhone")');
    await add(phone, TODAY, 'pagar boleto');
    await add(phone, TODAY, 'iPhone pra assistência');
    const caps = await rows(phone);
    assert.ok(caps.includes('Pagar boleto') && caps.includes('iPhone pra assistência'));

    step('dump sem subtítulo, sem contagem na aba e com "…" no campo');
    assert.equal(await phone.$('.tabs .n'), null);
    await phone.click('[data-act="tab-dump"]');
    assert.ok(!(await phone.$eval('[data-sheet="dump"] .head', e => e.textContent)).includes('vier na cabeça'));
    assert.equal(await phone.$eval('#add-dump', e => e.placeholder), '…');
    await phone.click('[data-act="tab-day"]');

    /* ===== Sincronização iPhone ↔ iPad ===== */
    step('token errado mostra erro claro');
    await phone.click('.gear');
    await phone.fill('#token', 'errado');
    await phone.click('[data-act="connect"]');
    await phone.waitForSelector('.err');
    assert.match(await phone.$eval('.err', e => e.textContent), /Token inválido/);

    step('iPhone conecta e cria o gist');
    await phone.fill('#token', 'test-token');
    await phone.click('[data-act="connect"]');
    await phone.waitForSelector('.conn');
    assert.ok(gh.gist, 'gist criado');
    await phone.screenshot({ path: `${SHOTS}/06-iphone-sync.png` });
    await phone.click('[data-act="close"]');
    const phoneRows = await rows(phone);

    step('iPad conecta e recebe o caderno do iPhone');
    const ipad = { ...devices['iPad Pro 11 landscape'] };
    const { page: tablet } = await newPage(browser, ipad, errors);
    assert.ok(await tablet.$eval('#app', e => e.classList.contains('tablet')));
    step('iPad: barra lateral fixa, uma página só (sem a dobra)');
    assert.ok(await tablet.$('.rail'));
    assert.equal(await tablet.$$eval('.sheet', s => s.length), 1);
    assert.equal(await tablet.$('.gear'), null);
    await tablet.click('.rail [data-act="settings"]');
    await tablet.fill('#token', 'test-token');
    await tablet.click('[data-act="connect"]');
    await tablet.waitForSelector('.conn');
    await tablet.click('[data-act="close"]');
    assert.deepEqual(await rows(tablet), phoneRows);
    await tablet.click('.rail [data-act="tab-dump"]');
    assert.equal(await tablet.$('[data-sheet="day"]'), null, 'nunca os dois juntos');
    assert.ok((await dumpRows(tablet)).includes('Trocar pneu da bike'));
    assert.equal(await tablet.$('.rail .n'), null, 'sem contagem');
    await tablet.screenshot({ path: `${SHOTS}/09-ipad-dump.png` });
    await tablet.click('.rail [data-act="tab-day"]');

    step('mudança no iPad aparece no iPhone');
    await add(tablet, TODAY, 'Escrito no iPad');
    await tablet.click('[data-sheet="day"] .row[data-id] .box >> nth=0');
    await tablet.waitForFunction(() => document.querySelector('.sync').dataset.s === 'ok' && !document.querySelector('.sync[data-s="syncing"]'), null, { timeout: 8000 });
    await tablet.waitForTimeout(3500); // debounce + PATCH
    assert.ok(gh.gist.content.includes('Escrito no iPad'));
    await phone.click('.gear');
    await phone.click('[data-act="sync-now"]');
    await phone.waitForTimeout(600);
    await phone.click('[data-act="close"]');
    assert.ok((await rows(phone)).includes('Escrito no iPad'));
    await tablet.screenshot({ path: `${SHOTS}/07-ipad.png` });

    step('editar offline nos dois e reconectar: as duas mudanças ficam');
    await phoneCtx.setOffline(true);
    await add(phone, TODAY, 'Offline no iPhone');
    await tablet.click('.rail [data-act="tab-dump"]');
    await add(tablet, 'dump', 'Ideia no iPad');
    await tablet.click('.rail [data-act="tab-day"]');
    await tablet.waitForTimeout(3500);
    await phoneCtx.setOffline(false);
    await phone.evaluate(() => window.dispatchEvent(new Event('online')));
    await phone.waitForTimeout(1500);
    await phone.click('[data-act="tab-dump"]');
    assert.ok((await dumpRows(phone)).includes('Ideia no iPad'));
    await phone.click('[data-act="tab-day"]');
    await tablet.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await tablet.waitForTimeout(1200);
    assert.ok((await rows(tablet)).includes('Offline no iPhone'));

    // o 401 do passo "token errado" é esperado
    step('versão antiga do app tira o vínculo das subtarefas no gist: o iPad conserta e mostra certo');
    // garante que o iPhone já salvou as subtarefas de "Estudar" no gist
    await phone.click('.gear');
    await phone.click('[data-act="sync-now"]');
    await phone.waitForTimeout(1500);
    await phone.click('[data-act="close"]');
    assert.ok(/"parent"/.test(gh.gist.content), 'gist tem as subtarefas');
    // simula a versão 1.2: mesmo conteúdo, sem "parent", mesmo updatedAt
    const broken = JSON.parse(gh.gist.content);
    for (const it of Object.values(broken.items)) delete it.parent;
    gh.gist.content = JSON.stringify(broken); gh.etag++; saveRevision();
    // um iPad novo (sem nada salvo) conecta e recebe o gist estragado
    const { ctx: pad2Ctx, page: pad2 } = await newPage(browser, ipad, errors);
    await pad2.click('.rail [data-act="settings"]');
    await pad2.fill('#token', 'test-token');
    await pad2.click('[data-act="connect"]');
    await pad2.waitForSelector('.conn');
    await pad2.waitForTimeout(1500);
    await pad2.click('[data-act="close"]');
    assert.ok(!(await rows(pad2)).includes('Anatomia'), 'Anatomia não vira tarefa solta');
    await pad2.click('.row:not(.sub):has-text("Estudar") .vbtn');
    const padSubs = await pad2.$$eval('.row.sub .txt', els => els.map(e => e.textContent.trim()));
    assert.deepEqual(padSubs.sort(), ['Anatomia', 'Fisiologia']);
    await pad2.waitForTimeout(400);
    await pad2.screenshot({ path: `${SHOTS}/11-ipad-subtarefas.png` });
    await pad2.waitForTimeout(3500); // debounce + PATCH: o conserto volta pro gist
    assert.ok(/"parent"/.test(gh.gist.content), 'gist consertado');
    // o iPhone, que estava certo, continua certo depois de sincronizar
    await phone.click('.gear');
    await phone.click('[data-act="sync-now"]');
    await phone.waitForTimeout(1200);
    await phone.click('[data-act="close"]');
    assert.ok(!(await rows(phone)).includes('Anatomia'));
    await pad2Ctx.close();

    assert.deepEqual(errors.filter(e => !/status of 401/.test(e)), [], 'sem erros no console');
    console.log(`\nOK — todos os passos passaram. Chamadas ao GitHub simulado: ${gh.calls.length}`);
  } catch (e) {
    failed = true;
    console.error('\nFALHOU:', e.message);
    if (errors.length) console.error('Erros no console:', errors);
  } finally {
    await browser.close();
    server.kill();
    process.exit(failed ? 1 : 0);
  }
})();
