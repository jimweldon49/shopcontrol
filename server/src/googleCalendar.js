const fs = require("fs");
const jwt = require("jsonwebtoken");
const { pool } = require("./db");

// Two-way sync with one Google Calendar (migrations/038), every 2 minutes:
//   push: appointments changed in ShopControl (google_dirty) are created/updated in Google;
//         ones deleted in ShopControl are deleted there (google_calendar_deletes).
//   pull: events added, changed or deleted in Google since the last sync (Google's sync
//         token) are added, changed or deleted here. A ShopControl change not pushed yet
//         wins over a Google change to the same event.
// Uses a Google service account: GOOGLE_SERVICE_ACCOUNT_FILE is its JSON key, and the
// calendar (GOOGLE_CALENDAR_ID) is shared with the service account's email with
// "Make changes to events". Off until both are set.
const API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar";
const TZ = () => process.env.BUSINESS_TIMEZONE || "America/Los_Angeles";
const PUSH_BACK_DAYS = 60; // older appointments aren't sent to Google
const PULL_BACK_DAYS = 30; // first sync brings in events from 30 days ago on
const PULL_AHEAD_DAYS = 365; // ...up to a year ahead (repeating events would otherwise go on for decades)
const FOOTER = "\n\n— From ShopControl";

const config = () => ({ calendarId: process.env.GOOGLE_CALENDAR_ID || "", keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "" });
const enabled = () => { const c = config(); return !!(c.calendarId && c.keyFile); };

let token = null;
let fetchImpl = (...args) => fetch(...args);

async function accessToken() {
  if (token && token.expires > Date.now() + 60000) return token.value;
  const key = JSON.parse(fs.readFileSync(config().keyFile, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign({ iss: key.client_email, scope: SCOPE, aud: key.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 },
    key.private_key, { algorithm: "RS256" });
  const res = await fetchImpl(key.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(`Google sign-in failed: ${body.error_description || body.error || res.status}`);
  token = { value: body.access_token, expires: Date.now() + (body.expires_in || 3600) * 1000 };
  return token.value;
}

async function google(method, path, { query, body } = {}) {
  const url = `${API}/calendars/${encodeURIComponent(config().calendarId)}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  const res = await fetchImpl(url, {
    method, headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { status: 204, body: null };
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}
const failed = (r, what) => Error(`${what}: Google said ${r.status} ${r.body?.error?.message || ""}`.trim());

// ------------------------------------------------------------------ Times
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10));
const hhmm = (t) => String(t || "00:00").slice(0, 5);
// Wall-clock arithmetic: "2026-10-15", "07:30", +90 min -> "2026-10-15T09:00:00".
function addMinutes(date, time, minutes) {
  const d = new Date(`${date}T${hhmm(time)}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 19);
}
// An instant -> the shop's local date and time.
function localParts(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function toEvent(a) {
  const date = day(a.appointment_date);
  return {
    summary: a.title,
    location: a.location || undefined,
    description: `${a.notes || ""}${FOOTER}`.trim(),
    start: { dateTime: `${date}T${hhmm(a.appointment_time)}:00`, timeZone: TZ() },
    end: { dateTime: addMinutes(date, a.appointment_time, a.duration || 30), timeZone: TZ() },
    extendedProperties: { private: { shopcontrolId: a.id, shopcontrolType: a.appointment_type } },
  };
}

function fromEvent(ev) {
  let date, time, duration;
  if (ev.start?.date) {
    date = ev.start.date; time = "00:00"; duration = 1440;
  } else {
    ({ date, time } = localParts(ev.start.dateTime));
    duration = Math.round((Date.parse(ev.end?.dateTime || ev.start.dateTime) - Date.parse(ev.start.dateTime)) / 60000);
  }
  duration = Math.min(1440, Math.max(5, duration || 30));
  const notes = String(ev.description || "").replace(FOOTER.trim(), "").trim();
  return {
    title: String(ev.summary || "(No title)").slice(0, 300),
    appointment_type: ev.extendedProperties?.private?.shopcontrolType || "Google Calendar",
    appointment_date: date, appointment_time: time, duration,
    location: String(ev.location || "Google Calendar").slice(0, 300),
    notes: notes || null,
  };
}

// ------------------------------------------------------------------ Push
async function push() {
  let pushed = 0;
  for (const { event_id } of (await pool.query("SELECT event_id FROM google_calendar_deletes ORDER BY created_at LIMIT 100")).rows) {
    const r = await google("DELETE", `/events/${encodeURIComponent(event_id)}`);
    if (![200, 204, 404, 410].includes(r.status)) throw failed(r, "Deleting an event");
    await pool.query("DELETE FROM google_calendar_deletes WHERE event_id = $1", [event_id]);
    pushed++;
  }
  // Too old to bother sending: just mark them clean.
  await pool.query(`UPDATE appointments SET google_dirty = false, google_synced_at = now()
                    WHERE google_dirty AND google_event_id IS NULL AND appointment_date < CURRENT_DATE - $1::int`, [PUSH_BACK_DAYS]);
  // updated_at as text: a JS Date drops the microseconds, so it would never compare equal.
  const dirty = (await pool.query("SELECT *, updated_at::text AS updated_at_exact FROM appointments WHERE google_dirty ORDER BY updated_at LIMIT 100")).rows;
  for (const a of dirty) {
    let r = a.google_event_id ? await google("PATCH", `/events/${encodeURIComponent(a.google_event_id)}`, { body: toEvent(a) }) : null;
    if (!r || r.status === 404 || r.status === 410) r = await google("POST", "/events", { body: toEvent(a) });
    if (r.status !== 200) throw failed(r, `Sending "${a.title}"`);
    // Keep the event id either way; stay dirty if someone changed it while it was being sent.
    await pool.query(
      "UPDATE appointments SET google_event_id = $1, google_synced_at = now(), google_dirty = (updated_at::text IS DISTINCT FROM $3) WHERE id = $2",
      [r.body.id, a.id, a.updated_at_exact]);
    pushed++;
  }
  return pushed;
}

// ------------------------------------------------------------------ Pull
// Removes ShopControl's copy only (the event stays in Google): the delete trigger skips
// remembering it while shopcontrol.google_pull is on.
async function removeLocalCopy(sql, args) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL shopcontrol.google_pull = 'on'");
    const r = await db.query(sql, args);
    await db.query("COMMIT");
    return r.rowCount;
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); throw e; } finally { db.release(); }
}

const horizon = () => new Date(Date.now() + PULL_AHEAD_DAYS * 864e5).toISOString().slice(0, 10);

async function applyEvent(ev) {
  if (ev.status !== "cancelled" && ev.start && fromEvent(ev).appointment_date > horizon()) {
    // Beyond a year out: not brought in (and dropped here if it moved out that far).
    return removeLocalCopy("DELETE FROM appointments WHERE google_event_id = $1 AND created_by = 'Google Calendar' AND NOT google_dirty", [ev.id]);
  }
  if (ev.status === "cancelled") {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL shopcontrol.google_pull = 'on'");
      const r = await db.query("DELETE FROM appointments WHERE google_event_id = $1 AND NOT google_dirty", [ev.id]);
      await db.query("COMMIT");
      return r.rowCount;
    } catch (e) { await db.query("ROLLBACK").catch(() => {}); throw e; } finally { db.release(); }
  }
  if (!ev.start) return 0;
  const a = fromEvent(ev);
  const updated = await pool.query(
    `UPDATE appointments SET title=$1, appointment_type=$2, appointment_date=$3, appointment_time=$4, duration=$5, location=$6, notes=$7,
       updated_at=now(), updated_by='Google Calendar', google_synced_at=now(), google_dirty=false
     WHERE google_event_id=$8 AND NOT google_dirty`,
    [a.title, a.appointment_type, a.appointment_date, a.appointment_time, a.duration, a.location, a.notes, ev.id]);
  if (updated.rowCount) return 1;
  const exists = (await pool.query("SELECT 1 FROM appointments WHERE google_event_id = $1", [ev.id])).rows.length;
  if (exists) return 0; // changed here and not pushed yet: ShopControl wins
  await pool.query(
    `INSERT INTO appointments(title, appointment_type, appointment_date, appointment_time, duration, location, notes, created_by, updated_by, google_event_id, google_synced_at, google_dirty)
     VALUES($1,$2,$3,$4,$5,$6,$7,'Google Calendar','Google Calendar',$8,now(),false)`,
    [a.title, a.appointment_type, a.appointment_date, a.appointment_time, a.duration, a.location, a.notes, ev.id]);
  return 1;
}

async function pull() {
  const state = (await pool.query("SELECT * FROM google_calendar_sync WHERE id = 1")).rows[0];
  let syncToken = state && state.calendar_id === config().calendarId ? state.sync_token : null;
  let pageToken = null, changed = 0, nextSyncToken = null;
  do {
    const query = { singleEvents: "true", showDeleted: "true", maxResults: "250", ...(pageToken ? { pageToken } : {}) };
    if (syncToken) query.syncToken = syncToken;
    else query.timeMin = new Date(Date.now() - PULL_BACK_DAYS * 864e5).toISOString();
    const r = await google("GET", "/events", { query });
    if (r.status === 410) { syncToken = null; pageToken = null; continue; } // token expired: start over
    if (r.status !== 200) throw failed(r, "Reading the calendar");
    for (const ev of r.body.items || []) changed += await applyEvent(ev);
    pageToken = r.body.nextPageToken || null;
    nextSyncToken = r.body.nextSyncToken || nextSyncToken;
  } while (pageToken);
  // Repeating events roll forward: drop copies that are now past the one-year window.
  await removeLocalCopy("DELETE FROM appointments WHERE created_by = 'Google Calendar' AND appointment_date > $1 AND NOT google_dirty", [horizon()]);
  await pool.query(
    `INSERT INTO google_calendar_sync(id, calendar_id, sync_token, last_pull_at) VALUES(1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET calendar_id = EXCLUDED.calendar_id, sync_token = EXCLUDED.sync_token, last_pull_at = now()`,
    [config().calendarId, nextSyncToken]);
  return changed;
}

let running = false;
async function syncGoogleCalendar() {
  if (!enabled() || running) return { skipped: true };
  running = true;
  try {
    const pushed = await push();
    await pool.query(`INSERT INTO google_calendar_sync(id, last_push_at) VALUES(1, now()) ON CONFLICT (id) DO UPDATE SET last_push_at = now()`);
    const pulled = await pull();
    await pool.query("UPDATE google_calendar_sync SET last_error = NULL WHERE id = 1");
    if (pushed || pulled) console.log(`Google Calendar: sent ${pushed}, brought in ${pulled}.`);
    return { pushed, pulled };
  } catch (e) {
    console.error("Google Calendar sync failed:", e.message);
    await pool.query(`INSERT INTO google_calendar_sync(id, last_error, last_error_at) VALUES(1, $1, now())
                      ON CONFLICT (id) DO UPDATE SET last_error = $1, last_error_at = now()`, [e.message]).catch(() => {});
    return { error: e.message };
  } finally { running = false; }
}

async function status() {
  const s = (await pool.query("SELECT * FROM google_calendar_sync WHERE id = 1")).rows[0] || {};
  return { enabled: enabled(), calendarId: config().calendarId || null, lastPullAt: s.last_pull_at || null, lastPushAt: s.last_push_at || null, lastError: s.last_error || null, lastErrorAt: s.last_error_at || null };
}

function startGoogleCalendarSync() {
  if (!enabled()) { console.log("Google Calendar sync off (set GOOGLE_CALENDAR_ID and GOOGLE_SERVICE_ACCOUNT_FILE to turn it on)."); return; }
  const run = () => syncGoogleCalendar();
  setInterval(run, 2 * 60 * 1000);
  setTimeout(run, 20 * 1000);
  console.log(`Google Calendar sync on: ${config().calendarId}, every 2 minutes.`);
}

module.exports = { startGoogleCalendarSync, syncGoogleCalendar, status, toEvent, fromEvent, addMinutes, _setFetch: (f) => { fetchImpl = f; token = null; } };
