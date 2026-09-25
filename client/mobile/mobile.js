// Concept Shop QC: employee mobile app. Same accounts and API as the full workspace.
// Each employee's QC department (set in Employees) opens their checklist automatically;
// checklists are defined in ../qcChecklists.js.
const $ = (id) => document.getElementById(id);
const API_BASE = "/api";
const DEPTS = QcChecklists.departments;
const DEFAULT_ACCENT = "#f97316";
const CLOSED_STAGES = ["Delivered", "Total Loss", "No Show"];

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const pct = (p) => (p.total ? Math.round((p.done / p.total) * 100) : 0);

let authToken = localStorage.getItem("authToken") || null;
let currentUser = JSON.parse(localStorage.getItem("authUser") || "null");
let jobs = [];
let qcRecords = [];
let activeJob = null;
let activeDept = null;
let activeRecord = null;
let checklist = { items: {}, notes: "" };

// ------------------------------------------------------------------ API
async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    logout();
    throw new Error("Your session expired. Please sign in again.");
  }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

// ------------------------------------------------------------------ UI helpers
function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(`screen-${name}`).classList.add("active");
  window.scrollTo({ top: 0 });
}

function setAccent(color) {
  document.documentElement.style.setProperty("--accent", color || DEFAULT_ACCENT);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", "#0b0f14");
}

function showAlert(id, message) {
  const el = $(id);
  el.textContent = message || "";
  el.classList.toggle("show", !!message);
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2400);
}

function ringHtml(progress, extraClass = "") {
  const p = pct(progress);
  return `<div class="ring ${progress.complete ? "done" : ""} ${extraClass}" style="--p:${p}" data-label="${progress.complete ? "✓" : p + "%"}"></div>`;
}

function deptColor(id) { return (QcChecklists.byId[id] || {}).color || DEFAULT_ACCENT; }

// ------------------------------------------------------------------ Auth
async function handleLogin() {
  const username = $("loginUsername").value.trim();
  const password = $("loginPassword").value;
  showAlert("loginError", "");
  if (!username || !password) return showAlert("loginError", "Enter your username and password.");
  const btn = $("loginBtn");
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const result = await apiRequest("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    authToken = result.token;
    currentUser = result.user;
    localStorage.setItem("authToken", authToken);
    localStorage.setItem("authUser", JSON.stringify(currentUser));
    $("loginPassword").value = "";
    enterHome();
    startAlerts();
  } catch (err) {
    showAlert("loginError", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
}

function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem("authToken");
  localStorage.removeItem("authUser");
  stopAlerts();
  setAccent(DEFAULT_ACCENT);
  showScreen("login");
}

// ------------------------------------------------------------------ Data
async function loadData() {
  const [daily, qc] = await Promise.all([apiRequest("/daily"), apiRequest("/qc").catch(() => [])]);
  jobs = daily.filter((j) => !j.merged_into && !CLOSED_STAGES.includes(j.current_stage));
  qcRecords = qc;
}

// CCC vehicles look like "2021 Jeep Gladiator / VIN ... / Black / Plate ...": show the
// car itself as the title and the color / plate as a detail line.
function vehicleName(v) { return String(v || "Vehicle").split(" / ")[0]; }
function vehicleDetail(v) { return String(v || "").split(" / ").slice(1).filter((x) => !/^VIN /.test(x)).join(" · "); }

// Card picture from the shared vehicle library (see ShopModel.vehicleImage).
function vehiclePic(j) {
  const pic = ShopModel.vehicleImage({ vehicle: j.vehicle, vehicleType: j.vehicle_type, vehicleColor: j.vehicle_color });
  return pic ? "../" + pic.src : null;
}

function roOf(job) { return String(job.ro_number || "").trim(); }

// The most recently touched checklist for this vehicle + department.
function recordFor(job, deptId) {
  const ro = roOf(job).toLowerCase();
  return qcRecords
    .filter((r) => String(r.qc_ro_number || "").trim().toLowerCase() === ro && r.qc_department === deptId)
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))[0] || null;
}

function progressFor(job, deptId) {
  const rec = recordFor(job, deptId);
  return QcChecklists.progress(deptId, rec && rec.qc_checklist);
}

// ------------------------------------------------------------------ Home
function enterHome() {
  const dept = currentUser && currentUser.department;
  setAccent(deptColor(dept));
  const first = String((currentUser && currentUser.fullName) || "").split(" ")[0];
  const hour = new Date().getHours();
  $("helloName").textContent = `${hour < 12 ? "Morning" : hour < 17 ? "Hey" : "Evening"}, ${first || "there"}`;
  $("helloSub").innerHTML = dept
    ? `<span class="dept-chip">${esc(dept)}</span>&nbsp; Tap a vehicle to start your checklist.`
    : "Tap a vehicle to open its QC checklists.";
  $("searchInput").value = "";
  showScreen("home");
  $("carList").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  loadData().then(renderCars).catch((err) => { $("carList").innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
}

function renderCars() {
  const q = $("searchInput").value.trim().toLowerCase();
  const dept = currentUser && currentUser.department;
  let list = q
    ? jobs.filter((j) => [j.ro_number, j.customer_name, j.vehicle].join(" ").toLowerCase().includes(q))
    : jobs.filter((j) => j.onsite);
  list = list.slice().sort((a, b) => roOf(a).localeCompare(roOf(b), undefined, { numeric: true }));
  $("listTitle").textContent = q ? `${list.length} match${list.length === 1 ? "" : "es"}` : `In the shop · ${list.length}`;
  if (!list.length) {
    $("carList").innerHTML = `<div class="empty">${q ? "No open vehicles match that search." : "No vehicles are marked onsite right now. Search by RO above."}</div>`;
    return;
  }
  $("carList").innerHTML = list.map((j) => {
    let ring;
    if (dept) ring = ringHtml(progressFor(j, dept));
    else {
      const done = DEPTS.filter((d) => progressFor(j, d.id).complete).length;
      ring = ringHtml({ done, total: DEPTS.length, complete: done === DEPTS.length });
    }
    const pic = vehiclePic(j);
    return `<button class="car" data-job="${esc(j.id)}">${pic ? `<img class="car-pic" src="${esc(pic)}" alt="" loading="lazy">` : ""}
      <div class="body">
        <div class="ro">RO ${esc(j.ro_number || "—")}</div>
        <div class="name">${esc(vehicleName(j.vehicle))}</div>
        <div class="sub">${esc([j.customer_name, vehicleDetail(j.vehicle)].filter(Boolean).join(" · "))}</div>
        <span class="stage">${esc(j.current_stage || "")}</span>
      </div>${ring}</button>`;
  }).join("");
}

// ------------------------------------------------------------------ Job
function openJob(id) {
  activeJob = jobs.find((j) => j.id === id) || activeJob;
  if (!activeJob) return;
  renderJob();
  showScreen("job");
}

function renderJob() {
  const j = activeJob;
  const mine = currentUser && currentUser.department;
  setAccent(deptColor(mine));
  $("jobBarTitle").textContent = `RO ${j.ro_number || ""}`;
  $("jobRo").textContent = `RO ${j.ro_number || "—"}`;
  const pic = vehiclePic(j);
  $("jobPic").hidden = !pic;
  if (pic) $("jobPic").src = pic;
  $("jobVehicle").textContent = vehicleName(j.vehicle);
  $("jobCustomer").textContent = [j.customer_name, vehicleDetail(j.vehicle)].filter(Boolean).join(" · ");
  const techs = [...(j.body_techs || []), ...(j.painters || [])].join(", ");
  $("jobFacts").innerHTML = [
    ["Stage", j.current_stage || "—"],
    ["Due", j.target_delivery_date ? String(j.target_delivery_date).slice(5).replace("-", "/") : "—"],
    ["Techs", techs || "—"],
  ].map(([k, v]) => `<div class="fact"><small>${k}</small><b>${esc(v)}</b></div>`).join("");

  if (mine && QcChecklists.byId[mine]) {
    const p = progressFor(j, mine);
    const rec = recordFor(j, mine);
    const sub = p.complete && rec && rec.qc_signed_at
      ? `Done · signed by ${rec.qc_performed_by || "?"}`
      : p.done ? `${p.done} of ${p.total} checked · keep going` : `${p.total} items · tap to start`;
    $("jobQc").innerHTML = `<button class="qc-cta" data-dept="${esc(mine)}">${ringHtml(p)}<div><b>${esc(mine)} QC</b><span>${esc(sub)}</span></div><div class="arrow">›</div></button>`;
  } else {
    $("jobQc").innerHTML = `<div class="eyebrow">Pick a checklist</div>`;
  }

  $("deptGrid").innerHTML = DEPTS.filter((d) => d.id !== mine).map((d) => {
    const p = progressFor(j, d.id);
    const rec = recordFor(j, d.id);
    const label = p.complete ? `✓ ${rec && rec.qc_performed_by ? rec.qc_performed_by.split(" ")[0] : "Done"}` : p.done ? `${p.done}/${p.total} checked` : "Not started";
    return `<button class="dept-btn ${p.complete ? "complete" : ""}" style="--accent:${d.color}" data-dept="${esc(d.id)}"><b>${esc(d.id)}</b><small>${esc(label)}</small></button>`;
  }).join("");

  const rework = qcRecords.filter((r) => String(r.qc_ro_number || "").trim() === roOf(j) && r.qc_rework_needed === "Yes");
  $("reworkBox").innerHTML = rework.length ? `<div class="eyebrow">Open rework</div>${rework.map((r) => `
    <div class="row-card">
      <b>${esc(r.qc_rework_assigned_to || "Unassigned")}${r.qc_department ? ` · from ${esc(r.qc_department)}` : ""}</b>
      <small>${esc(r.qc_issues || "")}</small><br>
      <span class="pill ${r.qc_rework_due_date && r.qc_rework_due_date < today() ? "bad" : ""}">${r.qc_rework_due_date ? "Due " + esc(r.qc_rework_due_date) : "No due date"}</span>
      <button class="btn btn-ghost" style="margin-top:10px;padding:12px" data-rework="${esc(r.id)}">Mark rework done</button>
    </div>`).join("")}` : "";

  $("tilePartsSub").textContent = "Loading…";
  loadPartsSummary();
}

async function markReworkDone(id) {
  try {
    const saved = await apiRequest(`/qc/${id}`, { method: "PUT", body: JSON.stringify({ qc_rework_needed: "No" }) });
    qcRecords = qcRecords.map((r) => (r.id === id ? saved : r));
    toast("Rework marked done");
    renderJob();
  } catch (err) { toast(err.message); }
}

// ------------------------------------------------------------------ Parts
let jobParts = [];
function partProblem(p) {
  if (p.part_status === "Complete") return null;
  if (p.part_eta && String(p.part_eta).slice(0, 10) < today() && !["Received", "Complete", "Returned"].includes(p.part_status)) return "Late";
  if (["Backordered", "Wrong Part", "Return Needed"].includes(p.part_status)) return p.part_status;
  return null;
}

async function loadPartsSummary() {
  const ro = roOf(activeJob), est = String(activeJob.ccc_estfile_id || "").trim();
  try {
    const parts = await apiRequest("/parts");
    jobParts = parts.filter((p) => { const r = String(p.parts_ro_number || "").trim(); return r && (r === ro || (est && r === est)); });
    const bad = jobParts.filter(partProblem).length;
    const here = jobParts.filter((p) => ["Received", "Complete"].includes(p.part_status)).length;
    $("tilePartsSub").textContent = jobParts.length ? (bad ? `${bad} need attention` : `${here}/${jobParts.length} here`) : "None on file";
    $("tileParts").classList.toggle("alert-tile", bad > 0);
  } catch (_) {
    jobParts = null;
    $("tilePartsSub").textContent = "Not available";
  }
}

function openParts() {
  $("partsTitle").textContent = `Parts · RO ${activeJob.ro_number || ""}`;
  const list = jobParts || [];
  $("partsList").innerHTML = jobParts === null
    ? `<div class="empty">Your account can't view parts.</div>`
    : list.length ? list.map((p) => {
        const prob = partProblem(p);
        const ok = ["Received", "Complete"].includes(p.part_status);
        return `<div class="row-card"><b>${esc(p.part_description || "Part")}</b>
          <small>${esc([p.part_vendor, p.part_eta ? "ETA " + String(p.part_eta).slice(0, 10) : ""].filter(Boolean).join(" · "))}</small><br>
          <span class="pill ${prob ? "bad" : ok ? "ok" : ""}">${esc(prob || p.part_status || "")}</span></div>`;
      }).join("") : `<div class="empty">No parts on file for this RO.</div>`;
  showScreen("parts");
}

// ------------------------------------------------------------------ Checklist
function openChecklist(deptId) {
  const dept = QcChecklists.byId[deptId];
  if (!dept) return;
  activeDept = dept;
  activeRecord = recordFor(activeJob, deptId);
  const saved = (activeRecord && activeRecord.qc_checklist) || {};
  checklist = { items: { ...(saved.items || {}) }, notes: saved.notes || "" };
  setAccent(dept.color);
  $("qcBarTitle").textContent = `RO ${activeJob.ro_number || ""} · ${vehicleName(activeJob.vehicle)}`;
  $("qcDeptTitle").textContent = `${dept.id} QC`;
  $("qcNotes").value = checklist.notes;
  setSaving("");
  $("qcItems").innerHTML = dept.items.map((item) => {
    const v = checklist.items[item.id] || {};
    return `<button class="check ${v.done ? "on" : ""}" data-item="${esc(item.id)}"><span class="box"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="label">${esc(item.label)}</span></button>
      ${item.input ? `<div class="check-extra"><input class="input" inputmode="decimal" data-value="${esc(item.id)}" value="${esc(v.value || "")}" placeholder="${esc(item.input.label)}" /><span>${esc(item.input.suffix || "")}</span></div>` : ""}`;
  }).join("");
  updateProgress();
  showScreen("qc");
}

function updateProgress() {
  const p = QcChecklists.progress(activeDept.id, checklist);
  const ring = $("qcRing");
  ring.style.setProperty("--p", pct(p));
  ring.dataset.label = p.complete ? "✓" : `${pct(p)}%`;
  ring.classList.toggle("done", p.complete);
  $("qcBar").style.width = `${pct(p)}%`;
  $("qcCount").textContent = p.complete ? "Everything's checked. Sign it off." : `${p.done} of ${p.total} checked`;
  $("toFinishBtn").textContent = p.complete ? "Sign & finish 🎉" : "Sign & finish";
}

function toggleItem(id, button) {
  const cur = checklist.items[id] || {};
  const done = !cur.done;
  checklist.items[id] = { ...cur, done, by: currentUser && currentUser.fullName, at: new Date().toISOString() };
  button.classList.toggle("on", done);
  if (done && navigator.vibrate) navigator.vibrate(12);
  updateProgress();
  queueSave();
}

function setSaving(state) {
  const el = $("qcSaving");
  el.className = `saving ${state === "saved" ? "ok" : state === "error" ? "err" : ""}`;
  el.textContent = state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : state === "error" ? "Not saved, retrying" : "";
}

// Autosave: every tap is written to the server (debounced) so nothing is lost if the
// phone locks or they walk away. Saves are chained so a record is only created once.
let saveTimer = null;
let saveChain = Promise.resolve();
function queueSave() {
  clearTimeout(saveTimer);
  setSaving("saving");
  saveTimer = setTimeout(() => {
    saveChain = saveChain.then(() => saveRecord()).catch(() => {
      setSaving("error");
      saveTimer = setTimeout(queueSave, 4000);
    });
  }, 600);
}

async function saveRecord(extra = {}) {
  const payload = {
    qc_department: activeDept.id,
    qc_checklist: checklist,
    qc_date: today(),
    qc_performed_by: (currentUser && currentUser.fullName) || "",
    ...extra,
  };
  let saved;
  if (activeRecord && activeRecord.id) {
    saved = await apiRequest(`/qc/${activeRecord.id}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    saved = await apiRequest("/qc", {
      method: "POST",
      body: JSON.stringify({
        qc_ro_number: activeJob.ro_number || "",
        qc_customer_name: activeJob.customer_name || "",
        qc_vehicle: activeJob.vehicle || "",
        qc_final_status: "Open",
        ...payload,
      }),
    });
  }
  activeRecord = saved;
  qcRecords = [saved, ...qcRecords.filter((r) => r.id !== saved.id)];
  setSaving("saved");
  return saved;
}

// ------------------------------------------------------------------ Finish + signature
let reworkChoice = "No";
function openFinish() {
  const p = QcChecklists.progress(activeDept.id, checklist);
  const missing = activeDept.items.filter((i) => !(checklist.items[i.id] && checklist.items[i.id].done));
  $("finishSummary").innerHTML = `<b>${esc(activeDept.id)} QC · RO ${esc(activeJob.ro_number || "")}</b>
    <small>${p.done} of ${p.total} checked${missing.length ? "" : " · all done"}</small>
    ${missing.length ? `<div style="margin-top:8px">${missing.map((i) => `<span class="pill bad" style="margin-right:4px">${esc(i.label)}</span>`).join("")}</div>` : ""}`;
  reworkChoice = "No";
  syncReworkSeg();
  $("reworkNotes").value = "";
  $("reworkAssignedTo").value = "";
  $("reworkDue").value = "";
  showAlert("finishError", "");
  showScreen("finish");
  setTimeout(initSignaturePad, 60);
}

function syncReworkSeg() {
  document.querySelectorAll("#reworkSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === reworkChoice));
  $("reworkFields").hidden = reworkChoice !== "Yes";
}

let sigCtx = null, sigDrawing = false, sigHasStrokes = false;
function initSignaturePad() {
  const canvas = $("sigPad");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.parentElement.clientWidth, height = 200;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  sigCtx = canvas.getContext("2d");
  sigCtx.scale(ratio, ratio);
  sigCtx.lineWidth = 2.6;
  sigCtx.lineCap = "round";
  sigCtx.lineJoin = "round";
  sigCtx.strokeStyle = "#0b0f14";
  sigHasStrokes = false;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.onpointerdown = (e) => { sigDrawing = true; sigHasStrokes = true; const p = pos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x, p.y); canvas.setPointerCapture(e.pointerId); };
  canvas.onpointermove = (e) => { if (!sigDrawing) return; const p = pos(e); sigCtx.lineTo(p.x, p.y); sigCtx.stroke(); };
  canvas.onpointerup = canvas.onpointerleave = canvas.onpointercancel = () => { sigDrawing = false; };
}

function clearSignature() {
  const canvas = $("sigPad");
  sigCtx.clearRect(0, 0, canvas.width, canvas.height);
  sigHasStrokes = false;
}

async function submitQc() {
  showAlert("finishError", "");
  if (!sigHasStrokes) return showAlert("finishError", "Sign in the box to finish.");
  if (reworkChoice === "Yes" && !$("reworkNotes").value.trim()) return showAlert("finishError", "Say what needs rework.");
  const btn = $("submitBtn");
  btn.disabled = true;
  btn.textContent = "Submitting…";
  const p = QcChecklists.progress(activeDept.id, checklist);
  clearTimeout(saveTimer);
  try {
    await saveChain.catch(() => {});
    const saved = await saveRecord({
      qc_signature_data: $("sigPad").toDataURL("image/png"),
      qc_signed_at: new Date().toISOString(),
      qc_final_status: reworkChoice === "Yes" ? "Needs Rework" : p.complete ? "Passed" : "Open",
      qc_rework_needed: reworkChoice,
      qc_issues: reworkChoice === "Yes" ? $("reworkNotes").value.trim() : (activeRecord && activeRecord.qc_issues) || "",
      qc_rework_assigned_to: reworkChoice === "Yes" ? $("reworkAssignedTo").value.trim() : "",
      qc_rework_due_date: reworkChoice === "Yes" ? ($("reworkDue").value || null) : null,
    });
    $("doneTitle").textContent = reworkChoice === "Yes" ? "Sent for rework" : p.complete ? `${activeDept.id} QC done!` : "QC saved";
    $("doneSub").textContent = `RO ${saved.qc_ro_number || ""} · ${p.done}/${p.total} checked · signed by ${saved.qc_performed_by || ""}`;
    showScreen("done");
    if (p.complete && reworkChoice === "No") celebrate();
  } catch (err) {
    showAlert("finishError", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit QC";
  }
}

function celebrate() {
  const wrap = $("doneWrap");
  const colors = [activeDept.color, "#22c55e", "#f8fafc", "#38bdf8", "#eab308"];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement("i");
    c.className = "confetti";
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = `${Math.random() * 0.6}s`;
    c.style.animationDuration = `${1.8 + Math.random() * 1.4}s`;
    wrap.append(c);
    setTimeout(() => c.remove(), 3600);
  }
  if (navigator.vibrate) navigator.vibrate([20, 60, 20]);
}

// ------------------------------------------------------------------ Photos
async function uploadAttachment(file, note) {
  const form = new FormData();
  form.append("file", file);
  if (note) form.append("note", note);
  const res = await fetch(`${API_BASE}/uploads/daily/${activeJob.id}`, {
    method: "POST",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    body: form,
  });
  if (res.status === 401) { logout(); throw new Error("Your session expired. Please sign in again."); }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || `Upload failed (${res.status})`);
  return data;
}

function openPhotos() {
  $("photosTitle").textContent = `Photos · RO ${activeJob.ro_number || ""}`;
  $("photoNote").value = "";
  showAlert("photosError", "");
  showScreen("photos");
  loadPhotos();
}

async function loadPhotos() {
  const grid = $("photoGrid");
  grid.innerHTML = '<div class="skeleton" style="grid-column:1/-1"></div>';
  try {
    const files = await apiRequest(`/uploads?resource=daily&recordId=${encodeURIComponent(activeJob.id)}`);
    $("tilePhotosSub").textContent = files.length ? `${files.length} attached` : "Snap & attach";
    grid.innerHTML = files.length ? files.map((f) => (f.mime_type || "").startsWith("image/")
      ? `<a href="${esc(f.file_url)}" target="_blank" rel="noopener"><img src="${esc(f.file_url)}" alt="${esc(f.note || f.original_name || "Photo")}" loading="lazy"></a>`
      : `<a href="${esc(f.file_url)}" target="_blank" rel="noopener">${esc((f.original_name || "FILE").split(".").pop().toUpperCase())}</a>`).join("")
      : '<div class="empty" style="grid-column:1/-1">Nothing attached yet.</div>';
  } catch (err) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${esc(err.message)}</div>`;
  }
}

async function handlePhotoFile(file) {
  if (!file) return;
  showAlert("photosError", "");
  toast("Uploading…");
  try {
    await uploadAttachment(file, $("photoNote").value.trim());
    $("photoNote").value = "";
    toast("Photo added ✓");
    loadPhotos();
  } catch (err) { showAlert("photosError", err.message); }
}

// ------------------------------------------------------------------ Alerts (bell)
let alertsTimer = null;
let alerts = [];
const alertsSeen = new Set();
async function refreshAlerts() {
  if (!authToken) return;
  try {
    alerts = (await apiRequest("/workspace/notifications")).filter((a) => !a.read_at);
    const badge = $("alertsCount");
    badge.hidden = !alerts.length;
    badge.textContent = alerts.length > 9 ? "9+" : String(alerts.length);
    for (const a of alerts) {
      if (!alertsSeen.has(a.id) && "Notification" in window && Notification.permission === "granted") {
        try { new Notification(a.title, { body: a.message, tag: a.id }); } catch (_) {}
      }
      alertsSeen.add(a.id);
    }
  } catch (_) {}
}
function startAlerts() { stopAlerts(); refreshAlerts(); alertsTimer = setInterval(refreshAlerts, 15000); }
function stopAlerts() { clearInterval(alertsTimer); alertsTimer = null; }

function openAlerts() {
  const back = document.createElement("div");
  back.className = "sheet-backdrop";
  back.innerHTML = `<div class="sheet"><div class="grab"></div><h3>Notifications</h3>
    ${alerts.length ? alerts.map((a) => `<div class="row-card"><b>${esc(a.title)}</b><small>${esc(a.message)}</small><button class="btn btn-ghost" style="margin-top:10px;padding:11px" data-read="${esc(a.id)}">Mark read</button></div>`).join("") : '<div class="empty">You\'re all caught up.</div>'}
    ${"Notification" in window && Notification.permission !== "granted" ? '<button class="btn btn-primary" data-enable>Turn on phone alerts</button>' : ""}</div>`;
  back.onclick = async (e) => {
    if (e.target === back) return back.remove();
    const read = e.target.closest("[data-read]");
    if (read) {
      try { await apiRequest(`/workspace/notifications/${read.dataset.read}/read`, { method: "PUT" }); } catch (err) { toast(err.message); }
      await refreshAlerts();
      back.remove();
      openAlerts();
    }
    if (e.target.closest("[data-enable]")) { await Notification.requestPermission(); back.remove(); }
  };
  document.body.append(back);
}

// ------------------------------------------------------------------ Wiring
document.addEventListener("DOMContentLoaded", () => {
  $("loginBtn").onclick = handleLogin;
  $("loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") handleLogin(); });
  $("logoutBtn").onclick = logout;
  $("alertsBtn").onclick = openAlerts;
  $("searchInput").addEventListener("input", renderCars);

  $("carList").addEventListener("click", (e) => { const b = e.target.closest("[data-job]"); if (b) openJob(b.dataset.job); });
  $("jobQc").addEventListener("click", (e) => { const b = e.target.closest("[data-dept]"); if (b) openChecklist(b.dataset.dept); });
  $("deptGrid").addEventListener("click", (e) => { const b = e.target.closest("[data-dept]"); if (b) openChecklist(b.dataset.dept); });
  $("reworkBox").addEventListener("click", (e) => { const b = e.target.closest("[data-rework]"); if (b) markReworkDone(b.dataset.rework); });
  $("tilePhotos").onclick = openPhotos;
  $("tileParts").onclick = openParts;

  $("qcItems").addEventListener("click", (e) => { const b = e.target.closest("[data-item]"); if (b) toggleItem(b.dataset.item, b); });
  $("qcItems").addEventListener("input", (e) => {
    const id = e.target.dataset.value;
    if (!id) return;
    checklist.items[id] = { ...(checklist.items[id] || { done: false }), value: e.target.value.slice(0, 40) };
    queueSave();
  });
  $("qcNotes").addEventListener("input", () => { checklist.notes = $("qcNotes").value.slice(0, 4000); queueSave(); });
  $("toFinishBtn").onclick = openFinish;

  $("reworkSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { reworkChoice = b.dataset.v; syncReworkSeg(); } });
  $("clearSigBtn").onclick = clearSignature;
  $("submitBtn").onclick = submitQc;
  $("doneJobBtn").onclick = () => { renderJob(); showScreen("job"); };
  $("doneHomeBtn").onclick = enterHome;

  $("takePhotoBtn").onclick = () => $("photoCameraInput").click();
  $("chooseFileBtn").onclick = () => $("photoFileInput").click();
  for (const id of ["photoCameraInput", "photoFileInput"]) {
    $(id).addEventListener("change", (e) => { handlePhotoFile(e.target.files[0]); e.target.value = ""; });
  }

  document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => {
    const to = b.dataset.back;
    if (to === "home") return enterHome();
    if (to === "job") { renderJob(); return showScreen("job"); }
    if (to === "qc") { setAccent(activeDept.color); return showScreen("qc"); }
  }));

  window.addEventListener("resize", () => { if ($("screen-finish").classList.contains("active")) initSignaturePad(); });

  if (authToken && currentUser) {
    // Refresh the account so a department changed in Employees applies right away.
    apiRequest("/auth/me").then(({ user }) => {
      currentUser = { ...currentUser, ...user };
      localStorage.setItem("authUser", JSON.stringify(currentUser));
    }).catch(() => {}).finally(() => { if (authToken) { enterHome(); startAlerts(); } });
  } else {
    showScreen("login");
  }
});
