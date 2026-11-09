// Testes do modelo e da mesclagem. Rodar com: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { addDays } from '../js/dates.js';

const T = '2026-11-08';
const Y = addDays(T, -1);
const clone = d => JSON.parse(JSON.stringify(d));
const live = (d, list) => M.listItems(d, list).map(i => `${i.text}:${i.status}`);

test('adicionar, marcar e desmarcar', () => {
  const d = M.emptyDoc();
  const a = M.addItem(d, T, '  Academia  ');
  assert.equal(a.text, 'Academia');
  assert.equal(M.addItem(d, T, '   '), null);
  M.toggle(d, a.id);
  assert.equal(d.items[a.id].status, 'done');
  M.toggle(d, a.id);
  assert.equal(d.items[a.id].status, 'open');
});

test('adiar cria cópia no dia seguinte e desfazer remove a cópia', () => {
  const d = M.emptyDoc();
  const a = M.addItem(d, T, 'Ligar pro dentista');
  const copy = M.postpone(d, a.id, T);
  assert.equal(copy.list, addDays(T, 1));
  assert.equal(copy.from, T);
  assert.equal(d.items[a.id].status, 'moved');
  assert.deepEqual(live(d, addDays(T, 1)), ['Ligar pro dentista:open']);
  M.restore(d, a.id);
  assert.equal(d.items[a.id].status, 'open');
  assert.deepEqual(live(d, addDays(T, 1)), []);
});

test('adiar de um dia passado traz pra hoje', () => {
  const d = M.emptyDoc();
  const a = M.addItem(d, addDays(T, -3), 'Velha');
  const copy = M.postpone(d, a.id, T);
  assert.equal(copy.list, T);
});

test('dump: mandar e puxar', () => {
  const d = M.emptyDoc();
  const a = M.addItem(d, T, 'Ideia');
  M.toDump(d, a.id);
  assert.deepEqual(live(d, T), []);
  assert.deepEqual(live(d, M.DUMP), ['Ideia:open']);
  M.toDay(d, a.id, T);
  assert.deepEqual(live(d, T), ['Ideia:open']);
  assert.equal(d.items[a.id].from, M.DUMP);
});

test('reordenar', () => {
  const d = M.emptyDoc();
  const ids = ['A', 'B', 'C'].map(t => M.addItem(d, T, t).id);
  M.reorder(d, [ids[2], ids[0], ids[1]]);
  assert.deepEqual(M.listItems(d, T).map(i => i.text), ['C', 'A', 'B']);
});

test('revisão da manhã: traz marcadas, risca o resto se pedir', () => {
  const d = M.emptyDoc();
  const a = M.addItem(d, Y, 'Trazer');
  const b = M.addItem(d, Y, 'Deixar');
  M.addItem(d, Y, 'Feita');
  M.toggle(d, Object.values(d.items).find(i => i.text === 'Feita').id);
  assert.deepEqual(M.pending(d, T).map(i => i.text), ['Trazer', 'Deixar']);
  M.review(d, [a.id], true, T);
  assert.deepEqual(live(d, T), ['Trazer:open']);
  assert.equal(d.items[b.id].status, 'dropped');
  assert.deepEqual(M.pending(d, T), []);
});

test('merge: edições em itens diferentes nos dois aparelhos se somam', () => {
  const base = M.emptyDoc();
  const a = M.addItem(base, T, 'Um');
  const b = M.addItem(base, T, 'Dois');
  const phone = clone(base), pad = clone(base);
  M.toggle(phone, a.id);
  M.editItem(pad, b.id, 'Dois (editado)');
  M.addItem(pad, M.DUMP, 'Nova no iPad');
  const r = M.merge(phone, pad);
  assert.equal(r.doc.items[a.id].status, 'done');
  assert.equal(r.doc.items[b.id].text, 'Dois (editado)');
  assert.equal(M.listItems(r.doc, M.DUMP).length, 1);
  assert.ok(r.changedA && r.changedB);
});

test('merge: no mesmo item vence a mudança mais recente', () => {
  const base = M.emptyDoc();
  const a = M.addItem(base, T, 'X');
  const phone = clone(base), pad = clone(base);
  M.editItem(phone, a.id, 'primeiro');
  M.editItem(pad, a.id, 'depois');
  assert.equal(M.merge(phone, pad).doc.items[a.id].text, 'depois');
  assert.equal(M.merge(pad, phone).doc.items[a.id].text, 'depois');
});

test('merge: exclusão não ressuscita', () => {
  const base = M.emptyDoc();
  const a = M.addItem(base, T, 'Apagar');
  const phone = clone(base), pad = clone(base);
  M.removeItem(phone, a.id);
  const r = M.merge(pad, phone);
  assert.deepEqual(live(r.doc, T), []);
  assert.ok(r.changedA);
  assert.equal(M.merge(r.doc, phone).changedA, false);
});

test('merge: adiar a mesma tarefa nos dois aparelhos não duplica', () => {
  const base = M.emptyDoc();
  const a = M.addItem(base, Y, 'Pendente');
  const phone = clone(base), pad = clone(base);
  M.review(phone, [a.id], false, T);
  M.review(pad, [a.id], false, T);
  const r = M.merge(phone, pad);
  assert.deepEqual(live(r.doc, T), ['Pendente:open']);
});

test('merge sem diferenças não marca mudança', () => {
  const d = M.emptyDoc();
  M.addItem(d, T, 'A');
  const r = M.merge(d, clone(d));
  assert.equal(r.changedA, false);
  assert.equal(r.changedB, false);
});

test('purge remove lápides com mais de 30 dias', () => {
  const d = M.emptyDoc();
  const a = M.addItem(d, T, 'velha');
  M.removeItem(d, a.id);
  M.purge(d, d.items[a.id].updatedAt + M.TOMBSTONE_TTL - 1);
  assert.ok(d.items[a.id]);
  M.purge(d, d.items[a.id].updatedAt + M.TOMBSTONE_TTL + 1);
  assert.equal(d.items[a.id], undefined);
});

test('sanitize recusa lixo e limpa campos', () => {
  assert.throws(() => M.sanitize(null));
  assert.throws(() => M.sanitize({ foo: 1 }));
  const s = M.sanitize({ items: { a: { text: 'ok', list: T, status: 'weird', obj: { x: 1 }, ['__proto__']: 'x', long: 'x'.repeat(500) }, b: { text: 1, list: T }, c: { text: 'x', list: 'nope' } } });
  assert.deepEqual(Object.keys(s.items), ['a']);
  assert.equal(s.items.a.status, 'open');
  assert.equal(s.items.a.obj, undefined, 'objetos desconhecidos são descartados');
  assert.equal(s.items.a.long, undefined, 'textos longos desconhecidos são descartados');
  assert.equal(Object.getPrototypeOf(s.items.a), Object.prototype);
});

/* ---------- ordem automática e subtarefas ---------- */

test('ordem automática: abertas → feitas → adiadas → riscadas', () => {
  const d = M.emptyDoc();
  const [a, b, c, e, f] = ['A', 'B', 'C', 'E', 'F'].map(t => M.addItem(d, T, t).id);
  M.setStatus(d, a, 'dropped');
  M.toggle(d, b);
  M.postpone(d, c, T);
  assert.deepEqual(M.listItems(d, T).map(i => i.text), ['E', 'F', 'B', 'C', 'A']);
  M.toggle(d, b); // reaberta volta pro lugar original
  assert.deepEqual(M.listItems(d, T).map(i => i.text), ['B', 'E', 'F', 'C', 'A']);
  void e; void f;
});

test('subtarefas: criar, progresso e não aparecem como tarefa principal', () => {
  const d = M.emptyDoc();
  const p = M.addItem(d, T, 'Estudar');
  M.addSub(d, p.id, 'Anatomia');
  M.addSub(d, p.id, 'Fisiologia');
  assert.deepEqual(M.listItems(d, T).map(i => i.text), ['Estudar']);
  assert.deepEqual(M.children(d, p.id).map(i => i.text), ['Anatomia', 'Fisiologia']);
  assert.equal(M.progress(d, p.id), '0/2');
});

test('marcar a principal marca as subtarefas; terminar a última marca a principal', () => {
  const d = M.emptyDoc();
  const p = M.addItem(d, T, 'Estudar');
  const s1 = M.addSub(d, p.id, 'Anatomia');
  const s2 = M.addSub(d, p.id, 'Fisiologia');
  M.toggle(d, s1.id);
  assert.equal(d.items[p.id].status, 'open');
  M.toggle(d, s2.id);
  assert.equal(d.items[p.id].status, 'done');
  M.toggle(d, s2.id); // reabrir uma subtarefa reabre a principal
  assert.equal(d.items[p.id].status, 'open');
  M.toggle(d, p.id);
  assert.deepEqual(M.children(d, p.id).map(i => i.status), ['done', 'done']);
});

test('riscar a última subtarefa aberta conclui a principal; nova subtarefa reabre', () => {
  const d = M.emptyDoc();
  const p = M.addItem(d, T, 'Estudar');
  const s1 = M.addSub(d, p.id, 'A');
  const s2 = M.addSub(d, p.id, 'B');
  M.toggle(d, s1.id);
  M.setStatus(d, s2.id, 'dropped');
  assert.equal(d.items[p.id].status, 'done');
  M.addSub(d, p.id, 'C');
  assert.equal(d.items[p.id].status, 'open');
});

test('adiar a principal leva só as subtarefas que faltavam; desfazer traz de volta', () => {
  const d = M.emptyDoc();
  const p = M.addItem(d, T, 'Estudar');
  const s1 = M.addSub(d, p.id, 'Estudar 30 min');
  const s2 = M.addSub(d, p.id, 'Anatomia');
  M.toggle(d, s1.id);
  const copy = M.postpone(d, p.id, T);
  const tomorrow = addDays(T, 1);
  assert.equal(copy.list, tomorrow);
  assert.deepEqual(M.children(d, copy.id).map(i => `${i.text}:${i.status}`), ['Anatomia:open']);
  assert.equal(d.items[s1.id].status, 'done');
  assert.equal(d.items[s2.id].status, 'moved');
  M.restore(d, p.id);
  assert.deepEqual(live(d, tomorrow), []);
  assert.deepEqual(M.children(d, copy.id), []);
  assert.equal(d.items[s2.id].status, 'open');
  assert.equal(d.items[p.id].status, 'open');
});

test('revisão da manhã traz a principal com as subtarefas pendentes, sem duplicar nos dois aparelhos', () => {
  const base = M.emptyDoc();
  const p = M.addItem(base, Y, 'Estudar');
  M.addSub(base, p.id, 'Anatomia');
  assert.deepEqual(M.pending(base, T).map(i => i.text), ['Estudar']);
  const phone = clone(base), pad = clone(base);
  M.review(phone, [p.id], false, T);
  M.review(pad, [p.id], false, T);
  const r = M.merge(phone, pad).doc;
  const today = M.listItems(r, T);
  assert.deepEqual(today.map(i => i.text), ['Estudar']);
  assert.deepEqual(M.children(r, today[0].id).map(i => i.text), ['Anatomia']);
});

test('dump: mandar e puxar levam as subtarefas junto; excluir apaga as subtarefas', () => {
  const d = M.emptyDoc();
  const p = M.addItem(d, T, 'Projeto');
  const s = M.addSub(d, p.id, 'Parte 1');
  M.toDump(d, p.id);
  assert.equal(d.items[s.id].list, M.DUMP);
  M.toDay(d, p.id, T);
  assert.equal(d.items[s.id].list, T);
  M.removeItem(d, p.id);
  assert.equal(d.items[s.id].deleted, true);
});

test('sanitize preserva o vínculo da subtarefa', () => {
  const s = M.sanitize({ items: { a: { text: 'x', list: T, parent: 'p1' } } });
  assert.equal(s.items.a.parent, 'p1');
});

/* ---------- compatibilidade com versões antigas do app ---------- */

test('merge: cópia sem o vínculo (versão antiga) não desfaz a subtarefa, em nenhuma ordem', () => {
  const d = M.emptyDoc();
  const p = M.addItem(d, T, 'Estudar');
  M.addSub(d, p.id, 'Estudar fisio');
  M.addSub(d, p.id, 'Estudar anato');
  const old = clone(d);
  for (const it of Object.values(old.items)) delete it.parent; // como a versão 1.2 salvava
  for (const [a, b] of [[d, old], [old, d]]) {
    const r = M.merge(a, b);
    assert.deepEqual(M.listItems(r.doc, T).map(i => i.text), ['Estudar']);
    assert.deepEqual(M.children(r.doc, p.id).map(i => i.text), ['Estudar fisio', 'Estudar anato']);
  }
  assert.ok(M.merge(d, old).changedB, 'conserta o gist');
});

test('merge: edição mais nova feita na versão antiga mantém o vínculo da subtarefa', () => {
  const d = M.emptyDoc();
  const p = M.addItem(d, T, 'Estudar');
  const s = M.addSub(d, p.id, 'Fisio');
  const old = clone(d);
  delete old.items[s.id].parent;
  old.items[s.id].status = 'done';
  old.items[s.id].updatedAt += 1000;
  const r = M.merge(d, old).doc;
  assert.equal(r.items[s.id].parent, p.id);
  assert.equal(r.items[s.id].status, 'done');
});

test('sanitize preserva campos que ainda não conhece (compatibilidade com versões futuras)', () => {
  const s = M.sanitize({ items: { a: { text: 'x', list: T, color: 'red', pinned: true, weird: { x: 1 } } } });
  assert.equal(s.items.a.color, 'red');
  assert.equal(s.items.a.pinned, true);
  assert.equal(s.items.a.weird, undefined);
});
