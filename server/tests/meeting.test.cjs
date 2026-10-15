const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');

let data;
const calls = [];
const pool = {
  query: async (sql, args = []) => {
    calls.push({ sql, args });
    if (sql.startsWith('SELECT * FROM meeting_topics WHERE status = \'open\' OR (status')) return { rows: data.topics };
    if (sql.includes('FROM time_off_requests')) return { rows: data.timeOff };
    if (sql.includes('FROM appointments')) return { rows: data.appointments };
    if (sql.includes('FROM daily_go_list')) return { rows: data.jobs };
    if (sql.includes('FROM parts')) return { rows: data.parts.filter((p) => args[0].includes(p.parts_ro_number)) };
    if (sql.startsWith('INSERT INTO meeting_topics')) return { rows: [{ id: 't9', text: args[0], submitted_by_id: args[1], submitted_by_name: args[2], anonymous: args[3], status: 'open', created_at: 'now' }] };
    return { rows: [] };
  },
};
const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (/(^|\/)db$/.test(name)) return { pool };
  if (name.endsWith('/activityLogger')) return { logActivity: async () => {} };
  if (name.endsWith('/mailer')) return { sendTaskEmail: async () => ({ sent: true }) };
  if (name.endsWith('/captureOpportunityAlerts')) return { checkCaptureOpportunityAlerts: async () => ({}) };
  if (name.endsWith('/middleware/auth')) return { requireAuth: (req, res, next) => next() };
  if (name === 'express') return { Router: () => { const r = { routes: {}, use() {}, get(p, ...h) { r.routes['GET ' + p] = h; }, post(p, ...h) { r.routes['POST ' + p] = h; }, put(p, ...h) { r.routes['PUT ' + p] = h; }, delete(p, ...h) { r.routes['DELETE ' + p] = h; } }; return r; } };
  return load.call(this, name, parent, ...rest);
};
const meeting = require('../src/routes/meeting');
Module._load = load;
const { buildNotes, nextWorkDay } = meeting;

const job = (ro, extra = {}) => ({
  id: `job-${ro}`, ro_number: ro, ccc_estfile_id: null, vehicle: '2021 Tesla Model 3 / White', customer_name: 'Cust', current_stage: 'Body',
  onsite: true, insurance: null, ro_amount: 1500, board_flags: [], created_at: '2026-10-14T19:00:00Z', target_delivery_date: null, ...extra,
});

function reset() {
  calls.length = 0;
  data = {
    topics: [{ id: 't1', text: 'Roll all windows up when parking a car', submitted_by_name: 'Vinny', status: 'open', created_at: '2026-10-14T20:00:00Z' }],
    timeOff: [
      { full_name: 'Luis Soto', request_type: 'Vacation', start_date: '2026-10-12', end_date: '2026-10-23', partial_day: false },
      { full_name: 'Mickey', request_type: 'Vacation', start_date: '2026-10-19', end_date: '2026-10-23', partial_day: false, notes: 'Disneyland' },
    ],
    appointments: [{ id: 'a1', title: 'Jairo – I-CAR welding', appointment_type: 'Training', appointment_time: '07:00:00', location: 'Off site', duration: 480 }],
    jobs: [
      job('88888', { current_stage: 'Check-In', onsite: false }),                  // checked in = teardown
      job('99999', { current_stage: 'Tear Down', vehicle: '2019 Chevrolet Silverado / Red' }),
      job('77000', { current_stage: 'Tear Down', onsite: false }),                 // not here yet: not a teardown
      job('12345', { current_stage: 'Paint', insurance: 'Allstate', board_flags: ['DRP'], created_at: '2026-10-10T19:00:00Z', target_delivery_date: '2026-10-15' }), // DRP, due 10/12
      job('11111', { current_stage: 'Sublet', created_at: '2026-10-10T19:00:00Z' }),  // non-DRP, due 10/13
      job('66666', { ro_amount: 2500, target_delivery_date: '2026-10-15' }),
      job('55555', { ro_amount: 11000, target_delivery_date: '2026-10-16' }),
    ],
    parts: [
      { parts_ro_number: '12345', part_status: 'Backordered', part_eta: null, part_mirror_matched: 'No' },
      { parts_ro_number: '66666', part_status: 'Received', part_eta: null, part_mirror_matched: 'No' },
      { parts_ro_number: '66666', part_status: 'Ordered', part_eta: '2026-10-13', part_mirror_matched: 'No' },
      { parts_ro_number: '66666', part_status: 'Mirror Matched', part_eta: '2026-10-13', part_mirror_matched: 'Yes' },
    ],
  };
}

test('the next work day skips the weekend', () => {
  assert.equal(nextWorkDay('2026-10-15'), '2026-10-16');
  assert.equal(nextWorkDay('2026-10-16'), '2026-10-19');
});

test('the meeting notes pull every section together', async () => {
  reset();
  const n = await buildNotes('2026-10-15');
  assert.deepEqual(n.housekeeping.map((t) => `${t.text} – ${t.by}`), ['Roll all windows up when parking a car – Vinny']);
  assert.deepEqual(n.absences.now.map((a) => a.text), ['Luis Soto – Vacation, out through Fri 10/23']);
  assert.deepEqual(n.absences.upcoming.map((a) => a.text), ['Mickey – Vacation, Mon 10/19 – Fri 10/23']);
  assert.ok(!JSON.stringify(n.absences).includes('Disneyland'), 'time off notes stay private');
  assert.deepEqual(n.meetings.map((m) => `${m.time} ${m.title}`), ['7:00 AM Jairo – I-CAR welding']);
  assert.deepEqual(n.teardowns.map((c) => c.ro), ['88888', '99999']);
  assert.deepEqual(n.drpPastDue.map((c) => [c.ro, c.stage, c.insurance, c.partsIssues]), [['12345', 'Paint', 'Allstate', 1]]);
  assert.deepEqual(n.nonDrpPastDue.map((c) => c.ro), ['11111']);
  assert.deepEqual(n.outToday.cars.map((c) => [c.ro, c.amount, c.partsIssues]), [['12345', 1500, 1], ['66666', 2500, 2]]);
  assert.equal(n.outToday.total, 4000);
  assert.equal(n.nextDay, '2026-10-16');
  assert.deepEqual(n.outNext.cars.map((c) => c.ro), ['55555']);
  assert.equal(n.outNext.total, 11000);
});

function res() {
  const out = { code: 200, body: null };
  out.status = (c) => { out.code = c; return out; };
  out.json = (b) => { out.body = b; return out; };
  return out;
}
const call = async (route, req) => { const r = res(); const h = meeting.routes[route]; await h[h.length - 1](req, r); return r; };

test('anyone can add a topic; only office staff and managers see the notes and review topics', async () => {
  reset();
  const tech = { id: 'u2', fullName: 'Jairo', role: 'body' };
  const added = await call('POST /topics', { user: tech, body: { text: '  Keep   the horns   beeping  ' } });
  assert.equal(added.code, 201);
  assert.equal(added.body.text, 'Keep the horns beeping');
  assert.equal(added.body.by, 'Jairo');
  assert.equal(added.body.anonymous, false);
  // Anonymous: prints as "Anonymous", but the name is still kept for the office.
  const anon = await call('POST /topics', { user: tech, body: { text: 'Only one earbud', anonymous: true } });
  assert.equal(anon.body.anonymous, true);
  assert.equal(anon.body.by, 'Jairo');
  assert.equal((await call('POST /topics', { user: tech, body: { text: '   ' } })).code, 400);
  assert.equal((await call('GET /notes', { user: tech, query: {} })).code, 403);
  assert.equal((await call('GET /topics', { user: tech, query: {} })).code, 403);
  assert.equal((await call('PUT /topics/:id', { user: tech, params: { id: 't1' }, body: { status: 'hidden' } })).code, 403);
  const office = await call('GET /notes', { user: { id: 'u1', fullName: 'Alyssa', role: 'office' }, query: { date: '2026-10-15' } });
  assert.equal(office.code, 200);
  assert.equal(office.body.date, '2026-10-15');
});
