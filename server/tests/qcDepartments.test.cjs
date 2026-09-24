const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const load = Module._load;
Module._load = function (name, parent, ...rest) { if (/(^|\/)db$/.test(name)) return { pool: {} }; if (name === 'jsonwebtoken') return {}; return load.call(this, name, parent, ...rest); };
const { validate } = require('../src/unifiedValidation');
const { hasPermission } = require('../src/middleware/auth');
const qc = require('../../client/qcChecklists');
Module._load = load;

test('the five department checklists match the shop QC sheet', () => {
  assert.deepEqual(qc.names, ['Check-In', 'Body', 'Paint', 'Reassy', 'Final QC']);
  assert.deepEqual(qc.departments.map(d => d.items.length), [11, 10, 10, 10, 14]);
  for (const d of qc.departments) assert.equal(new Set(d.items.map(i => i.id)).size, d.items.length, `${d.id} ids are unique`);
});

test('QC checklist saves are validated against their department', () => {
  assert.doesNotThrow(() => validate('qc', { qc_department: 'Body', qc_checklist: { items: { prefit: { done: true, by: 'T' } }, notes: 'ok' } }));
  assert.doesNotThrow(() => validate('qc', { qc_department: 'Check-In', qc_checklist: { items: { ac_cold: { done: true, value: '38' } } } }));
  assert.throws(() => validate('qc', { qc_department: 'Body', qc_checklist: { items: { ac_cold: { done: true } } } }), /Unknown Body checklist item/);
  assert.throws(() => validate('qc', { qc_department: 'Detail', qc_checklist: {} }), /valid QC department/);
  assert.throws(() => validate('qc', { qc_checklist: { items: {} } }), /Choose a QC department/);
  assert.doesNotThrow(() => validate('qc', { qc_rework_needed: 'No' }), 'old-style QC edits still save');
  assert.equal(qc.progress('Body', { items: { prefit: { done: true }, tech_slot: { done: false } } }).done, 1);
});

test('anyone given a QC department can fill out QC; techs can view parts but not edit them', () => {
  assert.equal(hasPermission({ role: 'office' }, 'qc', 'create'), false);
  assert.equal(hasPermission({ role: 'office', department: 'Check-In' }, 'qc', 'create'), true);
  assert.equal(hasPermission({ role: 'office', department: 'Check-In' }, 'qc', 'delete'), false);
  assert.equal(hasPermission({ role: 'body' }, 'parts', 'list'), true);
  assert.equal(hasPermission({ role: 'body' }, 'parts', 'update'), false);
});
