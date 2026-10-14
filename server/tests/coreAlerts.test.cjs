const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');

const calls = [];
let queryImpl = async () => ({ rows: [] });
const pool = { query: async (sql, args = []) => { calls.push({ sql, args }); return queryImpl(sql, args); } };

let sentEmails = [];
const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (/(^|\/)db$/.test(name)) return { pool };
  if (name.endsWith('/mailer')) return { sendTaskEmail: async (opts) => { sentEmails.push(opts); return { sent: true }; }, smtpConfigured: () => true };
  return load.call(this, name, parent, ...rest);
};
const { checkOverdueCores } = require('../src/coreNotifications');
Module._load = load;

const CORE = { parts_ro_number: '17938', parts_customer_name: 'Jane Doe', parts_vehicle: '2022 Honda Passport', part_description: 'LT/Front Wheel', part_assigned_to: 'Vinny', core_flagged_at: '2026-10-10T17:00:00Z' };

function reset({ overdue = [CORE], emails = ['a@shop.test', 'b@shop.test'] } = {}) {
  calls.length = 0; sentEmails = [];
  queryImpl = async (sql) => {
    if (sql.startsWith('UPDATE parts SET core_overdue_alerted_at')) return { rows: overdue };
    if (sql.startsWith('SELECT email FROM users')) return { rows: emails.map(email => ({ email })) };
    return { rows: [] };
  };
}

test('a core not returned in 3 days emails every staff member once, urgently, with the RO and part', async () => {
  reset();
  const result = await checkOverdueCores();
  assert.equal(result.sent, 2);
  assert.deepEqual(sentEmails.map(e => e.to), ['a@shop.test', 'b@shop.test']);
  assert.equal(sentEmails[0].subject, 'URGENT: core not returned in 3 days · RO 17938');
  const body = sentEmails[0].bodyLines.join('\n');
  assert.match(body, /addressed immediately/);
  assert.match(body, /RO 17938 · LT\/Front Wheel/);
  assert.match(body, /2022 Honda Passport · Jane Doe · Assigned to Vinny/);
  // The cores are claimed in the same statement that finds them, so they're only sent once.
  const claim = calls.find(c => c.sql.startsWith('UPDATE parts SET core_overdue_alerted_at'));
  assert.deepEqual(claim.args, [3]);
  assert.match(claim.sql, /NOT core_returned/);
});

test('several overdue cores go out in one email per person', async () => {
  reset({ overdue: [CORE, { ...CORE, parts_ro_number: '18002', part_description: 'Alternator' }] });
  await checkOverdueCores();
  assert.equal(sentEmails.length, 2);
  assert.equal(sentEmails[0].subject, 'URGENT: cores not returned in 3 days · RO 17938, RO 18002');
});

test('nothing overdue sends nothing', async () => {
  reset({ overdue: [] });
  const result = await checkOverdueCores();
  assert.equal(result.sent, 0);
  assert.equal(sentEmails.length, 0);
});
