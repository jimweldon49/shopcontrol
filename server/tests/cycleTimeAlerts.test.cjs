const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');

const calls = [];
let jobs = [], digestSentToday = false;
const pool = {
  query: async (sql, args = []) => {
    calls.push({ sql, args });
    if (sql.includes('FROM daily_go_list d LEFT JOIN tech_board_jobs')) return { rows: jobs };
    if (sql.startsWith('SELECT email FROM users')) return { rows: [{ email: 'a@shop.test' }, { email: 'b@shop.test' }] };
    if (sql.startsWith('SELECT 1 FROM cycle_digest_days')) return { rows: digestSentToday ? [{}] : [] };
    if (sql.startsWith('INSERT INTO cycle_digest_days')) { if (digestSentToday) return { rows: [] }; digestSentToday = true; return { rows: [{ day: args[0] }] }; }
    return { rows: [] };
  },
};
let sentEmails = [];
const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (/(^|\/)db$/.test(name)) return { pool };
  if (name.endsWith('/mailer')) return { sendTaskEmail: async (opts) => { sentEmails.push(opts); return { sent: true }; } };
  if (name.endsWith('/captureOpportunityAlerts')) return { checkCaptureOpportunityAlerts: async () => ({}) };
  return load.call(this, name, parent, ...rest);
};
const { checkCycleTimeAlerts, cycleTargetDate } = require('../src/cycleTimeAlerts');
Module._load = load;

// Thursday Oct 15 2026, 6:05 AM in the shop (Pacific).
const THU_6_05 = new Date('2026-10-15T13:05:00Z');
const job = (id, amount, createdLocalDay, extra = {}) => ({
  id, ro_number: id, customer_name: `Cust ${id}`, vehicle: '2020 Honda Civic / Blue', ro_amount: amount,
  created_at: `${createdLocalDay}T19:00:00Z`, current_stage: 'Body', board_flags: [], tech_board_hot: false,
  cycle_24h_reminder_sent_at: null, cycle_past_due_sent_at: null, ...extra,
});

function reset() {
  calls.length = 0; sentEmails = []; digestSentToday = false;
  jobs = [
    job('18001', 1500, '2026-10-12', { board_flags: ['DRP'] }), // DRP 2 days -> Oct 14: past due
    job('18002', 1500, '2026-10-12'),                            // non-DRP 3 days -> Oct 15: due today
    job('18003', 3000, '2026-10-11'),                            // non-DRP 5 days -> Oct 16: due tomorrow
    job('18004', 1500, '2026-10-10', { tech_board_hot: true }),  // hot, past due -> its own email
    job('18005', 12000, '2026-10-14', { board_flags: ['DRP'] }), // Oct 29: not listed
  ];
}

test('DRP jobs get the tier days; every other job gets one more day', () => {
  assert.equal(cycleTargetDate(job('x', 1500, '2026-10-12', { board_flags: ['DRP'] })), '2026-10-14');
  assert.equal(cycleTargetDate(job('x', 1500, '2026-10-12')), '2026-10-15');
  assert.equal(cycleTargetDate(job('x', 3000, '2026-10-12', { board_flags: ['DRP', 'Sublet'] })), '2026-10-16');
  assert.equal(cycleTargetDate(job('x', 15000, '2026-10-12', { board_flags: null })), '2026-10-28');
});

test('at 6 AM on a weekday one email lists every past due, due today and due tomorrow car; a hot car gets its own', async () => {
  reset();
  const result = await checkCycleTimeAlerts(THU_6_05);
  assert.equal(result.sentDigest, 1);
  assert.equal(result.sentPastDue, 1);
  assert.equal(sentEmails.length, 2);

  const hot = sentEmails.find(e => e.subject.startsWith('HOT'));
  assert.equal(hot.subject, 'HOT · PAST DUE cycle time: RO 18004 - Cust 18004');
  assert.equal(hot.to, 'a@shop.test,b@shop.test');

  const digest = sentEmails.find(e => !e.subject.startsWith('HOT'));
  assert.equal(digest.subject, 'Cycle time for 2026-10-15: 1 past due, 1 due today, 1 due tomorrow');
  const body = digest.bodyLines.join('\n');
  assert.match(body, /PAST DUE \(1\)\n\s+RO 18001 .*DRP · due 2026-10-14/);
  assert.match(body, /DUE TODAY \(1\)\n\s+RO 18002 .*non-DRP · due 2026-10-15/);
  assert.match(body, /DUE TOMORROW \(1\)\n\s+RO 18003 .*non-DRP · due 2026-10-16/);
  assert.doesNotMatch(body, /RO 18004|RO 18005/);
  // No per-car emails for the cars in the list.
  assert.ok(!calls.some(c => c.sql.startsWith('UPDATE daily_go_list') && c.args.includes('18001')));
});

test('the list goes out once a day; later checks only send new hot car emails', async () => {
  reset();
  await checkCycleTimeAlerts(THU_6_05);
  jobs.find(j => j.id === '18004').cycle_past_due_sent_at = new Date();
  sentEmails = [];
  const again = await checkCycleTimeAlerts(new Date('2026-10-15T16:00:00Z'));
  assert.equal(again.sentDigest, 0);
  assert.equal(sentEmails.length, 0);
});

test('before 6 AM and on weekends there is no list, but hot cars still get their email', async () => {
  reset();
  const early = await checkCycleTimeAlerts(new Date('2026-10-15T12:30:00Z')); // 5:30 AM
  assert.equal(early.sentDigest, 0);
  assert.deepEqual(sentEmails.map(e => e.subject), ['HOT · PAST DUE cycle time: RO 18004 - Cust 18004']);

  reset();
  const saturday = await checkCycleTimeAlerts(new Date('2026-10-17T16:00:00Z'));
  assert.equal(saturday.sentDigest, 0);
  assert.ok(sentEmails.every(e => e.subject.startsWith('HOT')));
});

test('a hot car due tomorrow gets one reminder of its own', async () => {
  reset();
  jobs = [job('18010', 3000, '2026-10-11', { tech_board_hot: true })]; // due Oct 16
  await checkCycleTimeAlerts(new Date('2026-10-15T12:00:00Z'));
  assert.deepEqual(sentEmails.map(e => e.subject), ['HOT · Delivery due tomorrow: RO 18010 - Cust 18010']);
  assert.ok(calls.some(c => c.sql.includes('cycle_24h_reminder_sent_at = now()')));
});
