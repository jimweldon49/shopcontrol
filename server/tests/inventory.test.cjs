const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const calls = []; let queryImpl = async () => ({ rows: [] });
const db = { query: async (sql, args = []) => { calls.push({ sql, args }); return queryImpl(sql, args); }, release() {} };
const pool = { query: db.query, connect: async () => db };
function Router() { const r = { routes: [], middleware: [], use(...m) { this.middleware.push(...m); } }; for (const method of ['get', 'post', 'put', 'delete']) r[method] = function (path, ...handlers) { this.routes.push({ method, path, handlers }); }; return r; }
const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (name === 'express') return { Router };
  if (name === 'jsonwebtoken') return { verify: () => ({ id: 'user-1' }) };
  if (/(^|\/)db$/.test(name)) return { pool };
  return load.call(this, name, parent, ...rest);
};
const { assertCartAssignment } = require('../src/inventoryRules');
const inventory = require('../src/routes/inventory');
Module._load = load;

async function invoke(router, method, path, body = {}, user = { role: 'office', canDelete: true }) {
  const route = router.routes.find(r => r.method === method && r.path === path); assert.ok(route, `${method} ${path} exists`);
  const req = { headers: { authorization: 'Bearer fake-test-token' }, params: { id: '00000000-0000-4000-8000-000000000001' }, body, user: { id: 'user-1', username: 'test', fullName: 'Test', ...user } };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(data) { result = { status: this.statusCode, data }; return this; } };
  let result;
  const stack = [...router.middleware, ...route.handlers];
  async function run(i) { if (i >= stack.length) return; let nextPromise; await stack[i](req, res, () => nextPromise = run(i + 1)); if (nextPromise) await nextPromise; }
  await run(0);
  return result;
}
const userQuery = (sql, user) => sql.startsWith('SELECT id,username') ? { rows: [{ id: 'user-1', username: 'test', full_name: 'Test', active: true, role: user.role, can_delete: user.canDelete }] } : null;

test('assertCartAssignment rejects a part destined for a cart linked to a different RO', async () => {
  calls.length = 0;
  queryImpl = async sql => sql.startsWith('SELECT * FROM inventory_locations') ? { rows: [{ id: 'cart-1', kind: 'cart', name: 'Cart 12', ros: ['17902'] }] } : { rows: [] };
  await assert.rejects(() => assertCartAssignment(pool, '99999', 'cart-1'), /belongs to another RO/);
});

test('assertCartAssignment auto-claims an empty cart for the first RO placed on it', async () => {
  calls.length = 0;
  queryImpl = async sql => sql.startsWith('SELECT * FROM inventory_locations') ? { rows: [{ id: 'cart-2', kind: 'cart', name: 'Cart 7', ros: [] }] } : { rows: [] };
  await assertCartAssignment(pool, '17902', 'cart-2');
  const claim = calls.find(c => c.sql.startsWith('UPDATE inventory_locations SET ros'));
  assert.ok(claim);
  assert.deepEqual(claim.args[0], ['17902']);
});

test('assertCartAssignment allows a part whose RO is already explicitly linked', async () => {
  calls.length = 0;
  queryImpl = async sql => sql.startsWith('SELECT * FROM inventory_locations') ? { rows: [{ id: 'cart-3', kind: 'cart', name: 'Cart 12', ros: ['17902', '17902-S'] }] } : { rows: [] };
  await assertCartAssignment(pool, '17902-S', 'cart-3');
  assert.ok(!calls.some(c => c.sql.startsWith('UPDATE inventory_locations')));
});

test('assertCartAssignment ignores storage locations (no RO restriction)', async () => {
  calls.length = 0;
  queryImpl = async sql => sql.startsWith('SELECT * FROM inventory_locations') ? { rows: [{ id: 'loc-1', kind: 'storage', name: 'Glass storage', ros: [] }] } : { rows: [] };
  await assertCartAssignment(pool, '17902', 'loc-1');
  assert.ok(!calls.some(c => c.sql.startsWith('UPDATE inventory_locations')));
});

test('creating a cart with more than one linked RO requires confirm_same_car', async () => {
  calls.length = 0;
  queryImpl = async sql => userQuery(sql, { role: 'office', canDelete: true }) || { rows: [] };
  const result = await invoke(inventory, 'post', '/', { kind: 'cart', name: 'Cart 12', zone: 'North wall', shelf_count: 5, ros: ['17902', '17902-S'] });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /Confirm the linked ROs/);
  assert.ok(!calls.some(c => c.sql.startsWith('INSERT INTO inventory_locations')));
});

test('confirm_same_car allows saving a cart with multiple linked ROs', async () => {
  calls.length = 0;
  const inserted = { id: 'cart-4', kind: 'cart', name: 'Cart 12', ros: ['17902', '17902-S'] };
  queryImpl = async sql => {
    if (sql.startsWith('INSERT INTO inventory_locations')) return { rows: [inserted] };
    return userQuery(sql, { role: 'office', canDelete: true }) || { rows: [] };
  };
  const result = await invoke(inventory, 'post', '/', { kind: 'cart', name: 'Cart 12', zone: 'North wall', shelf_count: 5, ros: ['17902', '17902-S'], confirm_same_car: true });
  assert.equal(result.status, 201);
});

test('shrinking a cart below an occupied shelf is rejected', async () => {
  calls.length = 0;
  const before = { id: 'cart-5', kind: 'cart', name: 'Cart 12', zone: 'North wall', shelf_count: 5, has_top: true, ros: ['17902'] };
  queryImpl = async sql => {
    if (sql.startsWith('SELECT * FROM inventory_locations WHERE id=$1')) return { rows: [before] };
    if (sql.startsWith('SELECT id, parts_ro_number, part_shelf FROM parts')) return { rows: [{ id: 'p1', parts_ro_number: '17902', part_shelf: '5' }] };
    return userQuery(sql, { role: 'office', canDelete: true }) || { rows: [] };
  };
  const result = await invoke(inventory, 'put', '/:id', { kind: 'cart', name: 'Cart 12', zone: 'North wall', shelf_count: 3, has_top: true, ros: ['17902'] });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /shrinking this cart/);
});

test('deleting a location with onsite parts is rejected', async () => {
  calls.length = 0;
  queryImpl = async sql => {
    if (sql.startsWith('SELECT id, parts_ro_number, part_shelf FROM parts')) return { rows: [{ id: 'p1', parts_ro_number: '17902', part_shelf: '1' }] };
    return userQuery(sql, { role: 'office', canDelete: true }) || { rows: [] };
  };
  const result = await invoke(inventory, 'delete', '/:id', {});
  assert.equal(result.status, 400);
  assert.ok(!calls.some(c => c.sql.startsWith('DELETE FROM inventory_locations')));
});
