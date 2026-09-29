const test = require('node:test'), assert = require('node:assert/strict');
const { completedJobGuard } = require('../src/completedJobs');

test('only admins can delete completed jobs', async () => {
  const db = { query: async () => ({ rows: [] }) };
  assert.match(await completedJobGuard(db, { role: 'office' }, 'daily', [{ current_stage: 'Delivered' }]), /kept for the shop's records/);
  assert.match(await completedJobGuard(db, { role: 'manager' }, 'daily', [{ current_stage: 'Total Loss' }]), /Ask an admin/);
  assert.equal(await completedJobGuard(db, { role: 'office' }, 'daily', [{ current_stage: 'Check-In' }]), null, 'open jobs and opportunities can still be deleted');
  assert.equal(await completedJobGuard(db, { role: 'admin' }, 'daily', [{ current_stage: 'Delivered' }]), null);
  assert.equal(await completedJobGuard(db, { role: 'office' }, 'tasks', [{}]), null);
});

test('parts on a completed job are protected; parts on open jobs are not', async () => {
  const calls = [];
  const db = (hit) => ({ query: async (sql, args) => { calls.push(args); return { rows: hit ? [{}] : [] }; } });
  assert.match(await completedJobGuard(db(true), { role: 'parts' }, 'parts', [{ parts_ro_number: ' 17901 ' }]), /completed job/);
  assert.deepEqual(calls.at(-1)[1], ['17901']);
  assert.equal(await completedJobGuard(db(false), { role: 'parts' }, 'parts', [{ parts_ro_number: '17990' }]), null);
  assert.equal(await completedJobGuard(db(true), { role: 'owner' }, 'parts', [{ parts_ro_number: '17901' }]), null);
});
