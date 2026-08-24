
const $ = (id) => document.getElementById(id);
const today = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const nowIso = () => new Date().toISOString();
const formatCurrency = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const AR_TERMS_DAYS = { "Due on Pickup": 0, "Net 10": 10, "Net 30": 30 };
function computeArDueDate(entryDate, terms) {
  if (!entryDate) return "";
  const d = new Date(`${entryDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + (AR_TERMS_DAYS[terms] ?? 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dateFromIsoLocal = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const formatDateTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { year:"numeric", month:"2-digit", day:"2-digit", hour:"numeric", minute:"2-digit" });
};

// ============================================================
// API layer: auth + camelCase <-> snake_case + fetch wrappers
// ============================================================
const API_BASE = window.API_BASE;

function camelToSnake(str) {
  return str.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`);
}
function snakeToCamel(str) {
  return str.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
function objToSnake(obj) {
  const out = {};
  Object.keys(obj).forEach((k) => { out[camelToSnake(k)] = obj[k]; });
  return out;
}
function objToCamel(obj) {
  const out = {};
  Object.keys(obj).forEach((k) => { out[snakeToCamel(k)] = obj[k]; });
  return out;
}

let authToken = localStorage.getItem("authToken") || null;
let currentUser = JSON.parse(localStorage.getItem("authUser") || "null");

function showStatus(message, isError) {
  const banner = $("statusBanner");
  if (!banner) return;
  banner.textContent = message;
  banner.classList.toggle("error", !!isError);
  banner.classList.add("visible");
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => banner.classList.remove("visible"), 2600);
}

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
    logout("Your session expired. Please log in again.");
    throw new Error("Unauthorized");
  }

  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

const api = {
  login: (username, password) => apiRequest("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  forgotPassword: (identifier) => apiRequest("/auth/forgot-password", { method: "POST", body: JSON.stringify({ identifier }) }),
  resetPasswordWithToken: (token, password) => apiRequest("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),
  list: (resource) => apiRequest(`/${resource}`),
  create: (resource, obj) => apiRequest(`/${resource}`, { method: "POST", body: JSON.stringify(objToSnake(obj)) }),
  update: (resource, id, obj) => apiRequest(`/${resource}/${id}`, { method: "PUT", body: JSON.stringify(objToSnake(obj)) }),
  remove: (resource, id) => apiRequest(`/${resource}/${id}`, { method: "DELETE" }),
  listUsers: () => apiRequest("/users"),
  createUser: (obj) => apiRequest("/users", { method: "POST", body: JSON.stringify(obj) }),
  patchUser: (id, obj) => apiRequest(`/users/${id}`, { method: "PATCH", body: JSON.stringify(obj) }),
  resetUserPassword: (id, password) => apiRequest(`/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }),
  activity: () => apiRequest("/activity?limit=300"),
  uploads: () => apiRequest("/uploads"),
  importEms: (file) => importEmsFile(file),
};

async function uploadFile(resource, recordId, file, note) {
  const form = new FormData();
  form.append("file", file);
  form.append("note", note || "");
  const res = await fetch(`${API_BASE}/uploads/${resource}/${recordId}`, {
    method: "POST",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    body: form,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || `Upload failed (${res.status})`);
  return objToCamel(data);
}


async function importEmsFile(files) {
  const form = new FormData();
  Array.from(files || []).forEach(file => form.append("files", file));
  const res = await fetch(`${API_BASE}/import/ems`, {
    method: "POST",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    body: form,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || `CCC import failed (${res.status})`);
  return data;
}

async function handleCccImport(e) {
  e.preventDefault();
  const files = $("cccImportFile").files;
  if (!files || !files.length) return alert("Choose one or more CCC EMS files first.");

  const resultBox = $("cccImportResult");
  resultBox.textContent = `Importing ${files.length} CCC file(s)...`;

  try {
    const result = await api.importEms(files);
    const daily = result.daily || {};
    const parts = result.parts || {};
    const parsedFiles = result.files || [];

    resultBox.innerHTML = `
      <p><strong>Daily GO List:</strong> ${daily.action || ""} RO ${daily.ro_number || ""}</p>
      <p><strong>Customer:</strong> ${daily.customer_name || ""}</p>
      <p><strong>Vehicle:</strong> ${daily.vehicle || ""}</p>
      <p><strong>Parts imported:</strong> ${parts.created || 0} created, ${parts.skipped || 0} skipped / already existed / not a part line</p>
      <p>${result.note || ""}</p>
      <h4>Files read</h4>
      <table>
        <thead><tr><th>File</th><th>Type</th><th>Records</th><th>Fields</th><th>Status</th></tr></thead>
        <tbody>
          ${parsedFiles.map(f => `<tr>
            <td>${f.filename || ""}</td>
            <td>${f.ext || ""}</td>
            <td>${f.records ?? ""}</td>
            <td>${f.fields ?? ""}</td>
            <td>${f.error ? "Error: " + f.error : "OK"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      <details>
        <summary>EMS fields found by file type</summary>
        <pre>${JSON.stringify(result.fieldsByFile || {}, null, 2)}</pre>
      </details>
    `;
    $("cccImportFile").value = "";
    await loadAll(false);
    showStatus("CCC EMS package import completed.");
  } catch (err) {
    resultBox.textContent = `Import failed: ${err.message}`;
    showStatus(`CCC import failed: ${err.message}`, true);
  }
}

// ============================================================
// In-memory cache mirroring what used to be localStorage.
// The `store` interface below is kept so the rest of the app's
// render/filter logic can stay exactly like the original.
// ============================================================
const RESOURCE_KEYS = ["daily", "tasks", "parts", "qc", "booth", "facility", "ar"];
const cache = { daily: [], tasks: [], parts: [], qc: [], booth: [], facility: [], ar: [], activity: [], uploads: [] };

const store = {
  get(key) { return cache[key] || []; },
};

async function loadAll(silent) {
  const results = await Promise.allSettled(RESOURCE_KEYS.map((k) => api.list(k)));
  let sessionExpired = false;
  let firstError = null;
  results.forEach((r, i) => {
    const k = RESOURCE_KEYS[i];
    if (r.status === "fulfilled") {
      cache[k] = r.value.map(objToCamel);
    } else if (r.reason.message === "Unauthorized") {
      sessionExpired = true;
    } else if (!firstError) {
      firstError = r.reason;
    }
  });
  try { cache.uploads = (await api.uploads()).map(objToCamel); } catch (_) {}
  try { cache.activity = (await api.activity()).map(objToCamel); } catch (_) {}
  renderAll();
  if (sessionExpired) return;
  if (firstError) showStatus(`Could not load data: ${firstError.message}`, true);
  else if (!silent) showStatus("Data refreshed.");
}

async function upsert(key, obj) {
  try {
    const { id, ...fields } = obj;
    const existing = id ? cache[key].find((r) => r.id === id) : null;
    let saved;
    if (existing) {
      saved = await api.update(key, id, fields);
    } else {
      saved = await api.create(key, fields);
    }
    saved = objToCamel(saved);
    const idx = cache[key].findIndex((r) => r.id === saved.id);
    if (idx >= 0) cache[key][idx] = saved; else cache[key].unshift(saved);
    renderAll();
    showStatus("Saved.");
    return saved;
  } catch (err) {
    showStatus(`Save failed: ${err.message}`, true);
    throw err;
  }
}

function deleteBtn(key, id) {
  return currentUser?.canDelete
    ? `<button class="danger" onclick="deleteRow('${key}','${id}')">Delete</button>`
    : "";
}

async function deleteRow(key, id) {
  if (!currentUser?.canDelete) {
    showStatus("Your account can't delete records. Ask an admin.", true);
    return;
  }
  if (!confirm("Delete this item?")) return;
  try {
    await api.remove(key, id);
    cache[key] = cache[key].filter((r) => r.id !== id);
    renderAll();
    showStatus("Deleted.");
  } catch (err) {
    showStatus(`Delete failed: ${err.message}`, true);
  }
}

function csvExport(filename, rows) {
  if (!rows.length) { alert("No data to export."); return; }
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g,'""')}"`;
  const csv = [headers.map(esc).join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}


function bindDashboardCards() {
  document.querySelectorAll(".metric.clickable").forEach(card => {
    card.addEventListener("click", () => {
      const tab = card.dataset.openTab;
      const setView = card.dataset.setView;
      if (setView) {
        const [selectId, value] = setView.split(":");
        const select = $(selectId);
        if (select) select.value = value;
      }
      const tabButton = document.querySelector(`.tab[data-tab="${tab}"]`);
      if (tabButton) tabButton.click();
      renderAll();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $(btn.dataset.tab).classList.add("active");
    });
  });
}

function dailyObj() {
  const existingId = $("dailyId").value;
  const existing = existingId ? store.get("daily").find(x => x.id === existingId) : null;
  const createdAt = existing?.createdAt || $("createdAt").value || nowIso();
  const updatedAt = nowIso();

  let deliveredAt = existing?.deliveredAt || $("deliveredAt").value || "";
  if ($("currentStage").value === "Delivered" && !deliveredAt) {
    deliveredAt = nowIso();
  }
  if ($("currentStage").value !== "Delivered") {
    deliveredAt = "";
  }
  if ($("currentStage").value === "Delivered" && !$("actualDeliveredDate").value) {
    $("actualDeliveredDate").value = dateFromIsoLocal(deliveredAt) || today();
  }

  return {
    id: existingId || undefined,
    createdAt,
    updatedAt,
    deliveredAt,
    roNumber: $("roNumber").value,
    customerName: $("customerName").value,
    vehicle: $("vehicle").value,
    roAmount: $("roAmount").value,
    location: $("location").value,
    currentStage: $("currentStage").value,
    priority: $("priority").value,
    assignedTo: $("assignedTo").value,
    departmentResponsible: $("departmentResponsible").value,
    holdUpReason: $("holdUpReason").value,
    targetDeliveryDate: $("targetDeliveryDate").value,
    actualDeliveredDate: $("actualDeliveredDate").value,
    customerUpdatedToday: $("customerUpdatedToday").value,
    estimateNeeded: $("estimateNeeded").value,
    estimateCompleted: $("estimateCompleted").value,
    supplementNeeded: $("supplementNeeded").value,
    supplementSubmitted: $("supplementSubmitted").value,
    supplementApproved: $("supplementApproved").value,
    supplementCompleted: $("supplementCompleted").value,
    needsManagementHelp: $("needsManagementHelp").value,
    todaysGoal: $("todaysGoal").value,
    managementIssue: $("managementIssue").value,
    endOfDayStatus: $("endOfDayStatus").value,
    endOfDayNotes: $("endOfDayNotes").value,
  };
}
function resetDaily() { $("dailyForm").reset(); $("dailyId").value = ""; $("createdAt").value = ""; $("updatedAt").value = ""; $("deliveredAt").value = ""; $("targetDeliveryDate").value = today(); const box = $("dailyTimestampBox"); if (box) box.textContent = "System timestamps will appear here after saving."; }
function isStaleVehicle(r) {
  if (!r || ["Delivered","Total Loss"].includes(r.currentStage)) return false;
  if (!r.updatedAt) return false;
  const hours = (Date.now() - new Date(r.updatedAt).getTime()) / 36e5;
  return hours >= 24;
}

function renderDaily() {
  let rows = store.get("daily");
  const view = $("dailyView")?.value || "all";
  const search = ($("dailySearch")?.value || "").toLowerCase();
  rows = rows.filter(r => {
    const active = r.currentStage !== "Delivered" && r.currentStage !== "Total Loss";
    if (view === "all" && !active) return false;
    if (view === "must" && r.priority !== "Must Move Today") return false;
    if (view === "delivery" && r.priority !== "Delivery Today") return false;
    if (view === "parts" && r.holdUpReason !== "Parts") return false;
    if (view === "insurance" && !["Insurance","Supplement"].includes(r.holdUpReason)) return false;
    if (view === "paint" && !["Prep","Paint"].includes(r.currentStage)) return false;
    if (view === "estimates" && !(r.estimateNeeded === "Yes" && r.estimateCompleted !== "Yes")) return false;
    if (view === "supplements" && !(r.supplementNeeded === "Yes" && r.supplementCompleted !== "Yes")) return false;
    if (view === "management" && r.needsManagementHelp !== "Yes") return false;
    if (view === "customerUpdate" && !(r.customerUpdatedToday !== "Yes" && !["Delivered","Total Loss"].includes(r.currentStage))) return false;
    if (view === "stale" && !isStaleVehicle(r)) return false;
    if (view === "deliveryNotReady" && !(r.priority === "Delivery Today" && !["Ready for Delivery","Delivered"].includes(r.currentStage))) return false;
    if (view === "supplementNotApproved" && !(r.supplementNeeded === "Yes" && r.supplementApproved !== "Yes")) return false;
    if (view === "deliveredToday" && !(r.currentStage === "Delivered" && (dateFromIsoLocal(r.deliveredAt) === today() || (!r.deliveredAt && r.actualDeliveredDate === today())))) return false;
    if (view === "delivered" && !["Delivered","Total Loss"].includes(r.currentStage)) return false;
    const hay = [r.roNumber,r.customerName,r.vehicle,r.todaysGoal,r.assignedTo].join(" ").toLowerCase();
    return hay.includes(search);
  });
  $("dailyTable").querySelector("tbody").innerHTML = rows.map(r => `
    <tr>
      <td>${r.roNumber || ""}</td><td>${r.customerName || ""}</td><td>${r.vehicle || ""}</td>
      <td>${r.currentStage || ""}</td><td>${r.priority || ""}</td><td>${r.todaysGoal || ""}</td>
      <td>${r.assignedTo || ""}</td><td>${r.holdUpReason || ""}</td>
      <td>${r.estimateNeeded === "Yes" && r.estimateCompleted !== "Yes" ? '<span class="status-bad">Estimate</span>' : ''}${r.supplementNeeded === "Yes" && r.supplementCompleted !== "Yes" ? '<br><span class="status-bad">Supplement</span>' : ''}</td>
      <td>${r.targetDeliveryDate || ""}${r.deliveredAt ? '<br><span class="status-good">Delivered: ' + formatDateTime(r.deliveredAt) + '</span>' : (r.actualDeliveredDate ? '<br><span class="status-good">Delivered: ' + r.actualDeliveredDate + '</span>' : '')}</td>
      <td>${formatDateTime(r.updatedAt) || ""}</td>
      <td><div class="actions"><button onclick="editDaily('${r.id}')">Edit</button>${deleteBtn('daily', r.id)}</div></td>
    </tr>`).join("");
}
function editDaily(id) {
  const r = store.get("daily").find(x => x.id === id); if (!r) return;
  Object.keys(r).forEach(k => { const el = $(k); if (el) el.value = r[k] ?? ""; });
  $("dailyId").value = r.id;
  const box = $("dailyTimestampBox");
  if (box) {
    box.innerHTML = `<strong>Created:</strong> ${formatDateTime(r.createdAt) || "Not recorded"} &nbsp; | &nbsp; <strong>Last Updated:</strong> ${formatDateTime(r.updatedAt) || "Not recorded"} &nbsp; | &nbsp; <strong>Delivered:</strong> ${formatDateTime(r.deliveredAt) || r.actualDeliveredDate || "Not delivered"}`;
  }
  document.querySelector('[data-tab="daily"]').click();
  window.scrollTo({top:0,behavior:"smooth"});
}

function taskObj() {
  return {
    id: $("taskId").value || undefined,
    taskName: $("taskName").value,
    taskAssignedTo: $("taskAssignedTo").value,
    taskAssignedBy: $("taskAssignedBy").value,
    taskDueDate: $("taskDueDate").value,
    taskPriority: $("taskPriority").value,
    taskStatus: $("taskStatus").value,
    taskWaitingOn: $("taskWaitingOn").value,
    taskManagementNotified: $("taskManagementNotified").value,
    taskNotes: $("taskNotes").value,
    completedDate: $("taskStatus").value === "Completed" ? today() : ""
  };
}
function resetTask(){ $("taskForm").reset(); $("taskId").value = ""; $("taskDueDate").value = today(); }
function renderTasks() {
  let rows = store.get("tasks");
  const view = $("taskView")?.value || "all";
  const search = ($("taskSearch")?.value || "").toLowerCase();
  rows = rows.filter(r => {
    if (view === "all" && r.taskStatus === "Completed") return false;
    if (view === "today" && r.taskDueDate !== today()) return false;
    if (view === "overdue" && !(r.taskDueDate && r.taskDueDate < today() && r.taskStatus !== "Completed")) return false;
    if (view === "waiting" && r.taskStatus !== "Waiting") return false;
    if (view === "completed" && r.taskStatus !== "Completed") return false;
    return [r.taskName,r.taskAssignedTo,r.taskNotes].join(" ").toLowerCase().includes(search);
  });
  $("taskTable").querySelector("tbody").innerHTML = rows.map(r => {
    const overdue = r.taskDueDate && r.taskDueDate < today() && r.taskStatus !== "Completed";
    return `<tr>
      <td>${r.taskName || ""}</td><td>${r.taskAssignedTo || ""}</td><td class="${overdue?'status-bad':''}">${r.taskDueDate || ""}</td>
      <td>${r.taskPriority || ""}</td><td>${r.taskStatus || ""}</td><td>${r.taskWaitingOn || ""}</td>
      <td><div class="actions"><button onclick="editTask('${r.id}')">Edit</button>${deleteBtn('tasks', r.id)}</div></td>
    </tr>`;
  }).join("");
}
function editTask(id) {
  const r = store.get("tasks").find(x => x.id === id); if (!r) return;
  Object.keys(r).forEach(k => { const el = $(k); if (el) el.value = r[k] ?? ""; });
  $("taskId").value = r.id; document.querySelector('[data-tab="tasks"]').click(); window.scrollTo({top:0,behavior:"smooth"});
}

function arObj() {
  return {
    id: $("arId").value || undefined,
    arRoNumber: $("arRoNumber").value,
    arCustomerName: $("arCustomerName").value,
    arVehicle: $("arVehicle").value,
    arAmount: $("arAmount").value,
    arTerms: $("arTerms").value,
    arEntryDate: $("arEntryDate").value,
    arStatus: $("arStatus").value,
    arPaidDate: $("arStatus").value === "Paid" ? ($("arPaidDate").value || today()) : $("arPaidDate").value,
    arNotes: $("arNotes").value,
  };
}
function updateArDuePreview() {
  const preview = computeArDueDate($("arEntryDate").value, $("arTerms").value);
  if (preview) $("arDueDate").value = preview;
}
function resetAr() {
  $("arForm").reset();
  $("arId").value = "";
  $("arEntryDate").value = today();
  updateArDuePreview();
}
function renderAr() {
  const table = $("arTable");
  if (!table) return;
  let rows = store.get("ar");
  const view = $("arView")?.value || "all";
  const search = ($("arSearch")?.value || "").toLowerCase();
  rows = rows.filter(r => {
    if (view === "all" && r.arStatus === "Paid") return false;
    if (view === "overdue" && !(r.arDueDate && r.arDueDate < today() && r.arStatus !== "Paid")) return false;
    if (view === "paid" && r.arStatus !== "Paid") return false;
    return [r.arRoNumber, r.arCustomerName, r.arVehicle, r.arNotes].join(" ").toLowerCase().includes(search);
  });
  table.querySelector("tbody").innerHTML = rows.map(r => {
    const overdue = r.arDueDate && r.arDueDate < today() && r.arStatus !== "Paid";
    return `<tr>
      <td>${r.arRoNumber || ""}</td><td>${r.arCustomerName || ""}</td><td>${r.arVehicle || ""}</td>
      <td>${formatCurrency(r.arAmount)}</td><td>${r.arTerms || ""}</td>
      <td class="${overdue ? 'status-bad' : ''}">${r.arDueDate || ""}</td>
      <td class="${r.arStatus === 'Paid' ? 'status-good' : ''}">${r.arStatus || ""}</td>
      <td><div class="actions"><button onclick="editAr('${r.id}')">Edit</button>${deleteBtn('ar', r.id)}</div></td>
    </tr>`;
  }).join("");
}
function editAr(id) {
  const r = store.get("ar").find(x => x.id === id); if (!r) return;
  Object.keys(r).forEach(k => { const el = $(k); if (el) el.value = r[k] ?? ""; });
  $("arId").value = r.id;
  document.querySelector('[data-tab="ar"]').click();
  window.scrollTo({top:0,behavior:"smooth"});
}

// ============================================================
// Cycle Time tabs: derived views of Daily GO List, bucketed by $
// ============================================================
function addDaysStr(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const CYCLE_TIERS = [
  { key: "cycle1", min: 0, max: 2000, days: 2 },
  { key: "cycle2", min: 2000, max: 4000, days: 4 },
  { key: "cycle3", min: 4000, max: 10000, days: 8 },
  { key: "cycle4", min: 10000, max: Infinity, days: 15 },
];
function cycleTierFor(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return CYCLE_TIERS.find(t => n >= t.min && n < t.max) || CYCLE_TIERS[CYCLE_TIERS.length - 1];
}
function cycleTargetDateFor(r) {
  const tier = cycleTierFor(r.roAmount);
  const intake = dateFromIsoLocal(r.createdAt);
  if (!tier || !intake) return "";
  return addDaysStr(intake, tier.days);
}
function cycleStatusFor(targetDate) {
  if (!targetDate) return { label: "", cls: "" };
  const t = today();
  if (t > targetDate) return { label: "Past Due", cls: "status-bad" };
  if (t === targetDate || t === addDaysStr(targetDate, -1)) return { label: t === targetDate ? "Due Today" : "Due Tomorrow", cls: "status-bad" };
  return { label: "On Track", cls: "status-good" };
}
function activeDailyForCycle() {
  return store.get("daily").filter(r => !["Delivered", "Total Loss"].includes(r.currentStage) && r.roAmount !== null && r.roAmount !== undefined && r.roAmount !== "");
}
function renderCycleTab(tier) {
  const table = $(`${tier.key}Table`);
  if (!table) return;
  let rows = activeDailyForCycle()
    .filter(r => { const n = Number(r.roAmount); return n >= tier.min && n < tier.max; })
    .map(r => ({ ...r, _target: cycleTargetDateFor(r) }));

  const search = ($(`${tier.key}Search`)?.value || "").toLowerCase();
  const view = $(`${tier.key}View`)?.value || "all";
  rows = rows.filter(r => {
    const status = cycleStatusFor(r._target);
    if (view === "dueSoon" && status.label !== "Due Tomorrow" && status.label !== "Due Today") return false;
    if (view === "pastDue" && status.label !== "Past Due") return false;
    return [r.roNumber, r.customerName, r.vehicle].join(" ").toLowerCase().includes(search);
  });
  rows.sort((a, b) => (a._target || "").localeCompare(b._target || ""));

  table.querySelector("tbody").innerHTML = rows.map(r => {
    const status = cycleStatusFor(r._target);
    return `<tr>
      <td>${r.roNumber || ""}</td><td>${r.customerName || ""}</td><td>${r.vehicle || ""}</td>
      <td>${formatCurrency(r.roAmount)}</td><td>${dateFromIsoLocal(r.createdAt) || ""}</td>
      <td class="${status.cls}">${r._target || ""}</td><td>${r.currentStage || ""}</td>
      <td class="${status.cls}">${status.label}</td>
      <td><div class="actions"><button onclick="editDaily('${r.id}')">Edit</button></div></td>
    </tr>`;
  }).join("");
}
function renderAllCycleTabs() { CYCLE_TIERS.forEach(renderCycleTab); }


function qcObj() {
  return {
    id: $("qcId").value || undefined,
    qcRoNumber: $("qcRoNumber").value,
    qcCustomerName: $("qcCustomerName").value,
    qcVehicle: $("qcVehicle").value,
    qcDate: $("qcDate").value,
    qcPerformedBy: $("qcPerformedBy").value,
    qcFinalStatus: $("qcFinalStatus").value,
    qcBodyWork: $("qcBodyWork").value,
    qcPaintQuality: $("qcPaintQuality").value,
    qcColorMatch: $("qcColorMatch").value,
    qcPanelAlignment: $("qcPanelAlignment").value,
    qcElectrical: $("qcElectrical").value,
    qcCalibration: $("qcCalibration").value,
    qcInterior: $("qcInterior").value,
    qcExterior: $("qcExterior").value,
    qcWarningLights: $("qcWarningLights").value,
    qcTestDriveNeeded: $("qcTestDriveNeeded").value,
    qcTestDriveCompleted: $("qcTestDriveCompleted").value,
    qcCustomerItems: $("qcCustomerItems").value,
    qcReworkNeeded: $("qcReworkNeeded").value,
    qcReworkAssignedTo: $("qcReworkAssignedTo").value,
    qcReworkDueDate: $("qcReworkDueDate").value,
    qcCustomerCalled: $("qcCustomerCalled").value,
    qcIssues: $("qcIssues").value,
    qcDeliveryNotes: $("qcDeliveryNotes").value
  };
}
function resetQc(){ $("qcForm").reset(); $("qcId").value = ""; $("qcDate").value = today(); }
function renderQc() {
  const table = $("qcTable");
  if (!table) return;
  let rows = store.get("qc");
  const view = $("qcView")?.value || "all";
  const search = ($("qcSearch")?.value || "").toLowerCase();

  rows = rows.filter(r => {
    if (view === "open" && !["Open"].includes(r.qcFinalStatus)) return false;
    if (view === "failed" && !(["Failed","Needs Rework"].includes(r.qcFinalStatus) || r.qcReworkNeeded === "Yes")) return false;
    if (view === "ready" && r.qcFinalStatus !== "Ready for Delivery") return false;
    if (view === "passed" && r.qcFinalStatus !== "Passed") return false;
    const hay = [r.qcRoNumber,r.qcCustomerName,r.qcVehicle,r.qcPerformedBy,r.qcIssues,r.qcDeliveryNotes].join(" ").toLowerCase();
    return hay.includes(search);
  });

  table.querySelector("tbody").innerHTML = rows.map(r => {
    const bad = ["Failed","Needs Rework"].includes(r.qcFinalStatus) || r.qcReworkNeeded === "Yes";
    return `<tr>
      <td>${r.qcRoNumber || ""}</td><td>${r.qcCustomerName || ""}</td><td>${r.qcVehicle || ""}</td>
      <td>${r.qcDate || ""}</td><td>${r.qcPerformedBy || ""}</td>
      <td class="${bad ? "status-bad" : (["Passed","Ready for Delivery"].includes(r.qcFinalStatus) ? "status-good" : "")}">${r.qcFinalStatus || ""}</td>
      <td>${r.qcReworkNeeded || ""}</td><td>${r.qcReworkAssignedTo || ""}</td><td>${r.qcCustomerCalled || ""}</td>
      <td><div class="actions"><button onclick="editQc('${r.id}')">Edit</button>${deleteBtn('qc', r.id)}</div></td>
    </tr>`;
  }).join("");
}
function editQc(id){
  const r = store.get("qc").find(x => x.id === id); if (!r) return;
  Object.keys(r).forEach(k => { const el = $(k); if (el) el.value = r[k] ?? ""; });
  $("qcId").value = r.id;
  document.querySelector('[data-tab="qc"]').click();
  window.scrollTo({top:0,behavior:"smooth"});
}

function boothObj() {
  return {
    id: $("boothId").value || undefined,
    boothDate: $("boothDate").value,
    boothPainter: $("boothPainter").value,
    intakeFilters: $("intakeFilters").value,
    exhaustFilters: $("exhaustFilters").value,
    rearFilters: $("rearFilters").value,
    filtersChanged: $("filtersChanged").value,
    pictureSent: $("pictureSent").value,
    helperAssisted: $("helperAssisted").value,
    managementVerified: $("managementVerified").value,
    boothNotes: $("boothNotes").value
  };
}
function resetBooth(){ $("boothForm").reset(); $("boothId").value = ""; $("boothDate").value = today(); }
function renderBooth() {
  let rows = [...store.get("booth")].sort((a,b)=>(b.boothDate||"").localeCompare(a.boothDate||""));
  $("boothTable").querySelector("tbody").innerHTML = rows.map(r => {
    return `<tr>
      <td>${r.boothDate||""}</td><td>${r.boothPainter||""}</td><td class="${r.intakeFilters==='Needs Changed'?'status-bad':'status-good'}">${r.intakeFilters||""}</td>
      <td class="${r.exhaustFilters==='Needs Changed'?'status-bad':'status-good'}">${r.exhaustFilters||""}</td>
      <td class="${r.rearFilters==='Needs Changed'?'status-bad':'status-good'}">${r.rearFilters||""}</td>
      <td>${r.filtersChanged||""}</td><td>${r.pictureSent||""}</td><td>${r.managementVerified||""}</td>
      <td><div class="actions"><button onclick="editBooth('${r.id}')">Edit</button>${deleteBtn('booth', r.id)}</div></td>
    </tr>`;
  }).join("");
}
function editBooth(id){ const r=store.get("booth").find(x=>x.id===id); if(!r)return; Object.keys(r).forEach(k=>{const el=$(k); if(el) el.value=r[k] ?? "";}); $("boothId").value=r.id; document.querySelector('[data-tab="booth"]').click(); window.scrollTo({top:0,behavior:"smooth"}); }

function facilityObj() {
  return {
    id: $("facilityId").value || undefined,
    facilityWeek: $("facilityWeek").value,
    facilityArea: $("facilityArea").value,
    facilityItem: $("facilityItem").value,
    facilityStatus: $("facilityStatus").value,
    facilityCompletedBy: $("facilityCompletedBy").value,
    facilityVerified: $("facilityVerified").value,
    facilityNotes: $("facilityNotes").value
  };
}
function resetFacility(){ $("facilityForm").reset(); $("facilityId").value = ""; $("facilityWeek").value = today(); }
function renderFacility() {
  let rows = store.get("facility");
  $("facilityTable").querySelector("tbody").innerHTML = rows.map(r => `
    <tr>
      <td>${r.facilityWeek||""}</td><td>${r.facilityArea||""}</td><td>${r.facilityItem||""}</td>
      <td class="${r.facilityStatus==='Needs Attention'?'status-bad':'status-good'}">${r.facilityStatus||""}</td>
      <td>${r.facilityCompletedBy||""}</td><td>${r.facilityVerified||""}</td>
      <td><div class="actions"><button onclick="editFacility('${r.id}')">Edit</button>${deleteBtn('facility', r.id)}</div></td>
    </tr>`).join("");
}
function editFacility(id){ const r=store.get("facility").find(x=>x.id===id); if(!r)return; Object.keys(r).forEach(k=>{const el=$(k); if(el) el.value=r[k] ?? "";}); $("facilityId").value=r.id; document.querySelector('[data-tab="facility"]').click(); window.scrollTo({top:0,behavior:"smooth"}); }


function partsObj() {
  return {
    id: $("partsId").value || undefined,
    partsRoNumber: $("partsRoNumber").value,
    partsCustomerName: $("partsCustomerName").value,
    partsVehicle: $("partsVehicle").value,
    partDescription: $("partDescription").value,
    partType: $("partType").value,
    partVendor: $("partVendor").value,
    partStatus: $("partStatus").value,
    partPriority: $("partPriority").value,
    partOrderedDate: $("partOrderedDate").value,
    partEta: $("partEta").value,
    partReceivedDate: $("partReceivedDate").value,
    partMirrorMatched: $("partMirrorMatched").value,
    partReturnNeeded: $("partReturnNeeded").value,
    partCreditNeeded: $("partCreditNeeded").value,
    partAssignedTo: $("partAssignedTo").value,
    partLastFollowUp: $("partLastFollowUp").value,
    partNotes: $("partNotes").value
  };
}
function resetParts(){ $("partsForm").reset(); $("partsId").value = ""; }
function partGroupKey(r) {
  return [r.partsRoNumber || "", r.partsCustomerName || "", r.partsVehicle || ""].join("||");
}

function summarizePartGroup(rows) {
  return {
    total: rows.length,
    open: rows.filter(r => r.partStatus !== "Complete").length,
    needOrder: rows.filter(r => r.partStatus === "Need to Order").length,
    waiting: rows.filter(r => ["Ordered","Backordered"].includes(r.partStatus)).length,
    mirror: rows.filter(r => r.partStatus === "Received" && r.partMirrorMatched !== "Yes").length,
    returns: rows.filter(r => ["Wrong Part","Return Needed","Returned","Credit Pending"].includes(r.partStatus) || r.partReturnNeeded === "Yes" || r.partCreditNeeded === "Yes").length,
  };
}

function partsGroupMatchesView(groupRows, view) {
  const s = summarizePartGroup(groupRows);
  if (view === "all") return s.open > 0;
  if (view === "needOrder") return s.needOrder > 0;
  if (view === "ordered") return s.waiting > 0;
  if (view === "backordered") return groupRows.some(r => r.partStatus === "Backordered");
  if (view === "received") return groupRows.some(r => r.partStatus === "Received");
  if (view === "mirror") return s.mirror > 0;
  if (view === "returns") return s.returns > 0;
  if (view === "problems") return groupRows.some(r => r.partStatus !== "Complete" && (["Need to Order","Backordered","Wrong Part","Return Needed","Credit Pending"].includes(r.partStatus) || (r.partEta && r.partEta < today() && !["Received","Mirror Matched","Complete","Returned"].includes(r.partStatus)) || (r.partStatus === "Received" && r.partMirrorMatched !== "Yes")));
  if (view === "complete") return s.open === 0 && s.total > 0;
  return true;
}

function renderParts() {
  const table = $("partsTable");
  if (!table) return;

  const allRows = store.get("parts");
  const view = $("partsView")?.value || "all";
  const search = ($("partsSearch")?.value || "").toLowerCase();

  const map = new Map();
  allRows.forEach(r => {
    const key = partGroupKey(r);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });

  let groups = [...map.entries()].map(([key, rows]) => {
    const first = rows[0] || {};
    const hay = rows.map(r => [r.partsRoNumber,r.partsCustomerName,r.partsVehicle,r.partDescription,r.partVendor,r.partStatus,r.partNotes].join(" ")).join(" ").toLowerCase();
    return { key, rows, first, hay, summary: summarizePartGroup(rows) };
  });

  groups = groups.filter(g => partsGroupMatchesView(g.rows, view) && g.hay.includes(search));
  groups.sort((a,b) => (b.summary.open - a.summary.open) || String(a.first.partsRoNumber || "").localeCompare(String(b.first.partsRoNumber || "")));

  table.querySelector("tbody").innerHTML = groups.map(g => `
    <tr>
      <td>${g.first.partsRoNumber || ""}</td>
      <td>${g.first.partsCustomerName || ""}</td>
      <td>${g.first.partsVehicle || ""}</td>
      <td>${g.summary.total}</td>
      <td class="${g.summary.open ? "status-bad" : ""}">${g.summary.open}</td>
      <td>${g.summary.needOrder}</td>
      <td>${g.summary.waiting}</td>
      <td class="${g.summary.mirror ? "status-bad" : ""}">${g.summary.mirror}</td>
      <td class="${g.summary.returns ? "status-bad" : ""}">${g.summary.returns}</td>
      <td><div class="actions"><button onclick="openPartsGroup('${encodeURIComponent(g.key)}')">Open Parts</button></div></td>
    </tr>
  `).join("");
}

let currentPartsGroupKey = null;
let selectedPartIds = new Set();

function currentPartsGroupRows() {
  if (!currentPartsGroupKey) return [];
  return store.get("parts").filter(r => partGroupKey(r) === currentPartsGroupKey);
}

function onPartCheckboxChange(id, checked) {
  if (checked) selectedPartIds.add(id); else selectedPartIds.delete(id);
  syncSelectAllPartsCheckbox();
}

function toggleSelectAllParts(checked) {
  const rows = currentPartsGroupRows();
  selectedPartIds = checked ? new Set(rows.map(r => r.id)) : new Set();
  renderPartsDetailRows(rows);
}

function syncSelectAllPartsCheckbox() {
  const selectAll = $("partsSelectAll");
  if (!selectAll) return;
  const rows = currentPartsGroupRows();
  selectAll.checked = rows.length > 0 && rows.every(r => selectedPartIds.has(r.id));
}

function renderPartsDetailRows(rows) {
  $("partsDetailTable").querySelector("tbody").innerHTML = rows.map(r => {
    const returnCredit = (r.partReturnNeeded === "Yes" ? "Return " : "") + (r.partCreditNeeded === "Yes" ? "Credit" : "");
    const etaLate = r.partEta && r.partEta < today() && !["Received","Mirror Matched","Complete","Returned"].includes(r.partStatus);
    return `<tr>
      <td><input type="checkbox" ${selectedPartIds.has(r.id) ? "checked" : ""} onchange="onPartCheckboxChange('${r.id}', this.checked)"></td>
      <td>${r.partDescription || ""}</td>
      <td>${r.partType || ""}</td>
      <td>${r.partVendor || ""}</td>
      <td class="${["Backordered","Wrong Part","Return Needed","Credit Pending"].includes(r.partStatus) ? "status-bad" : ""}">${r.partStatus || ""}</td>
      <td class="${etaLate ? "status-bad" : ""}">${r.partEta || ""}</td>
      <td>${r.partMirrorMatched || ""}</td>
      <td>${returnCredit || "No"}</td>
      <td>${r.partAssignedTo || ""}</td>
      <td><div class="actions"><button onclick="editParts('${r.id}')">Edit</button>${deleteBtn('parts', r.id)}</div></td>
    </tr>`;
  }).join("");
  syncSelectAllPartsCheckbox();
}

function openPartsGroup(encodedKey) {
  const key = decodeURIComponent(encodedKey);
  const rows = store.get("parts").filter(r => partGroupKey(r) === key);
  if (!rows.length) return;
  const first = rows[0];

  currentPartsGroupKey = key;
  selectedPartIds = new Set();

  $("partsModalTitle").textContent = `${first.partsRoNumber || ""} • ${first.partsCustomerName || ""}`;
  $("partsModalSub").textContent = first.partsVehicle || "";
  renderPartsDetailRows(rows);

  $("partsModal").style.display = "flex";
}

function closePartsModal() {
  $("partsModal").style.display = "none";
  currentPartsGroupKey = null;
  selectedPartIds = new Set();
}

function selectOrderedParts() {
  const rows = currentPartsGroupRows();
  selectedPartIds = new Set(rows.filter(r => ["Ordered", "Backordered"].includes(r.partStatus)).map(r => r.id));
  renderPartsDetailRows(rows);
}

function selectMirrorMatchedParts() {
  const rows = currentPartsGroupRows();
  selectedPartIds = new Set(rows.filter(r => r.partMirrorMatched === "Yes").map(r => r.id));
  renderPartsDetailRows(rows);
}

async function bulkUpdatePartsAndRefresh(ids, patch) {
  if (!ids.length) { showStatus("No parts selected.", true); return; }
  try {
    const results = await Promise.all(ids.map(id => api.update("parts", id, patch)));
    results.forEach(saved => {
      const s = objToCamel(saved);
      const idx = cache.parts.findIndex(r => r.id === s.id);
      if (idx >= 0) cache.parts[idx] = s;
    });
    showStatus(`Updated ${ids.length} part${ids.length === 1 ? "" : "s"}.`);
    const key = currentPartsGroupKey;
    renderParts();
    if (key) openPartsGroup(encodeURIComponent(key));
  } catch (err) {
    showStatus(`Bulk update failed: ${err.message}`, true);
  }
}

async function markSelectedOrdered() {
  await bulkUpdatePartsAndRefresh([...selectedPartIds], { partStatus: "Ordered", partOrderedDate: today() });
}

async function markSelectedMirrorMatched() {
  await bulkUpdatePartsAndRefresh([...selectedPartIds], { partMirrorMatched: "Yes" });
}

function editParts(id){
  const r = store.get("parts").find(x => x.id === id); if (!r) return;
  Object.keys(r).forEach(k => { const el = $(k); if (el) el.value = r[k] ?? ""; });
  $("partsId").value = r.id;
  closePartsModal();
  document.querySelector('[data-tab="parts"]').click();
  window.scrollTo({top:0,behavior:"smooth"});
}


// ==================================================// ============================================================
// Employee management (admin only)
// ============================================================
let employeesCache = [];

async function loadEmployees() {
  if (!["admin","owner"].includes(String(currentUser?.role || "").toLowerCase())) return;
  try {
    employeesCache = await api.listUsers();
    renderEmployees();
  } catch (err) {
    showStatus(`Could not load employees: ${err.message}`, true);
  }
}

function renderEmployees() {
  const table = $("employeesTable");
  if (!table) return;
  table.querySelector("tbody").innerHTML = employeesCache.map(u => {
    const isSelf = u.id === currentUser.id;
    return `<tr>
      <td>${u.full_name}${isSelf ? " <em>(you)</em>" : ""}</td>
      <td>${u.username}</td>
      <td>${u.email || ""}</td>
      <td><span class="pill ${u.role === 'admin' ? 'pill-admin' : 'pill-employee'}">${u.role}</span></td>
      <td><span class="pill ${u.can_delete ? 'pill-yes' : 'pill-no'}">${u.can_delete ? 'Yes' : 'No'}</span></td>
      <td><span class="pill ${u.active ? 'pill-yes' : 'pill-inactive'}">${u.active ? 'Active' : 'Deactivated'}</span></td>
      <td>
        <div class="actions">
          <button onclick="toggleCanDelete('${u.id}', ${!u.can_delete})">${u.can_delete ? "Revoke Delete" : "Grant Delete"}</button>
          ${!isSelf ? `<button onclick="toggleActive('${u.id}', ${!u.active})">${u.active ? "Deactivate" : "Reactivate"}</button>` : ""}
          ${!isSelf ? `<button onclick="toggleRole('${u.id}', '${u.role === 'admin' ? 'employee' : 'admin'}')">${u.role === 'admin' ? "Remove Admin" : "Make Admin"}</button>` : ""}
          <button onclick="resetEmployeePassword('${u.id}', '${u.full_name.replace(/'/g, "\\'")}')">Reset Password</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

async function toggleCanDelete(id, value) {
  try { await api.patchUser(id, { canDelete: value }); showStatus(value ? "Delete permission granted." : "Delete permission revoked."); await loadEmployees(); }
  catch (err) { showStatus(err.message, true); }
}
async function toggleActive(id, value) {
  try { await api.patchUser(id, { active: value }); showStatus(value ? "Employee reactivated." : "Employee deactivated."); await loadEmployees(); }
  catch (err) { showStatus(err.message, true); }
}
async function toggleRole(id, role) {
  try { await api.patchUser(id, { role }); showStatus(`Role updated to ${role}.`); await loadEmployees(); }
  catch (err) { showStatus(err.message, true); }
}
async function resetEmployeePassword(id, name) {
  const pw = prompt(`New temporary password for ${name} (at least 8 characters):`);
  if (!pw) return;
  if (pw.length < 8) { alert("Password must be at least 8 characters."); return; }
  try { await api.resetUserPassword(id, pw); showStatus("Password reset."); }
  catch (err) { showStatus(err.message, true); }
}

async function handleCreateEmployee(e) {
  e.preventDefault();
  const payload = {
    fullName: $("empFullName").value.trim(),
    username: $("empUsername").value.trim(),
    email: $("empEmail").value.trim(),
    password: $("empPassword").value,
    role: $("empRole").value,
    canDelete: $("empCanDelete").checked,
  };
  if (payload.password.length < 8) { showStatus("Password must be at least 8 characters.", true); return; }
  try {
    await api.createUser(payload);
    showStatus(`Employee "${payload.fullName}" created.`);
    $("employeeForm").reset();
    $("empCanDelete").checked = true;
    await loadEmployees();
  } catch (err) {
    showStatus(`Could not create employee: ${err.message}`, true);
  }
}


// ============================================================
// Photos / Attachments and Activity Log
// ============================================================
function recordLabel(resource, r) {
  if (!r) return "";
  if (resource === "daily") return `${r.roNumber || ""} - ${r.customerName || ""} - ${r.vehicle || ""}`.trim();
  if (resource === "tasks") return `${r.taskName || ""} - ${r.taskAssignedTo || ""}`.trim();
  if (resource === "parts") return `${r.partsRoNumber || ""} - ${r.partDescription || ""}`.trim();
  if (resource === "qc") return `${r.qcRoNumber || ""} - ${r.qcCustomerName || ""} - ${r.qcVehicle || ""}`.trim();
  if (resource === "booth") return `${r.boothDate || ""} - ${r.boothPainter || ""}`.trim();
  if (resource === "facility") return `${r.facilityWeek || ""} - ${r.facilityArea || ""} - ${r.facilityItem || ""}`.trim();
  if (resource === "ar") return `${r.arRoNumber || ""} - ${r.arCustomerName || ""} - ${formatCurrency(r.arAmount)}`.trim();
  return r.id || "";
}

function renderUploadRecordOptions() {
  const sel = $("uploadRecordId");
  if (!sel) return;
  const resource = $("uploadResource").value;
  const rows = store.get(resource) || [];
  sel.innerHTML = rows.map(r => `<option value="${r.id}">${recordLabel(resource, r) || r.id}</option>`).join("");
}

async function loadUploads() {
  try {
    cache.uploads = (await api.uploads()).map(objToCamel);
    renderUploads();
  } catch (err) {
    showStatus(`Could not load uploads: ${err.message}`, true);
  }
}

function renderUploads() {
  const table = $("uploadsTable");
  if (!table) return;
  const rows = store.get("uploads");
  table.querySelector("tbody").innerHTML = rows.map(u => {
    const url = `${API_BASE.replace(/\/api$/, "")}${u.fileUrl || ""}`;
    return `<tr>
      <td>${formatDateTime(u.createdAt)}</td>
      <td>${u.resource || ""}</td>
      <td>${u.recordId || ""}</td>
      <td><a href="${url}" target="_blank">${u.originalName || "Open file"}</a></td>
      <td>${u.note || ""}</td>
      <td>${u.uploadedBy || ""}</td>
    </tr>`;
  }).join("");
}

async function handleUpload(e) {
  e.preventDefault();
  const resource = $("uploadResource").value;
  const recordId = $("uploadRecordId").value;
  const file = $("uploadFile").files[0];
  const note = $("uploadNote").value;
  if (!recordId) return alert("Choose a record first.");
  if (!file) return alert("Choose a file first.");
  try {
    await uploadFile(resource, recordId, file, note);
    $("uploadFile").value = "";
    $("uploadNote").value = "";
    await loadUploads();
    showStatus("File uploaded.");
  } catch (err) {
    showStatus(`Upload failed: ${err.message}`, true);
  }
}

async function loadActivity() {
  try {
    cache.activity = (await api.activity()).map(objToCamel);
    renderActivity();
  } catch (err) {
    showStatus(`Could not load activity: ${err.message}`, true);
  }
}

function shortChanges(changes) {
  if (!changes || typeof changes !== "object") return "";
  return Object.keys(changes).slice(0, 6).map(k => {
    const c = changes[k] || {};
    return `${k}: ${c.old ?? ""} → ${c.new ?? ""}`;
  }).join("<br>");
}

function renderActivity() {
  const table = $("activityTable");
  if (!table) return;
  const rows = store.get("activity");
  table.querySelector("tbody").innerHTML = rows.map(a => `
    <tr>
      <td>${formatDateTime(a.createdAt)}</td>
      <td>${a.fullName || a.username || ""}</td>
      <td>${a.resource || ""}</td>
      <td>${a.action || ""}</td>
      <td>${a.summary || ""}</td>
      <td>${shortChanges(a.changes)}</td>
    </tr>
  `).join("");
}


function boothFilterCountdownInfo() {
  const boothRows = store.get("booth") || [];
  const changedRows = boothRows
    .filter(r => r.filtersChanged === "Yes" && r.boothDate)
    .sort((a, b) => String(b.boothDate).localeCompare(String(a.boothDate)));

  const last = changedRows[0] || null;
  if (!last) {
    return {
      hasRecord: false,
      lastDate: "",
      daysSince: null,
      daysLeft: null,
      overdueDays: null,
      status: "missing",
      message: "No booth filter change has been recorded yet."
    };
  }

  const lastDate = new Date(`${last.boothDate}T00:00:00`);
  const now = new Date();
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSince = Math.floor((todayDate - lastDate) / 86400000);
  const daysLeft = 30 - daysSince;
  const overdueDays = daysSince > 30 ? daysSince - 30 : 0;

  return {
    hasRecord: true,
    lastDate: last.boothDate,
    daysSince,
    daysLeft,
    overdueDays,
    status: overdueDays > 0 ? "overdue" : (daysLeft <= 5 ? "warning" : "good"),
    message: overdueDays > 0
      ? `Filters are ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue. Last changed ${last.boothDate}.`
      : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left. Last changed ${last.boothDate}.`
  };
}

function renderBoothCountdown() {
  const card = $("boothCountdownCard");
  if (!card) return;

  const info = boothFilterCountdownInfo();
  const daysEl = $("boothCountdownDays");
  const labelEl = $("boothCountdownLabel");
  const subtextEl = $("boothCountdownSubtext");

  card.classList.remove("booth-good", "booth-warning", "booth-overdue", "booth-missing");
  card.classList.add(`booth-${info.status}`);

  if (!info.hasRecord) {
    daysEl.textContent = "--";
    labelEl.textContent = "No record";
    subtextEl.textContent = info.message;
    return;
  }

  if (info.overdueDays > 0) {
    daysEl.textContent = info.overdueDays;
    labelEl.textContent = info.overdueDays === 1 ? "Day overdue" : "Days overdue";
  } else {
    daysEl.textContent = Math.max(info.daysLeft, 0);
    labelEl.textContent = info.daysLeft === 1 ? "Day left" : "Days left";
  }

  subtextEl.textContent = info.message;
}

async function resetBoothCountdown() {
  const changedBy = currentUser?.fullName || currentUser?.username || "";
  const notes = prompt("Optional note for this booth filter reset:", "Monthly booth filter countdown reset");
  if (notes === null) return;

  try {
    await upsert("booth", {
      boothDate: today(),
      boothPainter: changedBy,
      intakeFilters: "Good",
      exhaustFilters: "Good",
      rearFilters: "Good",
      filtersChanged: "Yes",
      pictureSent: "No",
      helperAssisted: "No",
      managementVerified: currentUser?.role === "admin" || currentUser?.role === "owner" || currentUser?.role === "manager" ? "Yes" : "No",
      boothNotes: notes || "Booth filter countdown reset."
    });
    showStatus("Booth filter countdown reset.");
  } catch (err) {
    showStatus(`Could not reset booth countdown: ${err.message}`, true);
  }
}

function renderDashboard() {
  const d = store.get("daily");
  const t = store.get("tasks");
  const b = store.get("booth");
  const f = store.get("facility");
  $("metricActiveJobs").textContent = d.filter(r=>!["Delivered","Total Loss"].includes(r.currentStage)).length;
  $("metricMustMove").textContent = d.filter(r=>r.priority==="Must Move Today").length;
  $("metricDelivery").textContent = d.filter(r=>r.priority==="Delivery Today").length;
  $("metricDeliveredToday").textContent = d.filter(r=>r.currentStage==="Delivered" && (dateFromIsoLocal(r.deliveredAt)===today() || (!r.deliveredAt && r.actualDeliveredDate===today()))).length;
  $("metricEstimatesNeeded").textContent = d.filter(r=>r.estimateNeeded==="Yes" && r.estimateCompleted!=="Yes").length;
  $("metricSupplementsNeeded").textContent = d.filter(r=>r.supplementNeeded==="Yes" && r.supplementCompleted!=="Yes").length;
  const p = store.get("parts");
  $("metricManagement").textContent = d.filter(r=>r.needsManagementHelp==="Yes").length;
  $("metricPartsProblems").textContent = p.filter(r=>r.partStatus !== "Complete" && (["Need to Order","Backordered","Wrong Part","Return Needed","Credit Pending"].includes(r.partStatus) || (r.partEta && r.partEta < today() && !["Received","Mirror Matched","Complete","Returned"].includes(r.partStatus)) || (r.partStatus === "Received" && r.partMirrorMatched !== "Yes"))).length;
  $("metricPartsReturns").textContent = p.filter(r=>r.partReturnNeeded === "Yes" || ["Wrong Part","Return Needed","Credit Pending"].includes(r.partStatus) || r.partCreditNeeded === "Yes").length;
  $("metricOpenTasks").textContent = t.filter(r=>r.taskStatus!=="Completed").length;
  const q = store.get("qc");
  $("metricQcOpen").textContent = q.filter(r=>r.qcFinalStatus==="Open").length;
  $("metricQcFailed").textContent = q.filter(r=>["Failed","Needs Rework"].includes(r.qcFinalStatus) || r.qcReworkNeeded==="Yes").length;
  $("metricOverdueTasks").textContent = t.filter(r=>r.taskDueDate && r.taskDueDate < today() && r.taskStatus!=="Completed").length;
  $("metricBoothIssues").textContent = b.filter(r=>[r.intakeFilters,r.exhaustFilters,r.rearFilters].includes("Needs Changed") || r.pictureSent==="No" || r.managementVerified==="No").length;
  $("metricFacilityIssues").textContent = f.filter(r=>r.facilityStatus==="Needs Attention").length;
  $("metricCustomerUpdates").textContent = d.filter(r=>r.customerUpdatedToday!=="Yes" && !["Delivered","Total Loss"].includes(r.currentStage)).length;
  $("metricStaleCars").textContent = d.filter(isStaleVehicle).length;
  $("metricDeliveryNotReady").textContent = d.filter(r=>r.priority==="Delivery Today" && !["Ready for Delivery","Delivered"].includes(r.currentStage)).length;
  $("metricSuppNotApproved").textContent = d.filter(r=>r.supplementNeeded==="Yes" && r.supplementApproved!=="Yes").length;
  $("metricPartsNeedMirror").textContent = p.filter(r=>r.partStatus==="Received" && r.partMirrorMatched!=="Yes").length;
  const ar = store.get("ar");
  const openAr = ar.filter(r=>r.arStatus!=="Paid");
  $("metricArOutstanding").textContent = formatCurrency(openAr.reduce((sum,r)=>sum+(parseFloat(r.arAmount)||0),0));
  $("metricArOverdue").textContent = openAr.filter(r=>r.arDueDate && r.arDueDate < today()).length;
  const cycleActive = activeDailyForCycle();
  let cycleDueTomorrow = 0, cyclePastDue = 0;
  cycleActive.forEach(r => {
    const status = cycleStatusFor(cycleTargetDateFor(r));
    if (status.label === "Due Tomorrow" || status.label === "Due Today") cycleDueTomorrow++;
    if (status.label === "Past Due") cyclePastDue++;
  });
  $("metricCycleDueTomorrow").textContent = cycleDueTomorrow;
  $("metricCyclePastDue").textContent = cyclePastDue;
}
function renderAll(){ renderDaily(); renderTasks(); renderParts(); renderQc(); renderBooth(); renderFacility(); renderAr(); renderAllCycleTabs(); renderDashboard(); renderBoothCountdown(); renderUploadRecordOptions(); renderUploads(); renderActivity(); }

function loadDefaultChecklist() {
  const items = [
    ["Paint Booth","Intake filters inspected"],["Paint Booth","Exhaust filters inspected"],["Paint Booth","Rear equipment protection filters inspected"],["Paint Booth","Booth cleanliness checked"],
    ["Compressor and Air System","Compressor oil level checked"],["Compressor and Air System","Moisture drained"],["Compressor and Air System","Air leaks checked"],
    ["Shop Equipment","Welders checked"],["Shop Equipment","Frame machine checked"],["Shop Equipment","Lifts checked"],
    ["Shop Appearance","Floors swept"],["Shop Appearance","Trash emptied"],["Shop Appearance","Walkways clear"],["Shop Appearance","Parts organized"],
    ["Safety","Fire extinguishers accessible"],["Safety","Emergency exits clear"],["Safety","Eye wash station stocked"],["Safety","Electrical panels clear"]
  ];
  (async () => {
    for (const [area, item] of items) {
      await upsert("facility", { facilityWeek: today(), facilityArea: area, facilityItem: item, facilityStatus: "Good", facilityCompletedBy: "", facilityVerified: "No", facilityNotes: "" });
    }
  })();
}


let pendingResetToken = null;

function getResetTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("resetToken");
}

function showForgotPassword() {
  $("loginForm").style.display = "none";
  $("resetPasswordForm").style.display = "none";
  $("forgotPasswordForm").style.display = "";
  $("forgotPasswordMessage").classList.remove("visible");
}

function showResetPassword(token) {
  pendingResetToken = token;
  $("loginForm").style.display = "none";
  $("forgotPasswordForm").style.display = "none";
  $("resetPasswordForm").style.display = "";
  $("resetPasswordMessage").classList.remove("visible");
}

function showLoginFormOnly() {
  pendingResetToken = null;
  $("forgotPasswordForm").style.display = "none";
  $("resetPasswordForm").style.display = "none";
  $("loginForm").style.display = "";
}

async function handleForgotPasswordSubmit(e) {
  e.preventDefault();
  const identifier = $("forgotIdentifier").value.trim();
  const msg = $("forgotPasswordMessage");
  msg.classList.remove("visible");
  const btn = $("forgotPasswordSubmitBtn");
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    const result = await api.forgotPassword(identifier);
    msg.textContent = result.message || "If that account exists, a reset email has been sent.";
    msg.classList.add("visible");
  } catch (err) {
    msg.textContent = err.message;
    msg.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Reset Link";
  }
}

async function handleResetPasswordSubmit(e) {
  e.preventDefault();
  const pw = $("newResetPassword").value;
  const confirm = $("confirmResetPassword").value;
  const msg = $("resetPasswordMessage");
  msg.classList.remove("visible");

  if (!pendingResetToken) {
    msg.textContent = "Missing reset token. Request a new reset link.";
    msg.classList.add("visible");
    return;
  }
  if (pw.length < 8) {
    msg.textContent = "Password must be at least 8 characters.";
    msg.classList.add("visible");
    return;
  }
  if (pw !== confirm) {
    msg.textContent = "Passwords do not match.";
    msg.classList.add("visible");
    return;
  }

  const btn = $("resetPasswordSubmitBtn");
  btn.disabled = true;
  btn.textContent = "Resetting...";
  try {
    const result = await api.resetPasswordWithToken(pendingResetToken, pw);
    msg.textContent = result.message || "Password has been reset. You can log in now.";
    msg.classList.add("visible");
    window.history.replaceState({}, document.title, window.location.pathname);
    setTimeout(() => showLoginFormOnly(), 1200);
  } catch (err) {
    msg.textContent = err.message;
    msg.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Reset Password";
  }
}


// ============================================================
// Auth / session handling
// ============================================================
let pollTimer = null;

function showApp() {
  $("loginScreen").style.display = "none";
  $("appRoot").classList.add("visible");
  $("sessionInfo").textContent = currentUser ? `Logged in as ${currentUser.fullName} (${currentUser.role || "employee"})` : "";
  $("employeesTabBtn").style.display = ["admin","owner"].includes(String(currentUser?.role || "").toLowerCase()) ? "" : "none";
  loadAll(true);
  if (["admin","owner"].includes(String(currentUser?.role || "").toLowerCase())) loadEmployees();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => loadAll(true), 20000); // keep multiple browsers in sync
}

function showLogin() {
  clearInterval(pollTimer);
  $("appRoot").classList.remove("visible");
  $("loginScreen").style.display = "flex";
  $("loginPassword").value = "";
  const token = getResetTokenFromUrl();
  if (token) showResetPassword(token);
  else showLoginFormOnly();
}

function logout(message) {
  authToken = null;
  currentUser = null;
  employeesCache = [];
  localStorage.removeItem("authToken");
  localStorage.removeItem("authUser");
  $("employeesTabBtn").style.display = "none";
  showLogin();
  if (message) {
    const err = $("loginError");
    err.textContent = message;
    err.classList.add("visible");
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const username = $("loginUsername").value.trim();
  const password = $("loginPassword").value;
  const err = $("loginError");
  err.classList.remove("visible");
  const btn = $("loginSubmitBtn");
  btn.disabled = true;
  btn.textContent = "Logging in...";
  try {
    const data = await api.login(username, password);
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem("authToken", authToken);
    localStorage.setItem("authUser", JSON.stringify(currentUser));
    showApp();
  } catch (ex) {
    err.textContent = ex.message || "Login failed.";
    err.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Log In";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bindTabs();
  bindDashboardCards();
  $("targetDeliveryDate").value = today();
  $("taskDueDate").value = today();
  $("boothDate").value = today();
  $("facilityWeek").value = today();
  $("qcDate").value = today();
  $("arEntryDate").value = today();
  updateArDuePreview();

  $("loginForm").addEventListener("submit", handleLoginSubmit);
  $("forgotPasswordForm").addEventListener("submit", handleForgotPasswordSubmit);
  $("resetPasswordForm").addEventListener("submit", handleResetPasswordSubmit);
  $("showForgotPasswordBtn").onclick = showForgotPassword;
  $("backToLoginBtn").onclick = showLoginFormOnly;
  $("cancelResetPasswordBtn").onclick = showLoginFormOnly;
  $("logoutBtn").onclick = () => logout();
  $("refreshBtn").onclick = () => loadAll(false);

  $("dailyForm").addEventListener("submit", async e => { e.preventDefault(); try { await upsert("daily", dailyObj()); resetDaily(); } catch(_) {} });
  $("taskForm").addEventListener("submit", async e => { e.preventDefault(); try { await upsert("tasks", taskObj()); resetTask(); } catch(_) {} });
  $("partsForm").addEventListener("submit", async e => { e.preventDefault(); try { await upsert("parts", partsObj()); resetParts(); } catch(_) {} });
  $("qcForm").addEventListener("submit", async e => { e.preventDefault(); try { await upsert("qc", qcObj()); resetQc(); } catch(_) {} });
  $("boothForm").addEventListener("submit", async e => { e.preventDefault(); try { await upsert("booth", boothObj()); resetBooth(); } catch(_) {} });
  $("facilityForm").addEventListener("submit", async e => { e.preventDefault(); try { await upsert("facility", facilityObj()); resetFacility(); } catch(_) {} });
  $("arForm").addEventListener("submit", async e => { e.preventDefault(); try { await upsert("ar", arObj()); resetAr(); } catch(_) {} });
  if ($("uploadForm")) $("uploadForm").addEventListener("submit", handleUpload);
  if ($("cccImportForm")) $("cccImportForm").addEventListener("submit", handleCccImport);
  $("employeeForm").addEventListener("submit", handleCreateEmployee);

  $("resetDailyBtn").onclick = resetDaily;
  $("resetTaskBtn").onclick = resetTask;
  $("resetPartsBtn").onclick = resetParts;
  $("resetQcBtn").onclick = resetQc;
  $("resetBoothBtn").onclick = resetBooth;
  $("resetFacilityBtn").onclick = resetFacility;
  $("resetArBtn").onclick = resetAr;
  $("arEntryDate").addEventListener("input", updateArDuePreview);
  $("arTerms").addEventListener("change", updateArDuePreview);

  ["dailySearch","dailyView","taskSearch","taskView","partsSearch","partsView","qcSearch","qcView","arSearch","arView",
   "cycle1Search","cycle1View","cycle2Search","cycle2View","cycle3Search","cycle3View","cycle4Search","cycle4View",
  ].forEach(id => $(id).addEventListener("input", renderAll));
  $("loadDefaultChecklistBtn").onclick = loadDefaultChecklist;
  if ($("refreshUploadsBtn")) $("refreshUploadsBtn").onclick = loadUploads;
  if ($("refreshActivityBtn")) $("refreshActivityBtn").onclick = loadActivity;
  if ($("uploadResource")) $("uploadResource").addEventListener("change", renderUploadRecordOptions);
  if ($("resetBoothCountdownBtn")) $("resetBoothCountdownBtn").onclick = resetBoothCountdown;
  if ($("openBoothLogBtn")) $("openBoothLogBtn").onclick = () => document.querySelector('[data-tab="booth"]').click();
  if ($("closePartsModalBtn")) $("closePartsModalBtn").onclick = closePartsModal;
  if ($("partsModal")) $("partsModal").addEventListener("click", (e) => { if (e.target.id === "partsModal") closePartsModal(); });

  $("exportDailyBtn").onclick = () => csvExport("concept_daily_go_list.csv", store.get("daily"));
  $("exportTasksBtn").onclick = () => csvExport("concept_tasks.csv", store.get("tasks"));
  $("exportPartsBtn").onclick = () => csvExport("concept_parts.csv", store.get("parts"));
  $("exportQcBtn").onclick = () => csvExport("concept_vehicle_qc.csv", store.get("qc"));
  $("exportBoothBtn").onclick = () => csvExport("concept_booth_filters.csv", store.get("booth"));
  $("exportFacilityBtn").onclick = () => csvExport("concept_facility_checklist.csv", store.get("facility"));
  $("exportArBtn").onclick = () => csvExport("concept_ar_balances.csv", store.get("ar"));
  $("exportAllBtn").onclick = () => {
    const backup = {
      daily: store.get("daily"), tasks: store.get("tasks"), parts: store.get("parts"), qc: store.get("qc"), booth: store.get("booth"), facility: store.get("facility"), ar: store.get("ar"),
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(backup,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "concept_shop_control_backup.json"; a.click(); URL.revokeObjectURL(url);
  };

  if (authToken && currentUser) {
    showApp();
  } else {
    showLogin();
  }
});
