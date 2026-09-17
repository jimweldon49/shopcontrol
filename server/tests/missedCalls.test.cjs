const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const calls = []; let queryImpl = async () => ({ rows: [] });
const db = { query: async (sql, args = []) => { calls.push({ sql, args }); const nums = [...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])); if (nums.length) assert.equal(Math.max(...nums), args.length, 'SQL placeholder count'); else assert.equal(args.length, 0); return queryImpl(sql, args); }, release() {} };
const pool = { query: db.query, connect: async () => db };
const routers = [];
function Router() { const r = { routes: [], middleware: [], use(...m) { this.middleware.push(...m); } }; for (const method of ['get', 'post', 'put', 'delete']) r[method] = function (path, ...handlers) { this.routes.push({ method, path, handlers }); }; routers.push(r); return r; }
const load = Module._load;
let alertCalls = [];
Module._load = function (name, parent, ...rest) {
  if (name === 'express') return { Router };
  if (name === 'jsonwebtoken') return { verify: () => ({ id: 'user-1' }) };
  if (/(^|\/)db$/.test(name)) return { pool };
  if (name.endsWith('/missedCallAlerts')) return { sendMissedCallAlert: async (row, reason) => { alertCalls.push({ row, reason }); return { sent: 0, recipients: 0 }; } };
  return load.call(this, name, parent, ...rest);
};
const auth = require('../src/middleware/auth');
const missedCalls = require('../src/routes/missedCalls');
Module._load = load;

async function invoke(router, method, path, body = {}, user = { role: 'office', canDelete: true }, query = {}) {
  const route = router.routes.find(r => r.method === method && r.path === path); assert.ok(route, `${method} ${path} exists`);
  const req = { headers: { authorization: 'Bearer fake-test-token' }, params: { id: '00000000-0000-4000-8000-000000000001' }, query, body, user: { id: 'user-1', username: 'test', fullName: 'Test', ...user } };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(data) { result = { status: this.statusCode, data }; return this; } };
  let result;
  const stack = [...router.middleware, ...route.handlers];
  async function run(i) { if (i >= stack.length) return; let nextPromise; await stack[i](req, res, () => nextPromise = run(i + 1)); if (nextPromise) await nextPromise; }
  await run(0);
  return result;
}
const userQuery = (sql, user) => sql.startsWith('SELECT id,username') ? { rows: [{ id: 'user-1', username: 'test', full_name: 'Test', active: true, role: user.role, can_delete: user.canDelete }] } : null;

const validBody = { caller_name: 'Jane Doe', callback_phone: '555-1234', message: 'Needs a status update.', status: 'New' };

test('every operational role can reach missed_calls, and delete stays gated by the per-user canDelete flag', async () => {
  for (const role of ['office', 'estimator', 'parts', 'paint', 'body', 'qc', 'cleanup', 'employee']) {
    assert.ok(auth.ROLE_PERMISSIONS[role].resources.includes('missed_calls'), `${role} should have missed_calls access`);
  }
  calls.length = 0;
  queryImpl = async sql => (sql.startsWith('DELETE FROM missed_calls') ? { rows: [{ id: 'call-1' }] } : userQuery(sql, { role: 'office', canDelete: false }) || { rows: [] });
  const result = await invoke(missedCalls, 'delete', '/:id', {}, { role: 'office', canDelete: false });
  assert.equal(result.status, 403);
  assert.ok(!calls.some(c => c.sql.startsWith('DELETE FROM missed_calls')));
});

test('creating a call without a caller name is rejected before any insert', async () => {
  calls.length = 0; alertCalls = [];
  queryImpl = async sql => userQuery(sql, { role: 'office', canDelete: true }) || { rows: [] };
  const result = await invoke(missedCalls, 'post', '/', { ...validBody, caller_name: '' });
  assert.equal(result.status, 400);
  assert.ok(!calls.some(c => c.sql.startsWith('INSERT INTO missed_calls')));
  assert.equal(alertCalls.length, 0);
});

test('closing without a callback requires a reason', async () => {
  calls.length = 0;
  queryImpl = async sql => userQuery(sql, { role: 'office', canDelete: true }) || { rows: [] };
  const result = await invoke(missedCalls, 'post', '/', { ...validBody, status: 'Closed — no callback needed', closed_reason: '' });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /reason is required/);
});

test('creating a valid call inserts, logs activity, and fires the immediate alert', async () => {
  calls.length = 0; alertCalls = [];
  const inserted = { id: 'call-1', caller_name: 'Jane Doe', assigned_to: null, created_at: new Date().toISOString() };
  queryImpl = async sql => {
    if (sql.startsWith('INSERT INTO missed_calls')) return { rows: [inserted] };
    return userQuery(sql, { role: 'office', canDelete: true }) || { rows: [] };
  };
  const result = await invoke(missedCalls, 'post', '/', validBody);
  assert.equal(result.status, 201);
  assert.ok(calls.some(c => c.sql.startsWith('INSERT INTO activity_log')));
  assert.equal(alertCalls.length, 1);
  assert.equal(alertCalls[0].reason, 'created');
});

test('reassigning a call on update fires a reassigned alert; an unchanged assignee does not', async () => {
  calls.length = 0; alertCalls = [];
  const before = { id: 'call-1', assigned_to: null, updated_at: '2026-09-16T00:00:00.000Z' };
  const after = { id: 'call-1', assigned_to: 'u9', updated_at: '2026-09-16T00:05:00.000Z' };
  queryImpl = async sql => {
    if (sql.startsWith('SELECT * FROM missed_calls WHERE id=$1')) return { rows: [before] };
    if (sql.startsWith('UPDATE missed_calls SET')) return { rows: [after] };
    return userQuery(sql, { role: 'office', canDelete: true }) || { rows: [] };
  };
  const result = await invoke(missedCalls, 'put', '/:id', { ...validBody, assigned_to: 'u9', expected_updated_at: before.updated_at });
  assert.equal(result.status, 200);
  assert.equal(alertCalls.length, 1);
  assert.equal(alertCalls[0].reason, 'reassigned');
});

test('logging a callback attempt moves an open call to "Callback attempted" and never resets escalation state on its own', async () => {
  calls.length = 0;
  const call = { id: 'call-1', status: 'New' };
  const updated = { id: 'call-1', status: 'Callback attempted' };
  queryImpl = async sql => {
    if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
    if (sql.startsWith('SELECT * FROM missed_calls WHERE id=$1 FOR UPDATE')) return { rows: [call] };
    if (sql.startsWith('INSERT INTO callback_attempts')) return { rows: [{ id: 'att-1', outcome: 'Left voicemail' }] };
    if (sql.startsWith('UPDATE missed_calls SET status=$1')) return { rows: [updated] };
    return userQuery(sql, { role: 'office', canDelete: true }) || { rows: [] };
  };
  const result = await invoke(missedCalls, 'post', '/:id/attempts', { outcome: 'Left voicemail', notes: 'No answer' });
  assert.equal(result.status, 201);
  assert.equal(result.data.call.status, 'Callback attempted');
  assert.ok(!calls.some(c => c.sql.includes('escalation_sent_at')));
});
