const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');

// In-memory stand-ins for the database and activity log.
let jobs = [], links = [], updates = [], settings = {};
function query(sql, args = []) {
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
  if (sql.startsWith('SELECT job_id FROM customer_portal_links WHERE token')) return { rows: links.filter(l => l.token === args[0]) };
  if (sql.startsWith('SELECT token FROM customer_portal_links WHERE job_id')) return { rows: links.filter(l => l.job_id === args[0]) };
  if (sql.startsWith('INSERT INTO customer_portal_links')) { if (!links.some(l => l.job_id === args[0])) links.push({ job_id: args[0], token: args[1] }); return { rows: [] }; }
  if (sql.startsWith('SELECT * FROM daily_go_list WHERE id=$1')) return { rows: jobs.filter(j => j.id === args[0]) };
  if (sql.startsWith('SELECT * FROM daily_go_list WHERE btrim(ro_number)=$1')) return { rows: jobs.filter(j => j.ro_number.trim() === args[0] && !j.merged_into) };
  if (sql.startsWith('SELECT message, created_at FROM customer_updates')) return { rows: updates.filter(u => u.job_id === args[0]) };
  if (sql.startsWith('SELECT l.job_id, l.token')) {
    const ids = [...new Set([...links.map(l => l.job_id), ...updates.map(u => u.job_id)])];
    return { rows: ids.map(id => { const mine = updates.filter(u => u.job_id === id); return { job_id: id, token: (links.find(l => l.job_id === id) || {}).token || null, last_update_at: mine.length ? mine.map(u => u.created_at).sort().pop() : null, update_count: mine.length }; }) };
  }
  if (sql.startsWith('SELECT data FROM board_settings')) return { rows: [{ data: settings }] };
  if (sql.startsWith('UPDATE daily_go_list SET customer_updated_today')) {
    const j = jobs.find(x => x.id === args[0]); if (!j) return { rows: [] };
    Object.assign(j, { customer_updated_today: 'Yes', version: j.version + 1 }); return { rows: [j] };
  }
  if (sql.startsWith('INSERT INTO customer_updates')) { const u = { id: 'u' + (updates.length + 1), job_id: args[0], message: args[1], created_by: args[2], created_at: new Date().toISOString() }; updates.unshift(u); return { rows: [u] }; }
  return { rows: [] };
}
const pool = { query: async (s, a) => query(s, a), connect: async () => ({ query: async (s, a) => query(s, a), release() {} }) };
const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (/(^|\/)db$/.test(name)) return { pool };
  if (name.endsWith('/activityLogger')) return { logActivity: async () => {} };
  if (name.endsWith('/middleware/auth')) return { requireAuth: (q, s, n) => n() };
  if (name === 'express') return { Router: () => { const r = { routes: {}, mw: [], use(f) { r.mw.push(f); }, get(p, h) { r.routes['GET ' + p] = h; }, post(p, h) { r.routes['POST ' + p] = h; }, delete(p, h) { r.routes['DELETE ' + p] = h; } }; return r; } };
  return load.call(this, name, parent, ...rest);
};
const portal = require('../src/routes/portal');
Module._load = load;

async function call(router, key, { user, body = {}, params = {}, ip = '1.1.1.1' } = {}) {
  const out = {};
  const res = { set() { return res; }, status(c) { out.code = c; return res; }, json(b) { out.body = b; out.code = out.code || 200; return res; } };
  const req = { user, body, params, headers: { 'cf-connecting-ip': ip }, ip: '127.0.0.1' };
  for (const mw of router.mw) { let next = false; await mw(req, res, () => { next = true; }); if (!next) return out; }
  await router.routes[key](req, res);
  return out;
}
const job = (over = {}) => ({ id: 'j1', ro_number: '12345', customer_name: 'SMITH, JOHN', vehicle: '2023 Toyota RAV4 LE', job_kind: 'active',
  current_stage: 'Paint', last_progress_stage: 'Paint', ro_amount: 5400, hold_up_reason: 'Parts', end_of_day_notes: 'secret note', assigned_to: 'Travis',
  updated_at: '2026-10-08T17:00:00Z', stage_changed_at: '2026-10-08T16:00:00Z', version: 3, ...over });

test.beforeEach(() => { jobs = [job()]; links = [{ job_id: 'j1', token: 'tok_abcdefgh' }]; updates = []; settings = { customerPortal: { phone: '(209) 555-0100' } }; });

test('production stages map onto the customer steps', () => {
  const step = (current_stage, extra) => portal.customerStatus(job({ current_stage, ...extra }));
  assert.equal(step('Check-In').step, 0);
  assert.equal(step('Waiting Approval').step, 1);
  assert.equal(step('Waiting on Parts').step, 2);
  assert.equal(step('Prep').step, 4);
  assert.equal(step('Detail').step, 5);
  assert.equal(step('QC').step, 6);
  const ready = step('Ready for Delivery');
  assert.equal(ready.state, 'ready');
  assert.equal(ready.step, 7);
  assert.equal(step('Scheduled', { dropoff_date: '2026-10-12' }).headline, "We're expecting your vehicle on Monday, October 12.");
  assert.equal(step('Delivered', { delivered_at: '2026-10-08T20:00:00Z' }).state, 'delivered');
  assert.equal(step('Total Loss').state, 'closed');
});

test('a car on hold shows the step it reached, never the hold', () => {
  const s = portal.customerStatus(job({ current_stage: 'On Hold', last_progress_stage: 'Body' }));
  assert.equal(s.step, 3);
  assert.doesNotMatch(JSON.stringify(s), /hold/i);
  assert.equal(portal.customerStatus(job({ current_stage: 'On Hold', last_progress_stage: null })).step, 0, 'older jobs fall back to the first step');
});

test('last names match "Last, First", "First Last" and multi-word names', () => {
  assert.ok(portal.nameMatches('SMITH, JOHN', 'smith'));
  assert.ok(portal.nameMatches('John Smith Jr.', 'Smith'));
  assert.ok(portal.nameMatches('Maria De La Cruz', 'de la cruz'));
  assert.ok(portal.nameMatches('Maria De La Cruz', 'DeLaCruz'));
  assert.ok(portal.nameMatches("O'Brien, Pat", 'obrien'));
  assert.ok(!portal.nameMatches('SMITH, JOHN', 'john'), 'first name alone is not enough');
  assert.ok(!portal.nameMatches('SMITH, JOHN', 's'));
  assert.ok(!portal.nameMatches('SMITH, JOHN', 'smit'));
});

test('the status page shows progress and updates but no money, notes or staff names', async () => {
  updates = [{ job_id: 'j1', message: 'Parts arrived', created_at: '2026-10-08T18:00:00Z' }];
  const r = await call(portal.publicRouter, 'GET /status/:token', { params: { token: 'tok_abcdefgh' } });
  assert.equal(r.code, 200);
  assert.equal(r.body.ro, '12345');
  assert.equal(r.body.status.headline, 'Your vehicle is in paint.');
  assert.match(r.body.vehicleImage, /^\/img\/vehicles\/[a-z-]+\.jpg$/);
  assert.deepEqual(r.body.updates, [{ message: 'Parts arrived', at: '2026-10-08T18:00:00Z' }]);
  assert.equal(r.body.contact.phone, '(209) 555-0100');
  const text = JSON.stringify(r.body);
  for (const secret of ['5400', 'secret note', 'Travis', 'SMITH', 'JOHN', 'version']) assert.ok(!text.includes(secret), `leaked ${secret}`);
  assert.equal((await call(portal.publicRouter, 'GET /status/:token', { params: { token: 'nope_nope_nope' } })).code, 404);
});

test('links stop working 30 days after pickup, and estimates without an RO never show', async () => {
  jobs = [job({ current_stage: 'Delivered', delivered_at: new Date(Date.now() - 31 * 864e5).toISOString() })];
  assert.equal((await call(portal.publicRouter, 'GET /status/:token', { params: { token: 'tok_abcdefgh' } })).code, 404);
  jobs = [job({ job_kind: 'opportunity' })];
  assert.equal((await call(portal.publicRouter, 'GET /status/:token', { params: { token: 'tok_abcdefgh' } })).code, 404);
});

test('looking up by RO and last name returns the link; wrong names are refused and limited', async () => {
  const ok = await call(portal.publicRouter, 'POST /lookup', { body: { ro: '#12345', lastName: 'Smith' }, ip: '2.2.2.2' });
  assert.equal(ok.code, 200);
  assert.equal(ok.body.token, 'tok_abcdefgh');
  assert.equal((await call(portal.publicRouter, 'POST /lookup', { body: { ro: '12345', lastName: 'Jones' }, ip: '3.3.3.3' })).code, 404);
  let last;
  for (let i = 0; i < 11; i++) last = await call(portal.publicRouter, 'POST /lookup', { body: { ro: '99999', lastName: 'x' + i }, ip: '4.4.4.4' });
  assert.equal(last.code, 429, 'one visitor gets cut off after 10 misses');
  for (let i = 0; i < 9; i++) last = await call(portal.publicRouter, 'POST /lookup', { body: { ro: '12345', lastName: 'Wrong' }, ip: `5.5.5.${i}` });
  assert.equal(last.code, 429, 'one RO gets cut off after 8 misses from anywhere');
});

test('only office staff post updates, and posting marks the customer updated', async () => {
  const tech = { id: 't', role: 'body', fullName: 'Travis Tech' }, office = { id: 'o', role: 'office', fullName: 'Olivia Office' };
  assert.equal((await call(portal.staffRouter, 'POST /:jobId/updates', { user: tech, body: { message: 'hi' }, params: { jobId: 'j1' } })).code, 403);
  assert.equal((await call(portal.staffRouter, 'POST /:jobId/updates', { user: office, body: { message: '  ' }, params: { jobId: 'j1' } })).code, 400);
  const r = await call(portal.staffRouter, 'POST /:jobId/updates', { user: office, body: { message: 'Starting paint today' }, params: { jobId: 'j1' } });
  assert.equal(r.code, 201);
  assert.equal(jobs[0].customer_updated_today, 'Yes');
  assert.equal(r.body.job.version, 4, 'the editor gets the new version so Save still works');
  assert.equal(updates[0].message, 'Starting paint today');
});

test('the Customer Service list shows each job link and last update, for office staff only', async () => {
  const tech = { id: 't', role: 'body' }, office = { id: 'o', role: 'office', fullName: 'Olivia Office' };
  assert.equal((await call(portal.staffRouter, 'GET /', { user: tech })).code, 403);
  jobs.push(job({ id: 'j2', ro_number: '12346' }));
  await call(portal.staffRouter, 'POST /:jobId/updates', { user: office, body: { message: 'Parts are here' }, params: { jobId: 'j2' } });
  const r = await call(portal.staffRouter, 'GET /', { user: office });
  assert.equal(r.code, 200);
  const byId = Object.fromEntries(r.body.jobs.map(j => [j.jobId, j]));
  assert.match(byId.j1.url, /tok_abcdefgh/);
  assert.equal(byId.j1.updateCount, 0);
  assert.equal(byId.j2.url, null);
  assert.equal(byId.j2.updateCount, 1);
  assert.ok(byId.j2.lastUpdateAt);
});
