const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');

const JOB = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', LUIS = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function load(state) {
  const calls = [], logged = [];
  const pool = {
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (sql.includes('FROM users WHERE id')) return { rows: args[0] === LUIS ? [{ id: LUIS, username: 'luiss', full_name: 'Luis S' }] : [] };
      if (sql.includes('FROM users')) return { rows: [{ id: LUIS, full_name: 'Luis S' }] };
      if (sql.startsWith('SELECT * FROM daily_go_list')) return { rows: [state.job] };
      if (sql.startsWith('UPDATE daily_go_list')) return { rows: [{ ...state.job, current_stage: args[0], version: state.job.version + 1, updated_by: args[1] }] };
      return { rows: [] };
    },
  };
  const orig = Module._load;
  Module._load = function (name, parent, ...rest) {
    if (/(^|\/)db$/.test(name)) return { pool };
    if (name.endsWith('/activityLogger')) return { logActivity: async (a) => logged.push(a) };
    if (name === 'jsonwebtoken') return {};
    if (name === 'express') return { Router: () => { const r = { routes: {}, use() {}, get(p, h) { r.routes['GET ' + p] = h; }, post(p, h) { r.routes['POST ' + p] = h; } }; return r; } };
    return orig.call(this, name, parent, ...rest);
  };
  delete require.cache[require.resolve('../src/routes/shopBoard')];
  const router = require('../src/routes/shopBoard');
  Module._load = orig;
  const call = async (user, body) => { const out = {}; const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } }; await router.routes['POST /move']({ user, body }, res); return out; };
  return { call, calls, logged };
}

const board = { id: 'board', username: 'shopboard', fullName: 'Shop Board', role: 'shopboard' };

test('the shop board moves a car and logs the technician who tapped', async () => {
  const { call, logged } = load({ job: { id: JOB, current_stage: 'Body', version: 4 } });
  const r = await call(board, { job_id: JOB, stage: 'Prep', moved_by: LUIS, expected_version: 4 });
  assert.equal(r.body.current_stage, 'Prep');
  assert.equal(r.body.updated_by, 'Luis S (shop board)');
  assert.equal(logged[0].req.user.fullName, 'Luis S (shop board)');
  assert.match(logged[0].summary, /Body to Prep on the shop board/);
});

test('the shop board must say who moved it, and only to a production stage', async () => {
  const { call } = load({ job: { id: JOB, current_stage: 'Body', version: 4 } });
  assert.equal((await call(board, { job_id: JOB, stage: 'Prep' })).code, 400);
  assert.equal((await call(board, { job_id: JOB, stage: 'Prep', moved_by: 'cccccccc-cccc-cccc-cccc-cccccccccccc' })).code, 400);
  assert.equal((await call(board, { job_id: JOB, stage: 'Delivered', moved_by: LUIS })).code, 400);
});

test('a stale board gets a conflict instead of overwriting a newer change', async () => {
  const { call } = load({ job: { id: JOB, current_stage: 'Paint', version: 7 } });
  assert.equal((await call(board, { job_id: JOB, stage: 'Prep', moved_by: LUIS, expected_version: 6 })).code, 409);
});

test('the TV display account cannot move cars', async () => {
  const { call } = load({ job: { id: JOB, current_stage: 'Body', version: 1 } });
  assert.equal((await call({ id: 'tv', role: 'display' }, { job_id: JOB, stage: 'Prep', moved_by: LUIS })).code, 403);
});

test('the shop board account can look but not edit through the normal routes', () => {
  const { hasPermission } = require('../src/middleware/auth');
  assert.equal(hasPermission({ role: 'shopboard' }, 'daily', 'list'), true);
  assert.equal(hasPermission({ role: 'shopboard' }, 'daily', 'update'), false);
  assert.equal(hasPermission({ role: 'shopboard' }, 'parts', 'delete'), false);
});
