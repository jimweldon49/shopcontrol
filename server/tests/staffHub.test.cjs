const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');

// In-memory stand-ins for the database, mailer and activity log.
const calls = [], emails = [];
let users = [], requests = [], messages = [];
function query(sql, args = []) {
  calls.push({ sql, args });
  if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return { rows: [] };
  if (sql.startsWith('INSERT INTO time_off_requests')) {
    const [user_id, full_name, request_type, other_reason, start_date, end_date, partial_day, start_time, end_time, notes] = args;
    const row = { id: 't' + (requests.length + 1), user_id, full_name, request_type, other_reason, start_date, end_date, partial_day, start_time, end_time, notes, status: 'Pending' };
    requests.push(row); return { rows: [row] };
  }
  if (sql.startsWith('SELECT id, email FROM users WHERE active=true AND role = ANY')) return { rows: users.filter(u => args[0].includes(u.role) && u.id !== args[1]) };
  if (sql.startsWith('INSERT INTO employee_notifications')) return { rows: [] };
  if (sql.startsWith('UPDATE time_off_requests SET status=$1')) {
    const r = requests.find(x => x.id === args[3] && x.status === 'Pending'); if (!r) return { rows: [] };
    Object.assign(r, { status: args[0], decision_note: args[1], decided_by: args[2] }); return { rows: [r] };
  }
  if (sql.startsWith('SELECT id, email, full_name FROM users WHERE id=$1')) return { rows: users.filter(u => u.id === args[0]) };
  if (sql.startsWith('INSERT INTO staff_messages')) { messages.push({ sql, args }); return { rows: [] }; }
  if (sql.startsWith('SELECT gen_random_uuid()')) return { rows: [{ id: 'g1' }] };
  if (sql.includes('FROM users WHERE') && sql.includes('role = ANY')) return { rows: users.filter(u => args[0].includes(u.role)) };
  if (sql.includes('FROM users WHERE') && sql.includes('department=$1')) return { rows: users.filter(u => u.department === args[0]) };
  if (sql.includes('FROM users WHERE') && sql.includes('id::text = ANY')) return { rows: users.filter(u => args[0].includes(u.id)) };
  if (sql.startsWith('SELECT id FROM users WHERE active=true')) return { rows: users };
  return { rows: [] };
}
const pool = { query: async (s, a) => query(s, a), connect: async () => ({ query: async (s, a) => query(s, a), release() {} }) };

const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (/(^|\/)db$/.test(name)) return { pool };
  if (name.endsWith('/activityLogger')) return { logActivity: async () => {} };
  if (name.endsWith('/mailer')) return { sendTaskEmail: async (m) => { emails.push(m); return { sent: true }; } };
  if (name === 'jsonwebtoken') return {};
  if (name.endsWith('/middleware/auth')) return { requireAuth: (q, s, n) => n() };
  if (name === 'express') return { Router: () => { const r = { routes: {}, use() {}, get(p, h) { r.routes['GET ' + p] = h; }, post(p, h) { r.routes['POST ' + p] = h; }, put(p, h) { r.routes['PUT ' + p] = h; }, delete(p, h) { r.routes['DELETE ' + p] = h; } }; return r; } };
  return load.call(this, name, parent, ...rest);
};
const router = require('../src/routes/staff');
Module._load = load;

async function call(key, user, body = {}, params = {}) {
  const out = {};
  const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; out.code = out.code || 200; return res; } };
  await router.routes[key]({ user, body, params, query: {} }, res);
  await new Promise(r => setImmediate(r)); // let fire-and-forget emails run
  return out;
}

const tech = { id: 'u-tech', role: 'body', fullName: 'Travis Tech', department: 'Body' };
const office = { id: 'u-office', role: 'office', fullName: 'Olivia Office' };
const admin = { id: 'u-admin', role: 'admin', fullName: 'Andy Admin' };

test.beforeEach(() => {
  calls.length = 0; emails.length = 0; requests = []; messages = [];
  users = [
    { id: 'u-tech', role: 'body', email: 'tech@x.com', full_name: 'Travis Tech', department: 'Body' },
    { id: 'u-tech2', role: 'paint', email: null, full_name: 'Pat Painter', department: 'Paint' },
    { id: 'u-office', role: 'office', email: 'office@x.com', full_name: 'Olivia Office' },
    { id: 'u-admin', role: 'admin', email: 'admin@x.com', full_name: 'Andy Admin' },
  ];
});

test('a time-off request is saved and emailed to office staff and admins', async () => {
  const r = await call('POST /time-off', tech, { request_type: 'Vacation', start_date: '2026-10-05', end_date: '2026-10-07' });
  assert.equal(r.code, 201);
  assert.equal(requests.length, 1);
  assert.equal(emails.length, 1);
  assert.match(emails[0].to, /office@x\.com/);
  assert.match(emails[0].to, /admin@x\.com/);
  assert.doesNotMatch(emails[0].to, /tech@x\.com/);
});

test('"Other" needs a written reason, and bad dates are rejected', async () => {
  assert.equal((await call('POST /time-off', tech, { request_type: 'Other', start_date: '2026-10-05', end_date: '2026-10-05' })).code, 400);
  assert.equal((await call('POST /time-off', tech, { request_type: 'Other', other_reason: 'Court date', start_date: '2026-10-05', end_date: '2026-10-05' })).code, 201);
  assert.equal((await call('POST /time-off', tech, { request_type: 'Sick', start_date: '2026-10-05', end_date: '2026-10-01' })).code, 400);
  assert.equal((await call('POST /time-off', tech, { request_type: 'Nap', start_date: '2026-10-05', end_date: '2026-10-05' })).code, 400);
});

test('only admins can approve; the employee gets a message and an email', async () => {
  await call('POST /time-off', tech, { request_type: 'Sick', start_date: '2026-10-05', end_date: '2026-10-05' });
  emails.length = 0;
  assert.equal((await call('POST /time-off/:id/decision', office, { decision: 'Approved' }, { id: 't1' })).code, 403);
  assert.equal((await call('POST /time-off/:id/decision', tech, { decision: 'Approved' }, { id: 't1' })).code, 403);
  const ok = await call('POST /time-off/:id/decision', admin, { decision: 'Approved', note: 'Feel better' }, { id: 't1' });
  assert.equal(ok.code, 200);
  assert.equal(requests[0].status, 'Approved');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].args[2], 'u-tech');
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, 'tech@x.com');
  assert.equal((await call('POST /time-off/:id/decision', admin, { decision: 'Denied' }, { id: 't1' })).code, 409, 'already decided');
});

test('techs can message the office but not each other or everyone; office can message anyone', async () => {
  assert.equal((await call('POST /messages', tech, { audience: 'everyone', body: 'hi' })).code, 403);
  assert.equal((await call('POST /messages', tech, { recipient_ids: ['u-tech2'], body: 'hi' })).code, 403);
  const toOffice = await call('POST /messages', tech, { audience: 'office', subject: 'Parts', body: 'Need a hand' });
  assert.equal(toOffice.code, 201);
  assert.equal(toOffice.body.sent, 2);
  messages.length = 0;
  const dept = await call('POST /messages', office, { audience: 'dept:Paint', body: 'Booth at 2' });
  assert.equal(dept.code, 201);
  assert.deepEqual(messages.map(m => m.args[3]), ['u-tech2']);
});
