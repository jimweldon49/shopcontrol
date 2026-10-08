const express = require("express");
const crypto = require("crypto");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { logActivity } = require("../activityLogger");
const model = require("../../../client/shared.js");

// Customer status page: conceptautobody.app/update (migrations/026, client/update/).
// The public routes show a customer a safe summary of their car: never dollar
// amounts, notes, hold-up reasons or staff names. Office staff make the private
// links and write the updates customers see.
const BASE_URL = () => (process.env.PORTAL_PUBLIC_URL || "https://conceptautobody.app").replace(/\/$/, "");
const STAFF_ROLES = ["office", "manager", "admin", "owner", "estimator"];
const DELIVERED_DAYS = 30; // links keep working this long after pickup

// Our production stages, grouped into the steps a customer sees.
const STEPS = [
  { label: "Checked in", stages: ["Check-In"], text: "Your vehicle is checked in and waiting to start." },
  { label: "Repair plan", stages: ["Tear Down", "Repair Plan", "Waiting Approval", "Waiting on Supplement"], text: "We're inspecting your vehicle and finalizing the repair plan." },
  { label: "Parts", stages: ["Waiting on Parts"], text: "We're waiting on parts for your repair." },
  { label: "Body", stages: ["Body"], text: "Your vehicle is in body repair." },
  { label: "Paint", stages: ["Prep", "Paint"], text: "Your vehicle is in paint." },
  { label: "Reassembly", stages: ["Assembly", "Sublet", "Detail"], text: "We're putting your vehicle back together." },
  { label: "Final check", stages: ["QC"], text: "Your vehicle is getting a final quality check." },
  { label: "Ready", stages: ["Ready for Delivery"], text: "Your vehicle is ready for pickup!" },
];
const stepOf = (stage) => STEPS.findIndex((s) => s.stages.includes(stage));

function customerStatus(job) {
  const since = job.stage_changed_at || job.updated_at;
  const steps = STEPS.map((s) => s.label);
  const stage = job.current_stage;
  if (["Scheduled", "On the Road", "No Show"].includes(stage)) {
    const when = job.dropoff_date ? ` on ${new Date(String(job.dropoff_date).slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}` : "";
    return stage === "No Show"
      ? { state: "scheduled", step: -1, steps, headline: "We're ready when you are.", detail: "Give us a call to set up a new drop-off time.", since }
      : { state: "scheduled", step: -1, steps, headline: `We're expecting your vehicle${when}.`, detail: "We'll update this page as soon as it's checked in.", since };
  }
  if (stage === "Delivered") {
    const day = job.delivered_at || job.actual_delivered_date;
    const on = day ? ` on ${new Date(day).toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : "";
    return { state: "delivered", step: steps.length, steps, headline: `You picked up your vehicle${on}.`, detail: "Thank you for choosing Concept Autobody!", since };
  }
  if (stage === "Total Loss") return { state: "closed", step: -1, steps, headline: "Please give us a call about your vehicle.", detail: "", since };
  // On Hold shows where the car got to; customers don't see the hold itself.
  let step = stepOf(stage);
  if (step < 0) step = Math.max(0, stepOf(job.last_progress_stage));
  return { state: step === steps.length - 1 ? "ready" : "in-progress", step, steps, headline: STEPS[step].text, detail: "", since };
}

const clean = (v, max) => String(v ?? "").trim().slice(0, max);
function contactInfo(settings) {
  const c = (settings && settings.customerPortal) || {};
  return { phone: clean(c.phone, 40), textPhone: clean(c.textPhone, 40), address: clean(c.address, 300), hours: clean(c.hours, 300) };
}

// What the page gets. Keep this list short and customer-safe.
async function publicView(db, job) {
  const updates = (await db.query(
    "SELECT message, created_at FROM customer_updates WHERE job_id=$1 ORDER BY created_at DESC LIMIT 50", [job.id])).rows;
  const settings = (await db.query("SELECT data FROM board_settings WHERE id=1")).rows[0];
  const img = model.vehicleImage({ vehicle: job.vehicle, vehicleType: job.vehicle_type, vehicleColor: job.vehicle_color });
  return {
    ro: job.ro_number,
    vehicle: job.vehicle || "",
    vehicleImage: img ? `/${img.src}` : null,
    status: customerStatus(job),
    updates: updates.map((u) => ({ message: u.message, at: u.created_at })),
    contact: contactInfo(settings && settings.data),
  };
}

function visible(job) {
  if (!job || job.job_kind !== "active") return false;
  if (job.current_stage === "Delivered") {
    const at = job.delivered_at || job.actual_delivered_date;
    if (at && Date.now() - new Date(at).getTime() > DELIVERED_DAYS * 864e5) return false;
  }
  return true;
}

async function loadJob(db, id) {
  let job = (await db.query("SELECT * FROM daily_go_list WHERE id=$1", [id])).rows[0];
  if (job && job.merged_into) job = (await db.query("SELECT * FROM daily_go_list WHERE id=$1", [job.merged_into])).rows[0];
  return job;
}

async function ensureLink(db, jobId, by) {
  const token = crypto.randomBytes(12).toString("base64url");
  await db.query("INSERT INTO customer_portal_links(job_id, token, created_by) VALUES($1,$2,$3) ON CONFLICT (job_id) DO NOTHING", [jobId, token, by]);
  return (await db.query("SELECT token FROM customer_portal_links WHERE job_id=$1", [jobId])).rows[0].token;
}
const linkUrl = (token) => `${BASE_URL()}/update/${token}`;

// "Smith, John", "John Smith", "Maria De La Cruz", "John Smith Jr." all accept the
// family name customers would type; letters only, case-insensitive.
const letters = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
function nameMatches(customerName, typed) {
  const want = letters(typed);
  if (want.length < 2) return false;
  const name = String(customerName || "");
  const parts = name.includes(",") ? [name.split(",")[0]] : [name];
  return parts.some((part) => {
    const words = part.split(/\s+/).filter((w) => w && !/^(jr|sr|ii|iii|iv)\.?$/i.test(w));
    for (let i = 0; i < words.length; i++) if (letters(words.slice(i).join("")) === want) return true;
    return false;
  });
}

// Slow down guessing: per visitor and per RO. In memory, so a restart resets it.
const attempts = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const hits = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  attempts.set(key, hits);
  if (attempts.size > 5000) for (const [k, v] of attempts) if (!v.length || now - v[v.length - 1] > windowMs) attempts.delete(k);
  return hits.length >= max;
}
const hit = (key) => (attempts.get(key) || attempts.set(key, []).get(key)).push(Date.now());
// Cloudflare's tunnel connects from localhost, so the visitor's address is in this header.
const visitor = (req) => String(req.headers["cf-connecting-ip"] || req.ip || "");

function fail(res, e) {
  if (!e.status) console.error("Customer portal:", e.message);
  return res.status(e.status || 400).json({ error: e.message });
}
const httpError = (status, message) => Object.assign(Error(message), { status });

// ---------------------------------------------------------------- Public
const publicRouter = express.Router();
publicRouter.use((req, res, next) => { res.set("Cache-Control", "no-store"); res.set("X-Robots-Tag", "noindex"); next(); });

publicRouter.get("/status/:token", async (req, res) => {
  try {
    const link = (await pool.query("SELECT job_id FROM customer_portal_links WHERE token=$1", [String(req.params.token).slice(0, 64)])).rows[0];
    const job = link && await loadJob(pool, link.job_id);
    if (!visible(job)) throw httpError(404, "This link isn't active anymore. Please call us for an update on your vehicle.");
    res.json(await publicView(pool, job));
  } catch (e) { fail(res, e); }
});

const NOT_FOUND = "We couldn't find that RO number and last name. Check your paperwork, or give us a call.";
publicRouter.post("/lookup", async (req, res) => {
  try {
    const ro = clean(req.body && req.body.ro, 20).replace(/^#/, "");
    const last = clean(req.body && req.body.lastName, 80);
    const ip = `ip:${visitor(req)}`, roKey = `ro:${ro}`;
    if (limited(ip, 10, 15 * 60e3) || limited(roKey, 8, 60 * 60e3)) throw httpError(429, "Too many tries. Please wait a few minutes, or give us a call.");
    if (!/^\d{5}$/.test(ro) || !last) { hit(ip); throw httpError(404, NOT_FOUND); }
    const jobs = (await pool.query(
      "SELECT * FROM daily_go_list WHERE btrim(ro_number)=$1 AND merged_into IS NULL ORDER BY created_at DESC", [ro])).rows;
    const job = jobs.find((j) => visible(j) && nameMatches(j.customer_name, last));
    if (!job) { hit(ip); hit(roKey); throw httpError(404, NOT_FOUND); }
    res.json({ token: await ensureLink(pool, job.id, "Customer lookup") });
  } catch (e) { fail(res, e); }
});

// ---------------------------------------------------------------- Staff
const staffRouter = express.Router();
staffRouter.use(requireAuth);
staffRouter.use((req, res, next) => {
  if (!STAFF_ROLES.includes(String(req.user.role || "").toLowerCase())) return res.status(403).json({ error: "Only office staff can manage the customer status page." });
  next();
});
const who = (req) => req.user.fullName || req.user.username;

staffRouter.get("/:jobId", async (req, res) => {
  try {
    const link = (await pool.query("SELECT token FROM customer_portal_links WHERE job_id=$1", [req.params.jobId])).rows[0];
    const updates = (await pool.query(
      "SELECT id, message, created_by, created_at FROM customer_updates WHERE job_id=$1 ORDER BY created_at DESC", [req.params.jobId])).rows;
    res.json({ url: link ? linkUrl(link.token) : null, updates });
  } catch (e) { fail(res, e); }
});

staffRouter.post("/:jobId/link", async (req, res) => {
  try {
    const job = (await pool.query("SELECT id, job_kind FROM daily_go_list WHERE id=$1", [req.params.jobId])).rows[0];
    if (!job) throw httpError(404, "Job not found.");
    if (job.job_kind !== "active") throw Error("Give this job its 5-digit RO number before sharing a status link.");
    res.json({ url: linkUrl(await ensureLink(pool, job.id, who(req))) });
  } catch (e) { fail(res, e); }
});

// Posting an update also marks the customer as updated (Customer Updated = Yes).
staffRouter.post("/:jobId/updates", async (req, res) => {
  const db = await pool.connect();
  try {
    const message = clean(req.body && req.body.message, 1000);
    if (!message) throw Error("Write the update the customer will see.");
    await db.query("BEGIN");
    const job = (await db.query(
      "UPDATE daily_go_list SET customer_updated_today='Yes', customer_updated_at=now(), updated_at=now(), updated_by=$2 WHERE id=$1 RETURNING id, ro_number, version, updated_at, customer_updated_today, customer_updated_at",
      [req.params.jobId, who(req)])).rows[0];
    if (!job) throw httpError(404, "Job not found.");
    const row = (await db.query(
      "INSERT INTO customer_updates(job_id, message, created_by, user_id) VALUES($1,$2,$3,$4) RETURNING id, message, created_by, created_at",
      [job.id, message, who(req), req.user.id])).rows[0];
    await db.query("COMMIT");
    await logActivity({ req, resource: "daily", recordId: job.id, action: "update", after: row, summary: `Customer update posted for RO ${job.ro_number}: ${message}` });
    res.status(201).json({ update: row, job });
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

staffRouter.delete("/updates/:id", async (req, res) => {
  try {
    const row = (await pool.query("DELETE FROM customer_updates WHERE id=$1 RETURNING id, job_id, message", [req.params.id])).rows[0];
    if (!row) throw httpError(404, "Update not found.");
    await logActivity({ req, resource: "daily", recordId: row.job_id, action: "update", before: row, summary: `Removed customer update: ${row.message}` });
    res.json({ deleted: true });
  } catch (e) { fail(res, e); }
});

module.exports = { publicRouter, staffRouter, customerStatus, nameMatches, STEPS };
