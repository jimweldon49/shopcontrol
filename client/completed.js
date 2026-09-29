// Completed Jobs tab: delivered / total-loss jobs and everything recorded about them
// (production timeline, parts, QC, photos, change history). Jobs deleted by hand are
// listed too, rebuilt from the activity log. API: /api/jobHistory (server/src/routes/jobHistory.js).
const CompletedJobs = (() => {
  const state = { jobs: [], deleted: [], search: "", from: "", to: "", showDeleted: false, open: null, loading: false, loaded: false };
  const e = (v) => escapeHtml(v);
  const money = (n) => (n === null || n === undefined || n === "" ? "" : formatCurrency(n));
  const day = (v) => (v ? new Date(String(v).length <= 10 ? v + "T12:00:00" : v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
  const stamp = (v) => (v ? new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  const list = (v) => (Array.isArray(v) ? v.join(", ") : v || "");
  const deliveredOf = (j) => j.delivered_at || j.actual_delivered_date || "";
  function daysInShop(j) {
    const start = j.onsite_at || j.in_date, end = deliveredOf(j);
    if (!start || !end) return null;
    return Math.max(0, Math.round((new Date(end) - new Date(start)) / 864e5));
  }
  function duration(ms) {
    if (!(ms > 0)) return "";
    const h = ms / 36e5;
    if (h < 1) return `${Math.round(ms / 6e4)} min`;
    if (h < 48) return `${Math.round(h)} hr`;
    return `${Math.round(h / 24)} days`;
  }

  async function load() {
    if (!currentUser || state.loading) return;
    state.loading = true;
    try {
      const r = await apiRequest("/jobHistory/completed");
      state.jobs = r.jobs || [];
      state.deleted = r.deleted || [];
      state.loaded = true;
    } catch (err) {
      console.warn("Completed jobs:", err.message);
    } finally {
      state.loading = false;
    }
    if (!state.open) render();
  }

  function matches(j) {
    const q = state.search.trim().toLowerCase();
    if (q && ![j.ro_number, j.customer_name, j.vehicle, j.insurance, j.estimator].join(" ").toLowerCase().includes(q)) return false;
    const d = String(deliveredOf(j) || j.deleted_at || "").slice(0, 10);
    if (state.from && (!d || d < state.from)) return false;
    if (state.to && (!d || d > state.to)) return false;
    return true;
  }

  function render() {
    const panel = document.getElementById("completedJobs");
    if (!panel) return;
    if (state.open) return renderJob(panel);
    const rows = state.jobs.filter(matches);
    const deleted = state.deleted.filter(matches);
    const days = rows.map(daysInShop).filter((d) => d !== null);
    panel.innerHTML = `
      <div class="section-head heading-row"><div><div class="eyebrow">RECORDS</div><h2>Completed Jobs</h2>
        <p>Every delivered or total-loss job with its full history: when it moved through production, every part, QC checklists and signatures, photos and every change. Click a job to open its file.</p></div>
        <div class="toolbar"><button type="button" class="quiet" onclick="CompletedJobs.refresh()">Refresh</button></div></div>
      <div class="board-summary">
        <div><small>Completed jobs</small><b>${rows.length}</b></div>
        <div><small>Total repair value</small><b>${money(rows.reduce((s, j) => s + Number(j.ro_amount || 0), 0))}</b></div>
        <div><small>Average days in shop</small><b>${days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : "—"}</b></div>
        <div><small>Deleted jobs on record</small><b>${state.deleted.length}</b></div>
      </div>
      <div class="toolbar completed-filters">
        <input id="completedSearch" type="search" placeholder="Search RO, customer, vehicle, insurance…" value="${e(state.search)}" oninput="CompletedJobs.setFilter('search', this.value)">
        <label>Delivered from <input type="date" value="${e(state.from)}" onchange="CompletedJobs.setFilter('from', this.value)"></label>
        <label>to <input type="date" value="${e(state.to)}" onchange="CompletedJobs.setFilter('to', this.value)"></label>
        <label class="completed-deleted-toggle"><input type="checkbox" ${state.showDeleted ? "checked" : ""} onchange="CompletedJobs.setFilter('showDeleted', this.checked)">Show deleted jobs</label>
      </div>
      <div class="table-wrap"><table><thead><tr><th>RO</th><th>Customer</th><th>Vehicle</th><th>Result</th><th>In</th><th>Delivered</th><th>Days</th><th>Value</th><th>Parts</th><th>QC</th><th></th></tr></thead><tbody>
      ${rows.map((j) => `<tr class="clickable" onclick="CompletedJobs.openJob('${e(j.id)}')">
        <td><b>${e(j.ro_number)}</b></td><td>${e(j.customer_name)}</td><td>${e(j.vehicle)}</td>
        <td><span class="pill ${j.current_stage === "Delivered" ? "pill-yes" : "pill-no"}">${e(j.current_stage)}</span></td>
        <td>${e(day(j.onsite_at || j.in_date))}</td><td>${e(day(deliveredOf(j)))}</td><td>${daysInShop(j) ?? ""}</td>
        <td>${money(j.ro_amount)}</td><td>${j.part_count || ""}</td><td>${j.qc_count ? `${j.qc_count} of 5` : ""}</td>
        <td><button type="button" class="quiet">Open</button></td></tr>`).join("")
        || `<tr><td colspan="11">${state.loaded ? "No completed jobs match." : "Loading…"}</td></tr>`}
      </tbody></table></div>
      ${state.showDeleted ? `<h3 class="completed-subhead">Deleted jobs</h3>
      <p class="muted">Jobs someone deleted. ShopControl kept a copy of each one, so its history can still be opened.</p>
      <div class="table-wrap"><table><thead><tr><th>RO</th><th>Customer</th><th>Vehicle</th><th>Stage when deleted</th><th>Value</th><th>Deleted</th><th>By</th><th></th></tr></thead><tbody>
      ${deleted.map((j) => `<tr class="clickable" onclick="CompletedJobs.openJob('${e(j.id)}')">
        <td><b>${e(j.ro_number)}</b></td><td>${e(j.customer_name)}</td><td>${e(j.vehicle)}</td><td>${e(j.current_stage)}</td>
        <td>${money(j.ro_amount)}</td><td>${e(stamp(j.deleted_at))}</td><td>${e(j.deleted_by)}</td><td><button type="button" class="quiet">Open</button></td></tr>`).join("")
        || `<tr><td colspan="8">No deleted jobs match.</td></tr>`}
      </tbody></table></div>` : ""}`;
  }

  async function openJob(id) {
    const panel = document.getElementById("completedJobs");
    state.open = { id, data: null };
    if (panel) panel.innerHTML = `<div class="empty-state">Loading job file…</div>`;
    try {
      const data = await apiRequest(`/jobHistory/${encodeURIComponent(id)}`);
      if (!state.open || state.open.id !== id) return;
      state.open.data = data;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      state.open = null;
      render();
      showStatus(err.message, true);
    }
  }

  // The job file body. Used in the tab and in the printable copy.
  function jobFileHtml(d) {
    const j = d.job;
    const ro = String(j.ro_number || "").trim();
    // Time spent in each stage: the gap between one stage move and the next.
    const moves = d.timeline.filter((t) => t.stage || /^Job created/.test(t.event));
    const endOf = (t) => { const i = moves.indexOf(t); const next = moves[i + 1]; return next ? new Date(next.at) : null; };
    const partRow = (p, removed) => `<tr>
      <td>${e(p.part_description || "Part")}${p.has_core ? ` <span class="pill">Core${p.core_returned ? " returned" : ""}</span>` : ""}</td>
      <td>${e(p.part_type || "")}</td><td>${e(p.part_vendor || "")}</td><td>${e(p.part_qty ?? "")}</td><td>${money(p.part_cost)}</td>
      <td>${e(p.part_status || "")}</td><td>${e(day(p.part_ordered_date))}</td><td>${e(day(p.part_eta))}</td><td>${e(day(p.part_received_date))}</td>
      <td>${removed ? `Removed ${e(stamp(p.removed_at))} by ${e(p.removed_by || "")}` : e(p.location_name ? (p.location_kind === "cart" ? `Cart ${p.location_name}${p.part_shelf ? " · " + (p.part_shelf === "Top" ? "Top" : "Shelf " + p.part_shelf) : ""}` : p.location_name) : "")}</td></tr>`;
    const partHead = `<thead><tr><th>Part</th><th>Type</th><th>Vendor</th><th>Qty</th><th>Cost (est.)</th><th>Status</th><th>Ordered</th><th>ETA</th><th>Received</th><th>Where</th></tr></thead>`;
    const qcDepts = QcChecklists.departments.map((dept) => {
      const recs = d.qc.filter((q) => q.qc_department === dept.id);
      const r = recs[recs.length - 1];
      if (!r) return `<tr><td>${e(dept.id)}</td><td colspan="4" class="muted">Not started</td></tr>`;
      const prog = QcChecklists.progress(dept.id, r.qc_checklist);
      return `<tr><td>${e(dept.id)}</td><td>${prog.done} of ${prog.total}${r.qc_rework_needed === "Yes" ? " · rework" : ""}</td><td>${e(r.qc_performed_by || "")}</td><td>${e(day(r.qc_date))}</td><td>${r.qc_signed_at ? "Signed " + e(stamp(r.qc_signed_at)) : "Not signed"}</td></tr>`;
    }).join("");
    const oldQc = d.qc.filter((q) => !q.qc_department);
    const images = d.attachments.filter((a) => /^image\//.test(a.mime_type || ""));
    const files = d.attachments.filter((a) => !/^image\//.test(a.mime_type || ""));
    const fmt = (v) => (Array.isArray(v) ? v.join(", ") : v === "" || v === null || v === undefined ? "—" : String(v).length > 140 ? String(v).slice(0, 140) + "…" : String(v));

    return `
      ${d.deleted ? `<div class="deleted-banner">This job was deleted ${e(stamp(d.deleted.at))} by ${e(d.deleted.by || "someone")}. ShopControl kept this copy.</div>` : ""}
      <div class="job-facts">
        <div><small>Customer</small><b>${e(j.customer_name || "")}</b></div>
        <div><small>Vehicle</small><b>${e(j.vehicle || "")}</b></div>
        <div><small>Result</small><b>${e(j.current_stage || "")}</b></div>
        <div><small>Repair value</small><b>${money(j.ro_amount) || "—"}</b></div>
        <div><small>Insurance / pay type</small><b>${e([j.insurance, j.pay_type].filter(Boolean).join(" · ") || "—")}</b></div>
        <div><small>Estimator</small><b>${e(j.estimator || "—")}</b></div>
        <div><small>Body techs</small><b>${e(list(j.body_techs) || "—")}</b></div>
        <div><small>Painters</small><b>${e(list(j.painters) || "—")}</b></div>
        <div><small>Prep / assembly / detail</small><b>${e(list(j.support_techs) || "—")}</b></div>
        <div><small>In date</small><b>${e(day(j.in_date) || "—")}</b></div>
        <div><small>On site</small><b>${e(stamp(j.onsite_at) || "—")}</b></div>
        <div><small>Delivered</small><b>${e(stamp(j.delivered_at) || day(j.actual_delivered_date) || "—")}</b></div>
        <div><small>Days in shop</small><b>${daysInShop(j) ?? "—"}</b></div>
        <div><small>Hours (body / paint / other)</small><b>${[j.body_hours, j.paint_hours, j.other_hours].map((h) => Number(h || 0)).join(" / ")}</b></div>
      </div>

      <h3>Production timeline</h3>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>What happened</th><th>By</th><th>Time in stage</th></tr></thead><tbody>
      ${d.timeline.map((t) => `<tr><td>${e(stamp(t.at))}</td><td>${e(t.event)}</td><td>${e(t.who || "")}</td><td>${moves.includes(t) && !["Delivered", "Total Loss"].includes(t.stage) ? e(duration((endOf(t) || new Date(deliveredOf(j) || Date.now())) - new Date(t.at))) : ""}</td></tr>`).join("")
        || `<tr><td colspan="4" class="muted">No stage moves were recorded for this job.</td></tr>`}
      </tbody></table></div>

      <h3>Parts (${d.parts.length})</h3>
      <div class="table-wrap"><table>${partHead}<tbody>${d.parts.map((p) => partRow(p, false)).join("") || `<tr><td colspan="10" class="muted">No parts on file.</td></tr>`}</tbody></table></div>
      ${d.removedParts.length ? `<h4>Parts removed from this job (${d.removedParts.length})</h4>
      <div class="table-wrap"><table>${partHead}<tbody>${d.removedParts.map((p) => partRow(p, true)).join("")}</tbody></table></div>` : ""}
      ${d.cores.length ? `<h4>Core returns</h4><ul>${d.cores.map((c) => `<li>${e(c.description || "")} · ${e(c.assigned_to || "")} · ${e(stamp(c.created_at))}</li>`).join("")}</ul>` : ""}

      <h3>Quality control</h3>
      <div class="table-wrap"><table><thead><tr><th>Checklist</th><th>Checked</th><th>By</th><th>Date</th><th>Signature</th></tr></thead><tbody>${qcDepts}</tbody></table></div>
      ${ro ? `<p class="no-print"><button type="button" onclick="openQcReport(decodeURIComponent('${encodeURIComponent(ro).replace(/'/g, "%27")}'))">Open full QC report with signatures</button></p>` : ""}
      ${oldQc.length ? `<h4>Older QC records</h4><ul>${oldQc.map((q) => `<li>${e(day(q.qc_date))} · ${e(q.qc_performed_by || "")} · ${e(q.qc_final_status || "")}${q.qc_issues ? " · " + e(q.qc_issues) : ""}</li>`).join("")}</ul>` : ""}

      ${d.appointments.length ? `<h3>Appointments</h3><ul>${d.appointments.map((a) => `<li>${e(day(a.appointment_date))} ${e(a.appointment_time || "")} · ${e(a.appointment_type || "")} · ${e(a.title || "")}${a.notes ? " · " + e(a.notes) : ""}</li>`).join("")}</ul>` : ""}

      <h3>Photos and files (${d.attachments.length})</h3>
      ${images.length ? `<div class="job-photos">${images.map((a) => `<a href="${e(a.file_url)}" target="_blank" rel="noopener"><img src="${e(a.file_url)}" alt="${e(a.original_name || "Photo")}" loading="lazy"><small>${e(a.note || a.original_name || "")}</small></a>`).join("")}</div>` : ""}
      ${files.length ? `<ul>${files.map((a) => `<li><a href="${e(a.file_url)}" target="_blank" rel="noopener">${e(a.original_name || "File")}</a> · ${e(a.uploaded_by || "")} · ${e(stamp(a.created_at))}</li>`).join("")}</ul>` : ""}
      ${d.attachments.length ? "" : `<p class="muted">No photos or files were uploaded for this job.</p>`}

      ${j.follow_up_notes || j.management_issue || j.hold_up_reason ? `<h3>Notes</h3>
      ${j.hold_up_reason ? `<p><b>Hold-up:</b> ${e(j.hold_up_reason)}</p>` : ""}${j.follow_up_notes ? `<p><b>Follow-up notes:</b> ${e(j.follow_up_notes)}</p>` : ""}${j.management_issue ? `<p><b>Management issue:</b> ${e(j.management_issue)}</p>` : ""}` : ""}

      <details class="change-history" ${d.changes.length <= 12 ? "open" : ""}><summary><h3>Every change (${d.changes.length})</h3></summary>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>By</th><th>What changed</th></tr></thead><tbody>
      ${d.changes.map((c) => `<tr><td>${e(stamp(c.at))}</td><td>${e(c.who)}</td><td>${c.fields.map((f) => `<div><b>${e(f.field)}:</b> ${e(fmt(f.old))} → ${e(fmt(f.new))}</div>`).join("")}</td></tr>`).join("")
        || `<tr><td colspan="3" class="muted">No changes recorded.</td></tr>`}
      </tbody></table></div></details>`;
  }

  function renderJob(panel) {
    const d = state.open.data;
    if (!d) return;
    const j = d.job;
    panel.innerHTML = `
      <div class="section-head heading-row"><div><div class="eyebrow">COMPLETED JOB FILE</div><h2>RO ${e(j.ro_number || "")} · ${e(j.customer_name || "")}</h2>
        <p>${e(j.vehicle || "")}</p></div>
        <div class="toolbar"><button type="button" class="quiet" onclick="CompletedJobs.back()">← All completed jobs</button><button type="button" onclick="CompletedJobs.print()">Print / Save as PDF</button></div></div>
      <div class="job-file">${jobFileHtml(d)}</div>`;
  }

  function print() {
    const d = state.open && state.open.data;
    if (!d) return;
    const j = d.job;
    const w = window.open("", "_blank");
    if (!w) return showStatus("Allow pop-ups for ShopControl to print the job file.", true);
    w.document.open();
    w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Job File · RO ${e(j.ro_number || "")}</title>
<style>
  body { font: 13px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2933; margin: 0; background: #f4f5f7; }
  .page { max-width: 1000px; margin: 0 auto; padding: 28px; background: #fff; }
  header { display: flex; align-items: center; gap: 20px; border-bottom: 3px solid #f97316; padding-bottom: 14px; margin-bottom: 16px; }
  header img { height: 64px; } header h1 { margin: 0; font-size: 22px; } header p { margin: 2px 0 0; color: #5b6776; }
  h3 { margin: 22px 0 8px; font-size: 16px; border-bottom: 1px solid #d0d5db; padding-bottom: 4px; } h4 { margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; color: #5b6776; }
  .job-facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 16px; } .job-facts small { display: block; color: #5b6776; font-size: 11px; }
  .job-photos { display: flex; flex-wrap: wrap; gap: 8px; } .job-photos a { width: 150px; color: inherit; text-decoration: none; } .job-photos img { width: 150px; height: 110px; object-fit: cover; border-radius: 6px; display: block; }
  .pill { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: #eef2f6; } .muted { color: #8a94a3; }
  .deleted-banner { background: #fff1f2; border-left: 3px solid #e11d48; padding: 8px 12px; margin-bottom: 12px; }
  details summary { list-style: none; } details summary h3 { display: inline; } .no-print { display: none; }
  .actions { text-align: right; margin-bottom: 10px; } .actions button { font: inherit; font-weight: 700; padding: 8px 14px; border-radius: 8px; border: 0; background: #f97316; color: #111; cursor: pointer; }
  footer { margin-top: 20px; color: #8a94a3; font-size: 11px; text-align: center; }
  @media print { body { background: #fff; } .page { padding: 0; } .actions { display: none; } tr, .job-photos a { break-inside: avoid; } }
</style></head><body><div class="page">
<div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>
<header><img src="${location.origin}/img/logo.png" alt="Concept Autobody"><div><h1>Completed Job File · RO ${e(j.ro_number || "")}</h1><p>${e(j.customer_name || "")} · ${e(j.vehicle || "")}</p></div></header>
${jobFileHtml(d).replace(/<details[^>]*>/, "<div>").replace("</details>", "</div>")}
<footer>Printed ${e(new Date().toLocaleString())} from ShopControl</footer>
</div></body></html>`);
    w.document.close();
  }

  // Load fresh each time the tab is opened (the list only matters when someone looks at it).
  document.addEventListener("click", (ev) => {
    if (ev.target.closest && ev.target.closest("#completedJobsTabBtn")) { if (!state.open) load(); }
  });

  return {
    load,
    render,
    openJob,
    print,
    refresh: () => { state.open = null; load(); },
    back: () => { state.open = null; render(); },
    setFilter(key, value) {
      state[key] = value;
      render();
      if (key === "search") { const el = document.getElementById("completedSearch"); if (el) { el.focus(); el.setSelectionRange(value.length, value.length); } }
    },
  };
})();
