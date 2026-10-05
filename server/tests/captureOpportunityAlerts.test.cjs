const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');

const calls = [];
let queryImpl = async () => ({ rows: [] });
const pool = { query: async (sql, args = []) => { calls.push({ sql, args }); return queryImpl(sql, args); } };

let sentEmails = [];
let mailResult = { sent: true };
let businessHours = true;
const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (/(^|\/)db$/.test(name)) return { pool };
  if (name.endsWith('/mailer')) return { sendTaskEmail: async (opts) => { sentEmails.push(opts); return mailResult; } };
  if (name.endsWith('/taskEmails')) return { isBusinessHours: () => businessHours };
  return load.call(this, name, parent, ...rest);
};
const { checkCaptureOpportunityAlerts } = require('../src/captureOpportunityAlerts');
Module._load = load;

const JOB = { id: 'job-1', ro_number: 'EST-12', customer_name: 'Jane Doe', vehicle: '2019 Honda Civic', ro_amount: '2450.00', estimator: 'Marc', created_at: '2026-10-01T16:00:00Z', alerts_sent: 0, last_call_at: null };

function reset({ due = [JOB], emails = ['office@shop.test'] } = {}) {
  calls.length = 0; sentEmails = []; mailResult = { sent: true }; businessHours = true;
  queryImpl = async (sql) => {
    if (sql.includes('FROM daily_go_list d')) return { rows: due };
    if (sql.startsWith('SELECT email FROM users')) return { rows: emails.map(email => ({ email })) };
    return { rows: [] };
  };
}

test('each due opportunity gets its own email to office staff and its reminder count goes up', async () => {
  reset({ due: [JOB, { ...JOB, id: 'job-2', customer_name: 'Sam Roe', vehicle: '2018 F-150', alerts_sent: 2, last_call_at: '2026-10-03T17:00:00Z', last_call_by: 'Ana', last_call_outcome: 'No answer' }] });
  const result = await checkCaptureOpportunityAlerts();
  assert.equal(result.sent, 2);
  assert.equal(sentEmails.length, 2);
  assert.equal(sentEmails[0].to, 'office@shop.test');
  assert.equal(sentEmails[0].subject, 'CAPTURE OPPORTUNITY (call 1 of 3): Jane Doe - 2019 Honda Civic');
  assert.equal(sentEmails[1].subject, 'CAPTURE OPPORTUNITY (call 3 of 3, last): Sam Roe - 2018 F-150');
  assert.match(sentEmails[0].bodyLines.join('\n'), /Estimate: \$2450\.00[\s\S]*No calls logged yet[\s\S]*Reminder 1 of 3/);
  assert.match(sentEmails[1].bodyLines.join('\n'), /Last call: .* by Ana \(No answer\)[\s\S]*last reminder/);
  const users = calls.find(c => c.sql.startsWith('SELECT email FROM users'));
  assert.deepEqual(users.args[0], ['owner', 'admin', 'manager', 'office']);
  const state = calls.filter(c => c.sql.includes('INSERT INTO capture_alert_state')).map(c => c.args[0]);
  assert.deepEqual(state, ['job-1', 'job-2']);
});

test('the due query stops after 3 reminders, on a declined call and for closed or converted jobs', async () => {
  reset();
  await checkCaptureOpportunityAlerts();
  const q = calls.find(c => c.sql.includes('FROM daily_go_list d'));
  assert.match(q.sql, /job_kind = 'opportunity' AND d\.merged_into IS NULL/);
  assert.match(q.sql, /outcome = 'Customer declined'/);
  assert.match(q.sql, /greatest\(coalesce\(s\.last_alert_at, d\.created_at\), coalesce\(c\.called_at, d\.created_at\)\)/);
  assert.deepEqual(q.args, [['No Show', 'Delivered', 'Total Loss'], 3, 2]);
});

test('nothing is counted when the email does not go out', async () => {
  reset();
  mailResult = { sent: false, reason: 'smtp_not_configured' };
  const result = await checkCaptureOpportunityAlerts();
  assert.equal(result.sent, 0);
  assert.ok(!calls.some(c => c.sql.includes('INSERT INTO capture_alert_state')));
});

test('no email outside business hours, with nothing due, or with no office recipients', async () => {
  reset(); businessHours = false;
  assert.equal((await checkCaptureOpportunityAlerts()).checked, false);
  reset({ due: [] });
  assert.equal((await checkCaptureOpportunityAlerts()).sent, 0);
  reset({ emails: [] });
  assert.equal((await checkCaptureOpportunityAlerts()).reason, 'no_recipients');
  assert.equal(sentEmails.length, 0);
});
