const $ = (id) => document.getElementById(id);
const API_BASE = "/api";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

let authToken = localStorage.getItem("authToken") || null;
let currentUser = JSON.parse(localStorage.getItem("authUser") || "null");

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
    throw new Error("Your session expired. Please log in again.");
  }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo({ top: 0 });
}

function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem("authToken");
  localStorage.removeItem("authUser");
  showScreen("screen-login");
}

// ============================================================
// Login
// ============================================================
async function handleLogin() {
  const username = $("loginUsername").value.trim();
  const password = $("loginPassword").value;
  const errBox = $("loginError");
  errBox.classList.remove("visible");

  if (!username || !password) {
    errBox.textContent = "Enter your username and password.";
    errBox.classList.add("visible");
    return;
  }

  const btn = $("loginBtn");
  btn.disabled = true;
  btn.textContent = "Logging in...";
  try {
    const result = await apiRequest("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    authToken = result.token;
    currentUser = result.user;
    localStorage.setItem("authToken", authToken);
    localStorage.setItem("authUser", JSON.stringify(currentUser));
    $("loginPassword").value = "";
    enterLookup();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Log In";
  }
}

function enterLookup() {
  $("lookupUserSub").textContent = currentUser ? `Logged in as ${currentUser.fullName}` : "";
  $("roInput").value = "";
  $("lookupResults").innerHTML = "";
  $("lookupError").classList.remove("visible");
  showScreen("screen-lookup");
  setTimeout(() => $("roInput").focus(), 50);
}

// ============================================================
// RO lookup
// ============================================================
let activeJob = null;
let activeQcRecord = null;

async function handleLookup() {
  const query = $("roInput").value.trim().toLowerCase();
  const errBox = $("lookupError");
  errBox.classList.remove("visible");
  $("lookupResults").innerHTML = "";

  if (!query) {
    errBox.textContent = "Enter an RO number.";
    errBox.classList.add("visible");
    return;
  }

  const btn = $("lookupBtn");
  btn.disabled = true;
  btn.textContent = "Searching...";
  try {
    const daily = await apiRequest("/daily");
    const matches = daily.filter((r) =>
      String(r.ro_number || "").toLowerCase().includes(query) &&
      !["Delivered", "Total Loss"].includes(r.current_stage)
    );

    if (!matches.length) {
      errBox.textContent = "No active job found with that RO number.";
      errBox.classList.add("visible");
      return;
    }

    if (matches.length === 1) {
      await selectJob(matches[0]);
      return;
    }

    $("lookupResults").innerHTML = matches.map((m, i) => `
      <div class="job-option">
        <div class="ro">RO ${m.ro_number || ""}</div>
        <div class="sub">${m.customer_name || ""} &middot; ${m.vehicle || ""}</div>
        <button class="btn btn-primary" data-idx="${i}" onclick="selectJobByIndex(${i})">Select</button>
      </div>
    `).join("");
    window._lookupMatches = matches;
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Find Vehicle";
  }
}

function selectJobByIndex(i) {
  selectJob(window._lookupMatches[i]);
}

async function selectJob(job) {
  activeJob = job;
  const errBox = $("lookupError");
  try {
    const qcList = await apiRequest("/qc");
    const existing = qcList.find((r) =>
      String(r.qc_ro_number || "").toLowerCase() === String(job.ro_number || "").toLowerCase() &&
      !["Passed", "Ready for Delivery"].includes(r.qc_final_status)
    );
    activeQcRecord = existing || null;
    enterHub();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.add("visible");
  }
}

// ============================================================
// Job hub
// ============================================================
const HUB_FIELDS = [
  ["current_stage", "Stage"],
  ["priority", "Priority"],
  ["target_delivery_date", "Target Delivery"],
  ["hold_up_reason", "Hold Up Reason"],
  ["todays_goal", "Today's Goal"],
  ["estimate_needed", "Estimate Needed"],
  ["estimate_completed", "Estimate Completed"],
  ["supplement_needed", "Supplement Needed"],
  ["supplement_submitted", "Supplement Submitted"],
  ["supplement_approved", "Supplement Approved"],
  ["supplement_completed", "Supplement Completed"],
  ["ro_amount", "RO Amount"],
];

function enterHub() {
  $("hubUserSub").textContent = currentUser ? `Logged in as ${currentUser.fullName}` : "";
  $("hubVehicleTitle").textContent = activeJob.vehicle || "Vehicle";
  $("hubVehicleSub").textContent = `${activeJob.customer_name || ""} · RO ${activeJob.ro_number || ""}`;
  $("hubExistingTag").style.display = activeQcRecord ? "" : "none";

  $("hubInfoRows").innerHTML = HUB_FIELDS
    .filter(([key]) => activeJob[key] !== null && activeJob[key] !== undefined && activeJob[key] !== "")
    .map(([key, label]) => `<div class="summary-row"><span class="k">${label}</span><span>${activeJob[key]}</span></div>`)
    .join("") || `<p class="muted-note">No additional job info on file.</p>`;

  showScreen("screen-hub");
  loadHubParts();
}

async function loadHubParts() {
  const box = $("hubParts");
  box.innerHTML = `<div class="muted-note">Loading parts...</div>`;
  try {
    const parts = await apiRequest("/parts");
    const matches = parts.filter((p) =>
      String(p.parts_ro_number || "").toLowerCase() === String(activeJob.ro_number || "").toLowerCase()
    );
    if (!matches.length) {
      box.innerHTML = `<div class="muted-note">No parts on file for this RO.</div>`;
      return;
    }
    box.innerHTML = matches.map((p) => `
      <div class="part-row">
        <div class="name">${p.part_description || "Part"}</div>
        <div class="sub">${[p.part_type, p.part_status, p.part_eta ? `ETA ${p.part_eta}` : ""].filter(Boolean).join(" · ")}</div>
      </div>
    `).join("");
  } catch (err) {
    box.innerHTML = `<div class="muted-note">Parts info not available for your account.</div>`;
  }
}

// ============================================================
// QC form
// ============================================================
function enterForm() {
  $("formRoSub").textContent = `RO ${activeJob.ro_number || ""}`;
  $("formVehicleTitle").textContent = activeJob.vehicle || "Vehicle";
  $("formVehicleSub").textContent = `${activeJob.customer_name || ""} &middot; RO ${activeJob.ro_number || ""}`.replace("&middot;", "·");
  $("formExistingTag").style.display = activeQcRecord ? "" : "none";

  const r = activeQcRecord || {};
  $("qcDate").value = r.qc_date || today();
  $("qcPerformedBy").value = r.qc_performed_by || (currentUser ? currentUser.fullName : "");
  $("qcFinalStatus").value = r.qc_final_status || "Open";
  $("qcBodyWork").value = r.qc_body_work || "No";
  $("qcPaintQuality").value = r.qc_paint_quality || "No";
  $("qcColorMatch").value = r.qc_color_match || "No";
  $("qcPanelAlignment").value = r.qc_panel_alignment || "No";
  $("qcElectrical").value = r.qc_electrical || "No";
  $("qcCalibration").value = r.qc_calibration || "No";
  $("qcInterior").value = r.qc_interior || "No";
  $("qcExterior").value = r.qc_exterior || "No";
  $("qcWarningLights").value = r.qc_warning_lights || "No";
  $("qcTestDriveNeeded").value = r.qc_test_drive_needed || "No";
  $("qcTestDriveCompleted").value = r.qc_test_drive_completed || "No";
  $("qcCustomerItems").value = r.qc_customer_items || "No";
  $("qcReworkNeeded").value = r.qc_rework_needed || "No";
  $("qcReworkAssignedTo").value = r.qc_rework_assigned_to || "";
  $("qcReworkDueDate").value = r.qc_rework_due_date || "";
  $("qcCustomerCalled").value = r.qc_customer_called || "No";
  $("qcIssues").value = r.qc_issues || "";
  $("qcDeliveryNotes").value = r.qc_delivery_notes || "";

  showScreen("screen-form");
}

function collectFormValues() {
  return {
    qc_ro_number: activeJob.ro_number || "",
    qc_customer_name: activeJob.customer_name || "",
    qc_vehicle: activeJob.vehicle || "",
    qc_date: $("qcDate").value,
    qc_performed_by: $("qcPerformedBy").value,
    qc_final_status: $("qcFinalStatus").value,
    qc_body_work: $("qcBodyWork").value,
    qc_paint_quality: $("qcPaintQuality").value,
    qc_color_match: $("qcColorMatch").value,
    qc_panel_alignment: $("qcPanelAlignment").value,
    qc_electrical: $("qcElectrical").value,
    qc_calibration: $("qcCalibration").value,
    qc_interior: $("qcInterior").value,
    qc_exterior: $("qcExterior").value,
    qc_warning_lights: $("qcWarningLights").value,
    qc_test_drive_needed: $("qcTestDriveNeeded").value,
    qc_test_drive_completed: $("qcTestDriveCompleted").value,
    qc_customer_items: $("qcCustomerItems").value,
    qc_rework_needed: $("qcReworkNeeded").value,
    qc_rework_assigned_to: $("qcReworkAssignedTo").value,
    qc_rework_due_date: $("qcReworkDueDate").value || null,
    qc_customer_called: $("qcCustomerCalled").value,
    qc_issues: $("qcIssues").value,
    qc_delivery_notes: $("qcDeliveryNotes").value,
  };
}

function enterSignature() {
  if (!$("qcPerformedBy").value.trim()) {
    alert("Please enter who performed the QC before continuing.");
    return;
  }
  $("sigRoSub").textContent = `RO ${activeJob.ro_number || ""}`;
  showScreen("screen-signature");
  setTimeout(initSignaturePad, 50);
}

// ============================================================
// Signature pad
// ============================================================
let sigCtx = null;
let sigDrawing = false;
let sigHasStrokes = false;

function initSignaturePad() {
  const canvas = $("sigPad");
  const wrap = canvas.parentElement;
  const ratio = window.devicePixelRatio || 1;
  const width = wrap.clientWidth;
  const height = 180;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  sigCtx = canvas.getContext("2d");
  sigCtx.scale(ratio, ratio);
  sigCtx.lineWidth = 2.4;
  sigCtx.lineCap = "round";
  sigCtx.lineJoin = "round";
  sigCtx.strokeStyle = "#111827";
  sigCtx.clearRect(0, 0, width, height);
  sigHasStrokes = false;

  canvas.onpointerdown = null;
  canvas.onpointermove = null;
  canvas.onpointerup = null;

  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.addEventListener("pointerdown", (e) => {
    sigDrawing = true;
    sigHasStrokes = true;
    const p = pos(e);
    sigCtx.beginPath();
    sigCtx.moveTo(p.x, p.y);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!sigDrawing) return;
    const p = pos(e);
    sigCtx.lineTo(p.x, p.y);
    sigCtx.stroke();
  });
  const stop = () => { sigDrawing = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointerleave", stop);
  canvas.addEventListener("pointercancel", stop);
}

function clearSignature() {
  const canvas = $("sigPad");
  const ratio = window.devicePixelRatio || 1;
  sigCtx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
  sigHasStrokes = false;
}

async function submitQc() {
  const errBox = $("sigError");
  errBox.classList.remove("visible");

  if (!sigHasStrokes) {
    errBox.textContent = "Please sign before submitting.";
    errBox.classList.add("visible");
    return;
  }

  const btn = $("submitQcBtn");
  btn.disabled = true;
  btn.textContent = "Submitting...";

  try {
    const payload = collectFormValues();
    payload.qc_signature_data = $("sigPad").toDataURL("image/png");
    payload.qc_signed_at = new Date().toISOString();

    let saved;
    if (activeQcRecord && activeQcRecord.id) {
      saved = await apiRequest(`/qc/${activeQcRecord.id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      saved = await apiRequest("/qc", { method: "POST", body: JSON.stringify(payload) });
    }

    $("doneMessage").textContent = `QC saved for RO ${saved.qc_ro_number || ""}.`;
    $("doneSummary").innerHTML = `
      <div class="summary-row"><span class="k">Vehicle</span><span>${saved.qc_vehicle || ""}</span></div>
      <div class="summary-row"><span class="k">Performed By</span><span>${saved.qc_performed_by || ""}</span></div>
      <div class="summary-row"><span class="k">Status</span><span>${saved.qc_final_status || ""}</span></div>
      <div class="summary-row"><span class="k">Signed</span><span>${new Date(saved.qc_signed_at).toLocaleString()}</span></div>
    `;
    showScreen("screen-done");
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit QC";
  }
}

// ============================================================
// Photos & files
// ============================================================
async function uploadAttachment(file, note) {
  const form = new FormData();
  form.append("file", file);
  if (note) form.append("note", note);
  const res = await fetch(`${API_BASE}/uploads/daily/${activeJob.id}`, {
    method: "POST",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    body: form,
  });
  if (res.status === 401) {
    logout();
    throw new Error("Your session expired. Please log in again.");
  }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || `Upload failed (${res.status})`);
  return data;
}

async function loadPhotos() {
  const box = $("photosList");
  box.innerHTML = `<div class="muted-note">Loading...</div>`;
  try {
    const files = await apiRequest(`/uploads?resource=daily&recordId=${encodeURIComponent(activeJob.id)}`);
    if (!files.length) {
      box.innerHTML = `<div class="muted-note">Nothing attached to this job yet.</div>`;
      return;
    }
    box.innerHTML = files.map((f) => {
      const isImage = (f.mime_type || "").startsWith("image/");
      const thumb = isImage
        ? `<img class="thumb" src="${f.file_url}" alt="" />`
        : `<div class="doc-icon">FILE</div>`;
      const when = f.created_at ? new Date(f.created_at).toLocaleString() : "";
      return `
        <div class="file-row">
          ${thumb}
          <div class="meta">
            <div class="name">${f.note || f.original_name || "Attachment"}</div>
            <div class="sub">${f.uploaded_by || ""}${when ? ` · ${when}` : ""}</div>
          </div>
          <a href="${f.file_url}" target="_blank" rel="noopener">View</a>
        </div>
      `;
    }).join("");
  } catch (err) {
    box.innerHTML = `<div class="muted-note">Could not load attachments: ${err.message}</div>`;
  }
}

function enterPhotos() {
  $("photosRoSub").textContent = `RO ${activeJob.ro_number || ""}`;
  $("photoNote").value = "";
  $("photosError").classList.remove("visible");
  $("photosStatus").classList.remove("visible");
  showScreen("screen-photos");
  loadPhotos();
}

async function handlePhotoFile(file) {
  if (!file) return;
  const errBox = $("photosError");
  const statusBox = $("photosStatus");
  errBox.classList.remove("visible");
  statusBox.classList.remove("visible");
  try {
    await uploadAttachment(file, $("photoNote").value.trim());
    $("photoNote").value = "";
    statusBox.textContent = "Uploaded.";
    statusBox.classList.add("visible");
    loadPhotos();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.add("visible");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("loginBtn").onclick = handleLogin;
  $("loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") handleLogin(); });

  $("lookupBtn").onclick = handleLookup;
  $("roInput").addEventListener("keydown", (e) => { if (e.key === "Enter") handleLookup(); });

  $("hubQcBtn").onclick = enterForm;
  $("hubPhotosBtn").onclick = enterPhotos;
  $("hubNewSearchBtn").onclick = enterLookup;

  $("toSignatureBtn").onclick = enterSignature;
  $("backToLookupBtn").onclick = enterHub;

  $("clearSigBtn").onclick = clearSignature;
  $("submitQcBtn").onclick = submitQc;
  $("backToFormBtn").onclick = () => showScreen("screen-form");

  $("startAnotherBtn").onclick = enterLookup;
  $("doneBackToHubBtn").onclick = enterHub;

  $("takePhotoBtn").onclick = () => $("photoCameraInput").click();
  $("chooseFileBtn").onclick = () => $("photoFileInput").click();
  $("photoCameraInput").addEventListener("change", (e) => {
    handlePhotoFile(e.target.files[0]);
    e.target.value = "";
  });
  $("photoFileInput").addEventListener("change", (e) => {
    handlePhotoFile(e.target.files[0]);
    e.target.value = "";
  });
  $("backToHubBtn").onclick = enterHub;

  ["logoutBtn1", "logoutBtn2", "logoutBtn3", "logoutBtn4", "logoutBtnHub", "logoutBtnPhotos"].forEach((id) => { $(id).onclick = logout; });

  window.addEventListener("resize", () => {
    if ($("screen-signature").classList.contains("active")) initSignaturePad();
  });

  if (authToken && currentUser) {
    enterLookup();
  } else {
    showScreen("screen-login");
  }
});
