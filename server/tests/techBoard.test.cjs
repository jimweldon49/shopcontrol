const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (/(^|\/)db$/.test(name)) return { pool: {} };
  if (name === 'jsonwebtoken') return {};
  return load.call(this, name, parent, ...rest);
};
const { listFor, departmentStatus } = require('../src/routes/techBoard');
Module._load = load;

const allBody = (by) => ({ items: Object.fromEntries(['tech_slot', 'estimate_reviewed', 'procedures', 'supplement_addl', 'prefit', 'bodywork_photos', 'battery_protected', 'parts_inventoried', 'openings_covered', 'cart_organized'].map((id) => [id, { done: true, by }])) });

test('a department is done only when its checklist is fully checked and signed after it was assigned', () => {
  const since = '2026-10-12T15:00:00Z';
  const signed = (at, checklist) => [{ qc_department: 'Body', qc_checklist: checklist, qc_signatures: [{ by: 'Ana', at, items: [] }], updated_at: at }];
  assert.equal(departmentStatus(signed('2026-10-12T16:00:00Z', allBody('Ana')), 'Body', since).done, true);
  // Signed, but the first tech left items unchecked: stays on the list.
  const partial = allBody('Ana'); partial.items.cart_organized.done = false;
  const s = departmentStatus(signed('2026-10-12T16:00:00Z', partial), 'Body', since);
  assert.equal(s.done, false);
  assert.deepEqual(s.progress, { done: 9, total: 10, complete: false });
  // Complete, but signed before it was put on the board (old work): not done for today.
  assert.equal(departmentStatus(signed('2026-10-11T16:00:00Z', allBody('Ana')), 'Body', since).done, false);
  // Fully checked but nobody signed yet.
  assert.equal(departmentStatus([{ qc_department: 'Body', qc_checklist: allBody('Ana'), qc_signatures: [], updated_at: since }], 'Body', since).done, false);
});

test("a tech's list: named jobs and Any Tech in their departments; hot, then carried over, then board order", () => {
  const dept = (department, users, anyTech = false, done = false) => ({ department, users, anyTech, done, progress: { done: 0, total: 10 } });
  const travis = { id: 't', name: 'Travis' }, nacho = { id: 'n', name: 'Nacho' };
  const board = { jobs: [
    { jobId: 'a', roNumber: '10001', hot: false, carriedOver: false, position: 1, departments: [dept('Body', [travis])] },
    { jobId: 'b', roNumber: '10002', hot: false, carriedOver: true, position: 3, departments: [dept('Body', [], true)] },
    { jobId: 'c', roNumber: '10003', hot: true, carriedOver: false, position: 4, departments: [dept('Reassy', [], true), dept('Paint', [nacho])] },
    { jobId: 'd', roNumber: '10004', hot: false, carriedOver: false, position: 2, departments: [dept('Body', [travis], false, true)] },
    { jobId: 'e', roNumber: '10005', hot: false, carriedOver: false, position: 5, departments: [dept('Paint', [], true)] },
  ] };
  const body = listFor({ id: 't', department: 'Body', extraDepartments: [] }, board);
  // Body techs also do Reassy, so they see the hot Reassy job; d is done so it's gone.
  assert.deepEqual(body.map((x) => [x.roNumber, x.department, x.anyTech]), [['10003', 'Reassy', true], ['10002', 'Body', true], ['10001', 'Body', false]]);
  const paint = listFor({ id: 'n', department: 'Paint', extraDepartments: [] }, board);
  assert.deepEqual(paint.map((x) => [x.roNumber, x.anyTech]), [['10003', false], ['10005', true]]);
  assert.deepEqual(listFor({ id: 'z', department: 'Final QC', extraDepartments: [] }, board), []);
});

test('techs come from Employees: QC department, role, and extra checklists', () => {
  const { techDepartments } = require('../src/routes/techBoard');
  assert.deepEqual(techDepartments({ role: 'body', department: null }), ['Body', 'Reassy']);
  assert.deepEqual(techDepartments({ role: 'paint', department: null }), ['Paint']);
  assert.deepEqual(techDepartments({ role: 'office', department: 'Check-In' }), ['Check-In', 'Final QC']);
  assert.deepEqual(techDepartments({ role: 'paint', department: 'Paint', extraDepartments: ['Final QC'] }), ['Paint', 'Final QC']);
  assert.deepEqual(techDepartments({ role: 'office', department: null }), []);
});
