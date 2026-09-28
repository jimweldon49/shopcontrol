const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');

let user;
const updates = [];
const pool = {
  query: async (sql, args = []) => {
    if (sql.startsWith('SELECT id,username,full_name,role,can_delete,active,department,must_change_password')) return { rows: [user] };
    if (sql.startsWith('SELECT password_hash, username FROM users')) return { rows: [{ password_hash: 'hash:' + user.password, username: user.username }] };
    if (sql.startsWith('UPDATE users SET password_hash')) { updates.push({ sql, args }); user.must_change_password = false; user.password = args[0].replace('hash:', ''); return { rows: [] }; }
    return { rows: [] };
  },
};
const bcrypt = { hash: async (p) => 'hash:' + p, compare: async (p, h) => h === 'hash:' + p };

const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (/(^|\/)db$/.test(name)) return { pool };
  if (name === 'jsonwebtoken') return { verify: () => ({ id: 'u1' }), sign: () => 't' };
  if (name === 'bcryptjs') return bcrypt;
  if (name.endsWith('/activityLogger')) return { logActivity: async () => {} };
  if (name.endsWith('/mailer')) return { sendPasswordResetEmail: async () => ({}) };
  if (name === 'express') return { Router: () => { const r = { routes: {}, get(p, ...h) { r.routes['GET ' + p] = h; }, post(p, ...h) { r.routes['POST ' + p] = h; } }; return r; } };
  return load.call(this, name, parent, ...rest);
};
const { requireAuth } = require('../src/middleware/auth');
const authRouter = require('../src/routes/auth');
Module._load = load;

function res() {
  const out = { code: 200, body: null };
  out.status = (c) => { out.code = c; return out; };
  out.json = (b) => { out.body = b; return out; };
  return out;
}
async function through(url) {
  const r = res(); let passed = false;
  await requireAuth({ headers: { authorization: 'Bearer x' }, originalUrl: url }, r, () => { passed = true; });
  return { passed, ...r };
}
async function changePassword(body) {
  const [auth, handler] = authRouter.routes['POST /change-password'];
  const req = { headers: { authorization: 'Bearer x' }, originalUrl: '/api/auth/change-password', body, ip: '1' };
  const r = res(); let ok = false;
  await auth(req, r, () => { ok = true; });
  if (ok) await handler(req, r);
  return r;
}

test.beforeEach(() => {
  user = { id: 'u1', username: 'luiss', full_name: 'Luis Soto', role: 'employee', can_delete: false, active: true, department: null, must_change_password: true, password: 'Paint1234!' };
  updates.length = 0;
});

test('an account with a temporary password can only check itself and change its password', async () => {
  const blocked = await through('/api/daily');
  assert.equal(blocked.passed, false);
  assert.equal(blocked.code, 403);
  assert.equal(blocked.body.mustChangePassword, true);
  assert.equal((await through('/api/auth/me')).passed, true);
  assert.equal((await through('/api/auth/change-password')).passed, true);
  user.must_change_password = false;
  assert.equal((await through('/api/daily')).passed, true, 'normal accounts are unaffected');
});

test('changing the password needs the temporary password and a different new one, then unlocks the account', async () => {
  assert.equal((await changePassword({ currentPassword: 'wrong', newPassword: 'MyNewPass1' })).code, 400);
  assert.equal((await changePassword({ currentPassword: 'Paint1234!', newPassword: 'short' })).code, 400);
  assert.equal((await changePassword({ currentPassword: 'Paint1234!', newPassword: 'Paint1234!' })).code, 400);
  assert.equal(updates.length, 0);
  const ok = await changePassword({ currentPassword: 'Paint1234!', newPassword: 'MyNewPass1' });
  assert.equal(ok.code, 200);
  assert.match(updates[0].sql, /must_change_password = false/);
  assert.equal((await through('/api/daily')).passed, true);
});
