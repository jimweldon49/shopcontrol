// Staff hub on the desktop: Time Off (review / approve) and Messages & Info
// (mailbox, compose, company info editor). API: /api/staff (server/src/routes/staff.js).
const StaffHub = (() => {
  const OFFICE_ROLES = ["office", "manager", "admin", "owner"];
  const APPROVER_ROLES = ["admin", "owner"];
  const TIME_OFF_TYPES = ["Sick", "Vacation", "Bereavement", "Time off without pay", "Military", "Jury duty", "Maternity/Paternity", "Other"];
  const state = { timeOff: [], inbox: [], sent: [], recipients: [], info: [], filter: "Pending", openMessage: null, timer: null };
  const role = () => String((currentUser && currentUser.role) || "").toLowerCase();
  const isOffice = () => OFFICE_ROLES.includes(role());
  const isApprover = () => APPROVER_ROLES.includes(role());
  const e = (v) => escapeHtml(v);
  const req = (path, opts) => apiRequest(`/staff${path}`, opts);
  const post = (path, body) => req(path, { method: "POST", body: JSON.stringify(body || {}) });

  function fmtDate(d) {
    return new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  function dates(r) {
    const s = String(r.start_date).slice(0, 10), en = String(r.end_date).slice(0, 10);
    let out = s === en ? fmtDate(s) : `${fmtDate(s)} – ${fmtDate(en)}`;
    if (r.partial_day && r.start_time) out += ` · ${String(r.start_time).slice(0, 5)}–${String(r.end_time).slice(0, 5)}`;
    const days = Math.round((new Date(en + "T12:00:00") - new Date(s + "T12:00:00")) / 864e5) + 1;
    return out + (r.partial_day ? " (partial day)" : days > 1 ? ` (${days} days)` : "");
  }
  const typeLabel = (r) => (r.request_type === "Other" ? `Other: ${r.other_reason || ""}` : r.request_type);
  const statusPill = (s) => `<span class="pill ${s === "Approved" ? "pill-yes" : s === "Denied" || s === "Cancelled" ? "pill-no" : "pill-admin"}">${e(s)}</span>`;

  async function load() {
    if (!currentUser) return;
    const jobs = [req("/messages").then((r) => (state.inbox = r)), req("/company-info").then((r) => (state.info = r))];
    if (isOffice()) jobs.push(req("/time-off").then((r) => (state.timeOff = r)));
    await Promise.all(jobs.map((p) => p.catch((err) => console.warn("Staff hub:", err.message))));
    render();
  }

  function render() {
    renderBadges();
    renderTimeOff();
    renderMessages();
  }

  function renderBadges() {
    const pending = state.timeOff.filter((r) => r.status === "Pending").length;
    const unread = state.inbox.filter((m) => !m.read_at).length;
    const tb = document.getElementById("timeOffTabBtn"), mb = document.getElementById("staffHubTabBtn"), tile = document.getElementById("metricTimeOffTile");
    if (tb) { tb.style.display = isOffice() ? "" : "none"; tb.innerHTML = `Time Off${pending ? ` <span class="tab-count">${pending}</span>` : ""}`; }
    if (mb) mb.innerHTML = `Messages &amp; Info${unread ? ` <span class="tab-count">${unread}</span>` : ""}`;
    if (tile) { tile.style.display = isOffice() ? "" : "none"; document.getElementById("metricTimeOff").textContent = pending; }
  }

  // ---------------------------------------------------------------- Time off
  function renderTimeOff() {
    const panel = document.getElementById("timeOff");
    if (!panel || !isOffice()) return;
    const rows = state.filter === "All" ? state.timeOff : state.timeOff.filter((r) => r.status === state.filter);
    const today = dateKey();
    const outNow = state.timeOff.filter((r) => r.status === "Approved" && String(r.start_date).slice(0, 10) <= today && String(r.end_date).slice(0, 10) >= today);
    panel.innerHTML = `
      <div class="section-head heading-row"><div><div class="eyebrow">STAFF</div><h2>Time Off</h2>
        <p>Absence requests from the employee app. ${isApprover() ? "Approve or deny below; the employee is notified automatically." : "Only admins can approve or deny requests."}</p></div></div>
      <div class="board-summary">
        <div><small>Waiting for a decision</small><b>${state.timeOff.filter((r) => r.status === "Pending").length}</b></div>
        <div><small>Out today</small><b>${outNow.length}</b></div>
        <div><small>Approved (upcoming)</small><b>${state.timeOff.filter((r) => r.status === "Approved" && String(r.end_date).slice(0, 10) >= today).length}</b></div>
        <div><small>Who's out</small><b style="font-size:13px;font-weight:600">${e(outNow.map((r) => r.full_name).join(", ") || "Nobody")}</b></div>
      </div>
      <div class="toolbar">${["Pending", "Approved", "Denied", "All"].map((f) => `<button type="button" class="${state.filter === f ? "" : "quiet"}" onclick="StaffHub.setFilter('${f}')">${f}</button>`).join("")}</div>
      <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Notes</th><th>Requested</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${rows.map((r) => `<tr>
        <td><b>${e(r.full_name)}</b></td><td>${e(typeLabel(r))}</td><td>${e(dates(r))}</td><td>${e(r.notes || "")}</td>
        <td>${e(formatDateTime(r.created_at))}</td>
        <td>${statusPill(r.status)}${r.decided_by ? `<small>${e(r.decided_by)} · ${e(formatDateTime(r.decided_at))}</small>` : ""}${r.decision_note ? `<small>${e(r.decision_note)}</small>` : ""}</td>
        <td><div class="actions">${r.status === "Pending" && isApprover() ? `<button onclick="StaffHub.decide('${r.id}','Approved')">Approve</button><button class="danger" onclick="StaffHub.decide('${r.id}','Denied')">Deny</button>` : ""}</div></td>
      </tr>`).join("") || `<tr><td colspan="7">No ${state.filter === "All" ? "" : state.filter.toLowerCase() + " "}requests.</td></tr>`}
      </tbody></table></div>`;
  }

  function decide(id, decision) {
    const r = state.timeOff.find((x) => x.id === id);
    if (!r) return;
    const dialog = openDialog(`${decision === "Approved" ? "Approve" : "Deny"} time off`, `
      <p><b>${e(r.full_name)}</b> · ${e(typeLabel(r))}<br>${e(dates(r))}</p>${r.notes ? `<p class="board-tip">${e(r.notes)}</p>` : ""}
      <label>Note to ${e(r.full_name.split(" ")[0])} (optional)<textarea name="note" maxlength="1000" placeholder="${decision === "Denied" ? "Let them know why" : "e.g. Enjoy your time off"}"></textarea></label>
      <p class="board-tip">They'll get a message in the employee app${decision === "Approved" ? " saying it's approved" : ""}, and an email if their account has one.</p>`,
      async (form) => {
        await post(`/time-off/${id}/decision`, { decision, note: form.get("note") });
        showStatus(`Time off ${decision.toLowerCase()} for ${r.full_name}.`);
        await load();
      });
    dialog.querySelector("[type=submit]").textContent = decision === "Approved" ? "Approve" : "Deny";
  }

  // ---------------------------------------------------------------- Messages & info
  function audienceOptions() {
    if (!isOffice()) return `<option value="office">Office</option>`;
    return `<option value="">Choose…</option><option value="everyone">Everyone</option><option value="office">Office &amp; admins</option>
      <optgroup label="Department">${QcChecklists.names.map((d) => `<option value="dept:${e(d)}">${e(d)}</option>`).join("")}</optgroup>
      <optgroup label="Person">${state.recipients.filter((u) => u.id !== currentUser.id).map((u) => `<option value="user:${u.id}">${e(u.full_name)}${u.job_title ? ` · ${e(u.job_title)}` : ""}</option>`).join("")}</optgroup>`;
  }

  function renderMessages() {
    const panel = document.getElementById("staffHub");
    if (!panel) return;
    const m = state.openMessage && state.inbox.find((x) => x.id === state.openMessage);
    panel.innerHTML = `
      <div class="section-head heading-row"><div><div class="eyebrow">STAFF</div><h2>Messages &amp; Info</h2>
        <p>Internal messages to staff (they show in the employee app's mailbox) and the company info page techs see in the app.</p></div>
        <button onclick="StaffHub.compose()">＋ New message</button></div>
      <div class="staff-grid">
        <div class="card"><h3>Inbox</h3>
          ${state.inbox.map((x) => `<button type="button" class="mail-row ${x.read_at ? "" : "unread"} ${m && m.id === x.id ? "open" : ""}" onclick="StaffHub.openMail('${x.id}')">
            <b>${e(x.sender_name)}</b><span>${e(x.subject)}</span><small>${e(formatDateTime(x.created_at))}</small></button>`).join("") || '<p class="empty">No messages.</p>'}
        </div>
        <div class="card">${m ? `<div class="mail-view"><small>${e(m.audience ? `To: ${m.audience}` : "To: you")} · ${e(formatDateTime(m.created_at))}</small><h3>${e(m.subject)}</h3><p class="mail-from">From ${e(m.sender_name)}</p><div class="mail-body">${e(m.body)}</div>
            ${m.sender_id ? `<button onclick="StaffHub.compose('${m.id}')">Reply</button>` : ""}</div>` : '<p class="empty">Select a message to read it.</p>'}</div>
      </div>
      <div class="card"><div class="heading-row"><h3>Company info</h3>${isApprover() ? `<button onclick="StaffHub.editInfo()">＋ Add section</button>` : ""}</div>
        <p class="board-tip">Shown to everyone under Staff Hub → Company info in the employee app.</p>
        ${state.info.map((s) => `<div class="info-section"><div class="heading-row"><h3>${e(s.title)}</h3>${isApprover() ? `<div class="actions"><button class="quiet" onclick="StaffHub.editInfo('${s.id}')">Edit</button><button class="danger" onclick="StaffHub.deleteInfo('${s.id}')">Remove</button></div>` : ""}</div><div class="mail-body">${e(s.body)}</div></div>`).join("") || '<p class="empty">No company info yet.</p>'}
      </div>`;
  }

  async function openMail(id) {
    state.openMessage = id;
    const m = state.inbox.find((x) => x.id === id);
    if (m && !m.read_at) {
      try { const r = await req(`/messages/${id}/read`, { method: "PUT" }); m.read_at = r.read_at; } catch (_) {}
    }
    render();
  }

  async function compose(replyToId) {
    if (!state.recipients.length) state.recipients = await req("/recipients").catch(() => []);
    const original = replyToId && state.inbox.find((x) => x.id === replyToId);
    openDialog(original ? `Reply to ${original.sender_name}` : "New message", `
      ${original ? "" : `<label>To<select name="to" required>${audienceOptions()}</select></label>`}
      <label>Subject<input name="subject" maxlength="200" value="${original ? e(original.subject.startsWith("Re:") ? original.subject : "Re: " + original.subject) : ""}"></label>
      <label>Message<textarea name="body" required maxlength="5000" style="min-height:140px"></textarea></label>`,
      async (form) => {
        const body = { subject: form.get("subject"), body: form.get("body") };
        if (original) body.reply_to = original.id;
        else {
          const to = form.get("to");
          if (!to) throw Error("Choose who the message is for.");
          if (to.startsWith("user:")) body.recipient_ids = [to.slice(5)]; else body.audience = to;
        }
        const r = await post("/messages", body);
        showStatus(`Message sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}.`);
      });
  }

  function editInfo(id) {
    const s = id ? state.info.find((x) => x.id === id) : { title: "", body: "", sort_order: state.info.length };
    openDialog(id ? "Edit section" : "Add company info section", `
      <label>Title<input name="title" required maxlength="120" value="${e(s.title)}" placeholder="e.g. Shop hours, Holiday schedule, Who to call"></label>
      <label>Text<textarea name="body" maxlength="20000" style="min-height:220px">${e(s.body)}</textarea></label>
      <label>Order (lower shows first)<input name="sort_order" type="number" step="1" value="${Number(s.sort_order) || 0}"></label>`,
      async (form) => {
        const body = { title: form.get("title"), body: form.get("body"), sort_order: parseInt(form.get("sort_order"), 10) || 0 };
        await (id ? req(`/company-info/${id}`, { method: "PUT", body: JSON.stringify(body) }) : post("/company-info", body));
        showStatus("Company info saved.");
        await load();
      });
  }

  async function deleteInfo(id) {
    if (!confirm("Remove this section from Company info?")) return;
    try { await req(`/company-info/${id}`, { method: "DELETE" }); await load(); } catch (err) { showStatus(err.message, true); }
  }

  function setFilter(f) { state.filter = f; renderTimeOff(); }

  function start() {
    stop();
    req("/recipients").then((r) => (state.recipients = r)).catch(() => {});
    load();
    state.timer = setInterval(load, 30000);
  }
  function stop() { clearInterval(state.timer); state.timer = null; Object.assign(state, { timeOff: [], inbox: [], info: [], openMessage: null }); }

  return { start, stop, load, setFilter, decide, openMail, compose, editInfo, deleteInfo, TIME_OFF_TYPES };
})();
