const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');

const calls = [];
let queryImpl = async () => ({ rows: [] });
const pool = { query: async (sql, args = []) => { calls.push({ sql, args }); return queryImpl(sql, args); }, connect: async () => ({ query: pool.query, release() {} }) };
const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (/(^|\/)db$/.test(name)) return { pool };
  if (name.endsWith('/activityLogger')) return { logActivity: async () => {} };
  if (name.endsWith('/mailer')) return { sendTaskEmail: async () => ({ sent: true }), smtpConfigured: () => true };
  if (name.endsWith('/captureOpportunityAlerts')) return { checkCaptureOpportunityAlerts: async () => ({}) };
  if (name.endsWith('/middleware/auth')) return { requireAuth: (req, res, next) => next() };
  if (name === 'express') return { Router: () => ({ use() {}, get() {}, post() {}, put() {}, delete() {} }) };
  return load.call(this, name, parent, ...rest);
};
const { trainingStatus } = require('../src/routes/training');
const { cleanSheet } = require('../src/routes/meeting');
const gcal = require('../src/googleCalendar');
Module._load = load;

const course = (due, done = null) => ({ due_date: due, completed_on: done });

test('training pace: about an even share of the year\'s courses should be done by now', () => {
  const four = [course('2026-12-31'), course('2026-12-31'), course('2026-12-31'), course('2026-12-31')];
  // July 10: just over half the year gone, so 2 of 4 should be done.
  assert.equal(trainingStatus(four, '2026-07-10').status, 'behind');
  assert.equal(trainingStatus(four, '2026-07-10').behindBy, 2);
  assert.equal(trainingStatus([course('2026-12-31', '2026-03-01'), course('2026-12-31', '2026-05-01'), ...four.slice(2)], '2026-07-10').status, 'on track');
  assert.equal(trainingStatus(four, '2026-02-01').status, 'on track'); // early in the year: none needed yet
  assert.equal(trainingStatus([course('2026-06-30'), course('2026-12-31')], '2026-07-10').status, 'overdue');
  assert.equal(trainingStatus([course('2026-12-31', '2026-01-10')], '2026-07-10').status, 'done');
  // Last year's leftover that's still not done counts as overdue, not toward this year's total.
  const s = trainingStatus([course('2025-12-31'), course('2026-12-31')], '2026-03-01');
  assert.deepEqual([s.status, s.total, s.overdue], ['overdue', 1, 1]);
});

test('publishing the meeting sheet takes out dollar amounts and totals', () => {
  const out = cleanSheet([
    { title: 'Out List – today', lines: ['12345 – 2020 Honda Accord – $1,500 – 1 parts issue', '77777 – 2022 Ram 2500 – $11,000', 'Total – $12,500'] },
    { title: 'Time off', level: 3, lines: ['Luis – Vacation, out through Fri 10/23'] },
  ]);
  assert.deepEqual(out, [
    { title: 'Out List – today', level: 2, lines: ['12345 – 2020 Honda Accord – 1 parts issue', '77777 – 2022 Ram 2500'] },
    { title: 'Time off', level: 3, lines: ['Luis – Vacation, out through Fri 10/23'] },
  ]);
  assert.throws(() => cleanSheet([]), /empty/);
});

// ------------------------------------------------------------- Google Calendar
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gcal-')), 'key.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'sync@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' }));
process.env.GOOGLE_CALENDAR_ID = 'shop@example.com';
process.env.GOOGLE_SERVICE_ACCOUNT_FILE = keyFile;
process.env.BUSINESS_TIMEZONE = 'America/Los_Angeles';

test('appointments become Google events in shop time, and Google events come back the same', () => {
  const ev = gcal.toEvent({ id: 'a1', title: 'Jairo – I-CAR: Welding', appointment_type: 'Training', appointment_date: '2026-10-16', appointment_time: '07:30:00', duration: 480, location: 'I-CAR Modesto', notes: 'Bring gloves' });
  assert.deepEqual(ev.start, { dateTime: '2026-10-16T07:30:00', timeZone: 'America/Los_Angeles' });
  assert.deepEqual(ev.end, { dateTime: '2026-10-16T15:30:00', timeZone: 'America/Los_Angeles' });
  assert.equal(ev.extendedProperties.private.shopcontrolType, 'Training');
  const back = gcal.fromEvent({ ...ev, start: { dateTime: '2026-10-16T07:30:00-07:00' }, end: { dateTime: '2026-10-16T15:30:00-07:00' } });
  assert.deepEqual(back, { title: 'Jairo – I-CAR: Welding', appointment_type: 'Training', appointment_date: '2026-10-16', appointment_time: '07:30', duration: 480, location: 'I-CAR Modesto', notes: 'Bring gloves' });
  const allDay = gcal.fromEvent({ summary: 'Dentist', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } });
  assert.deepEqual([allDay.appointment_type, allDay.appointment_time, allDay.duration, allDay.location], ['Google Calendar', '00:00', 1440, 'Google Calendar']);
});

test('a sync sends ShopControl changes and deletes, then brings in Google changes', async () => {
  calls.length = 0;
  const requests = [];
  gcal._setFetch(async (url, opts = {}) => {
    requests.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? (String(opts.body).startsWith('{') ? JSON.parse(opts.body) : opts.body) : null });
    const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
    if (String(url).startsWith('https://oauth2')) return ok({ access_token: 'tok', expires_in: 3600 });
    if (opts.method === 'DELETE') return ok(null, 204);
    if (opts.method === 'POST') return ok({ id: 'g-new' });
    return ok({ items: [
      { id: 'g-new', status: 'confirmed', summary: 'Jairo – I-CAR', start: { dateTime: '2026-10-16T07:30:00-07:00' }, end: { dateTime: '2026-10-16T08:00:00-07:00' } },
      { id: 'g-dentist', status: 'confirmed', summary: 'Dentist', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } },
      { id: 'g-gone', status: 'cancelled' },
    ], nextSyncToken: 'sync-1' });
  });
  queryImpl = async (sql) => {
    if (sql.startsWith('SELECT event_id FROM google_calendar_deletes')) return { rows: [{ event_id: 'g-old' }] };
    if (sql.startsWith('SELECT * FROM appointments WHERE google_dirty')) return { rows: [{ id: 'a1', title: 'Jairo – I-CAR', appointment_type: 'Training', appointment_date: '2026-10-16', appointment_time: '07:30', duration: 30, location: 'Shop', updated_at: 't1', google_event_id: null }] };
    if (sql.startsWith('SELECT * FROM google_calendar_sync')) return { rows: [] };
    if (sql.startsWith('UPDATE appointments SET title=')) return { rowCount: 0, rows: [] };
    if (sql.startsWith('SELECT 1 FROM appointments WHERE google_event_id')) return { rows: [] };
    if (sql.startsWith('DELETE FROM appointments WHERE google_event_id')) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  };
  const result = await gcal.syncGoogleCalendar();
  assert.deepEqual(result, { pushed: 2, pulled: 3 });
  const api = requests.filter((r) => r.url.includes('/calendar/v3/'));
  assert.equal(api[0].method, 'DELETE');
  assert.match(api[0].url, /calendars\/shop%40example\.com\/events\/g-old$/);
  assert.equal(api[1].method, 'POST');
  assert.equal(api[1].body.summary, 'Jairo – I-CAR');
  assert.match(api[2].url, /singleEvents=true.*timeMin=/);
  assert.ok(calls.some((c) => c.sql.startsWith('UPDATE appointments SET google_event_id') && c.args[0] === 'g-new'));
  assert.ok(calls.some((c) => c.sql.startsWith('SET LOCAL shopcontrol.google_pull')), 'deletes from Google don\'t bounce back');
  assert.ok(calls.some((c) => c.sql.includes('INSERT INTO google_calendar_sync') && c.args.includes('sync-1')));
});
