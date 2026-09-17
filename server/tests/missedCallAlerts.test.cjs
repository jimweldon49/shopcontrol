const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');

const calls = [];
let queryImpl = async () => ({ rows: [] });
const db = { query: async (sql, args = []) => { calls.push({ sql, args }); return queryImpl(sql, args); }, release() {} };
const pool = { query: db.query, connect: async () => db };

let sentEmails = [];
const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (/(^|\/)db$/.test(name)) return { pool };
  if (name.endsWith('/mailer')) return {
    smtpConfigured: () => true,
    sendTaskEmail: async (opts) => { sentEmails.push(opts); return { sent: true }; },
  };
  if (name.endsWith('/taskEmails')) return { isBusinessHours: () => businessHours };
  return load.call(this, name, parent, ...rest);
};
let businessHours = true;
const { sendMissedCallAlert, checkMissedCallEscalation } = require('../src/missedCallAlerts');
Module._load = load;

const ASSIGNED_USER = { id: 'u1', email: 'alice@shop.test', full_name: 'Alice' };
const ESCALATION_USER = { id: 'u2', email: 'boss@shop.test', full_name: 'Boss' };

function baseCall(overrides = {}) {
  return {
    id: 'call-1', assigned_to: null, caller_name: 'Jane Doe', callback_phone: '555-1234',
    reason: 'Repair status', priority: 'Normal', message: 'Wants an update.', ro_number: '17939',
    status: 'New', created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    ...overrides,
  };
}

test('sendMissedCallAlert emails the assigned employee and records a notification row', async () => {
  calls.length = 0; sentEmails = [];
  queryImpl = async (sql) => {
    if (sql.startsWith('SELECT id, email, full_name FROM users WHERE id=$1')) return { rows: [ASSIGNED_USER] };
    if (sql.startsWith('INSERT INTO missed_call_events')) return { rows: [{ id: 'evt-1' }] };
    if (sql.startsWith('INSERT INTO missed_call_notifications')) return { rows: [{ id: 'notif-1' }] };
    return { rows: [] };
  };
  const result = await sendMissedCallAlert(baseCall({ assigned_to: 'u1' }), 'created');
  assert.equal(result.sent, 1);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'alice@shop.test');
  assert.match(sentEmails[0].subject, /New callback request/);
  assert.ok(calls.some(c => c.sql.startsWith('UPDATE missed_call_notifications SET email_sent_at')));
});

test('sendMissedCallAlert falls back to the configured escalation group when unassigned', async () => {
  calls.length = 0; sentEmails = [];
  queryImpl = async (sql) => {
    if (sql.startsWith('SELECT data FROM board_settings')) return { rows: [{ data: { missedCallEscalation: ['u2'] } }] };
    if (sql.startsWith('SELECT id, email, full_name FROM users WHERE active=true')) return { rows: [ESCALATION_USER] };
    if (sql.startsWith('INSERT INTO missed_call_events')) return { rows: [{ id: 'evt-2' }] };
    if (sql.startsWith('INSERT INTO missed_call_notifications')) return { rows: [{ id: 'notif-2' }] };
    return { rows: [] };
  };
  const result = await sendMissedCallAlert(baseCall({ assigned_to: null }), 'created');
  assert.equal(result.sent, 1);
  assert.equal(sentEmails[0].to, 'boss@shop.test');
});

test('checkMissedCallEscalation does nothing outside business hours', async () => {
  calls.length = 0; businessHours = false;
  const result = await checkMissedCallEscalation();
  assert.equal(result.checked, false);
  assert.equal(calls.length, 0);
  businessHours = true;
});

test('an attempt logged within the first hour satisfies the deadline without emailing', async () => {
  calls.length = 0; sentEmails = [];
  const overdueCall = baseCall({ id: 'call-satisfied' });
  queryImpl = async (sql, args) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.startsWith('SELECT * FROM missed_calls')) return { rows: [overdueCall] };
    if (sql.startsWith('SELECT 1 FROM callback_attempts')) return { rows: [{ '?column?': 1 }] }; // an attempt exists
    return { rows: [] };
  };
  const result = await checkMissedCallEscalation();
  assert.equal(result.satisfied, 1);
  assert.equal(result.escalated, 0);
  assert.equal(sentEmails.length, 0);
  assert.ok(calls.some(c => c.sql.startsWith('UPDATE missed_calls SET escalation_sent_at=now()') && c.args[0] === 'call-satisfied'));
});

test('an overdue call with no logged attempt pages the escalation group exactly once', async () => {
  calls.length = 0; sentEmails = [];
  const overdueCall = baseCall({ id: 'call-overdue' });
  queryImpl = async (sql, args) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.startsWith('SELECT * FROM missed_calls')) return { rows: [overdueCall] };
    if (sql.startsWith('SELECT 1 FROM callback_attempts')) return { rows: [] }; // no attempt logged
    if (sql.startsWith('SELECT data FROM board_settings')) return { rows: [{ data: { missedCallEscalation: ['u2'] } }] };
    if (sql.startsWith('SELECT id, email, full_name FROM users WHERE active=true')) return { rows: [ESCALATION_USER] };
    if (sql.startsWith('INSERT INTO missed_call_events')) return { rows: [{ id: 'evt-3' }] };
    if (sql.startsWith('INSERT INTO missed_call_notifications')) return { rows: [{ id: 'notif-3' }] };
    return { rows: [] };
  };
  const result = await checkMissedCallEscalation();
  assert.equal(result.escalated, 1);
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].subject, /^OVERDUE CALLBACK/);
  assert.ok(calls.some(c => c.sql.startsWith('UPDATE missed_calls SET escalation_sent_at=now()') && c.args[0] === 'call-overdue'));
});

test('an overdue call is flagged in the activity log (not silently dropped) when no escalation group is configured', async () => {
  calls.length = 0; sentEmails = [];
  const overdueCall = baseCall({ id: 'call-unconfigured' });
  queryImpl = async (sql) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.startsWith('SELECT * FROM missed_calls')) return { rows: [overdueCall] };
    if (sql.startsWith('SELECT 1 FROM callback_attempts')) return { rows: [] };
    if (sql.startsWith('SELECT data FROM board_settings')) return { rows: [{ data: { missedCallEscalation: [] } }] };
    return { rows: [] };
  };
  const result = await checkMissedCallEscalation();
  assert.equal(result.escalated, 0);
  assert.equal(sentEmails.length, 0);
  assert.ok(calls.some(c => c.sql.startsWith("INSERT INTO activity_log(resource,action,summary) VALUES('missed_calls','escalation_skipped'")));
  assert.ok(calls.some(c => c.sql.startsWith('UPDATE missed_calls SET escalation_sent_at=now()') && c.args[0] === 'call-unconfigured'));
});
