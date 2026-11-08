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
  const s = M.sanitize({ items: { a: { text: 'ok', list: T, status: 'weird', evil: '<script>' }, b: { text: 1, list: T }, c: { text: 'x', list: 'nope' } } });
  assert.deepEqual(Object.keys(s.items), ['a']);
  assert.equal(s.items.a.status, 'open');
  assert.equal(s.items.a.evil, undefined);
});
