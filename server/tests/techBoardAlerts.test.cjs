const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (/(^|\/)db$/.test(name)) return { pool: {} };
  if (name === 'jsonwebtoken') return {};
  return load.call(this, name, parent, ...rest);
};
const { isSendTime, unfinishedHot, recipientsFor, carLines } = require('../src/techBoardAlerts');
Module._load = load;

test('the hot car check runs at 5:00 PM Pacific on weekdays only', () => {
  assert.equal(isSendTime(new Date('2026-10-12T23:59:00Z')), false, 'Mon 4:59 PM PDT');
  assert.equal(isSendTime(new Date('2026-10-13T00:00:00Z')), true, 'Mon 5:00 PM PDT');
  assert.equal(isSendTime(new Date('2026-10-17T01:00:00Z')), true, 'Fri 6:00 PM PDT');
  assert.equal(isSendTime(new Date('2026-10-18T01:00:00Z')), false, 'Sat 6:00 PM PDT');
  assert.equal(isSendTime(new Date('2026-10-12T16:00:00Z')), false, 'Mon 9:00 AM PDT');
});

test('unfinished hot cars go to their techs (whole department for Any Tech) and the office', () => {
  const dept = (department, users, anyTech, done, progress = { done: 4, total: 10 }) => ({ department, users, anyTech, done, progress, signedBy: [] });
  const board = { jobs: [
    { jobId: 'a', roNumber: '20001', vehicle: '2022 Toyota Camry / White', customerName: 'A', hot: true, done: false, daysOver: 2, addedOn: '2026-10-10',
      departments: [dept('Body', [], true, false), dept('Paint', [{ id: 'nacho', name: 'Nacho' }], false, true)] },
    { jobId: 'b', roNumber: '20002', vehicle: 'Van', hot: false, done: false, departments: [dept('Body', [{ id: 'travis', name: 'Travis' }], false, false)] },
    { jobId: 'c', roNumber: '20003', vehicle: 'Truck', hot: true, done: true, departments: [dept('Paint', [{ id: 'jesse', name: 'Jesse' }], false, true)] },
  ] };
  const cars = unfinishedHot(board);
  assert.deepEqual(cars.map((c) => [c.roNumber, c.open.map((d) => d.department)]), [['20001', ['Body']]]);
  const techs = { Body: [{ id: 'travis' }, { id: 'cesar' }], Paint: [{ id: 'nacho' }, { id: 'jesse' }] };
  const users = [
    { id: 'travis', email: 't@x', role: 'body' }, { id: 'cesar', email: 'c@x', role: 'body' }, { id: 'nacho', email: 'n@x', role: 'paint' },
    { id: 'jesse', email: 'j@x', role: 'paint' }, { id: 'office', email: 'o@x', role: 'office' }, { id: 'tech-no-email', email: null, role: 'body' },
  ];
  const r = recipientsFor(cars, techs, users);
  // Paint is finished on this car, so Nacho isn't emailed; both Body techs are (Any Tech).
  assert.deepEqual([...r.keys()].sort(), ['c@x', 'o@x', 't@x']);
  const lines = carLines(cars[0]).join('\n');
  assert.match(lines, /RO 20001 · 2022 Toyota Camry · A/);
  assert.match(lines, /Body: Any Tech \(4 of 10 checked\)/);
  assert.match(lines, /since 2026-10-10 \(2 days\)/);
});
