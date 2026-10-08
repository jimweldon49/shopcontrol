// Staff Hub in the employee app: time-off requests, missed punch slips, mailbox and company info.
// Uses helpers from mobile.js (apiRequest, showScreen, esc, toast, showAlert, today).
(() => {
  const TYPES = ["Sick", "Vacation", "Bereavement", "Time off without pay", "Military", "Jury duty", "Maternity/Paternity", "Other"];
  const OFFICE_ROLES = ["office", "manager", "admin", "owner"];
  // Only these can approve or deny time off (matches APPROVER_ROLES in server/src/routes/staff.js).
  const APPROVER_ROLES = ["admin", "owner"];
  let chosenType = null;
  let inbox = [];
  let openMsg = null;
  let replyTo = null;
  let recipients = [];
  let pollTimer = null;

  const isOffice = () => OFFICE_ROLES.includes(String((currentUser && currentUser.role) || "").toLowerCase());
  const isApprover = () => APPROVER_ROLES.includes(String((currentUser && currentUser.role) || "").toLowerCase());
  const typeLabel = (r) => (r.request_type === "Other" ? `Other: ${r.other_reason}` : r.request_type);
  const when = (iso) => {
    const d = new Date(iso), now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString(I18n.locale(), { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(I18n.locale(), { month: "short", day: "numeric" });
  };
  const fmtDay = (d) => new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString(I18n.locale(), { weekday: "short", month: "short", day: "numeric" });
  function dates(r) {
    const s = String(r.start_date).slice(0, 10), e = String(r.end_date).slice(0, 10);
    let out = s === e ? fmtDay(s) : `${fmtDay(s)} – ${fmtDay(e)}`;
    if (r.partial_day && r.start_time) out += ` · ${String(r.start_time).slice(0, 5)}–${String(r.end_time).slice(0, 5)}`;
    return out;
  }
  // Missed punch slips (paper form "Missed Punch"); payroll runs Thursday to Wednesday.
  const hhmm = (t) => (t ? String(t).slice(0, 5) : "");
  const clock = (t) => new Date(`2000-01-01T${hhmm(t)}:00`).toLocaleTimeString(I18n.locale(), { hour: "numeric", minute: "2-digit" });
  function payWeek(date) {
    const d = new Date(String(date).slice(0, 10) + "T12:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 3) % 7));
    const end = new Date(d); end.setDate(d.getDate() + 6);
    const f = (x) => x.toLocaleDateString(I18n.locale(), { month: "short", day: "numeric" });
    return `${f(d)} – ${f(end)}`;
  }
  const punchTimes = (r) => `${I18n.t("In")} ${clock(r.time_in)}${r.lunch_out ? ` · ${I18n.t("Lunch")} ${clock(r.lunch_out)}–${clock(r.lunch_in)}` : ` · ${I18n.t("No lunch")}`} · ${I18n.t("Out")} ${clock(r.time_out)}`;
  // Time off and missed punches share My requests and Approve; kind picks the API path.
  const KIND_PATH = { timeoff: "time-off", punch: "missed-punch" };
  const reqTitle = (r) => (r.kind === "punch" ? `${I18n.t("Missed punch")} · ${fmtDay(r.punch_date)}` : typeLabel(r));
  const reqDetail = (r) => (r.kind === "punch" ? `${punchTimes(r)}` : dates(r));
  async function loadBoth(timeOffPath, punchPath) {
    const [a, b] = await Promise.all([apiRequest(timeOffPath), apiRequest(punchPath).catch(() => [])]);
    return [...a.map((r) => ({ ...r, kind: "timeoff" })), ...b.map((r) => ({ ...r, kind: "punch" }))];
  }

  function open(name) {
    setAccent(DEFAULT_ACCENT);
    if (name === "staff") { refreshCounts(); showScreen("staff"); }
    if (name === "timeoff") openTimeOff();
    if (name === "punch") openPunch();
    if (name === "requests") openRequests();
    if (name === "approve") openApprove();
    if (name === "mail") openMail();
    if (name === "info") openInfo();
  }

  // ---------------------------------------------------------------- Counts
  function setBadge(id, count) {
    const el = $(id);
    if (!el) return;
    el.hidden = !count;
    el.textContent = count > 9 ? "9+" : String(count);
  }

  async function refreshCounts() {
    if (!authToken) return;
    $("hubApproveTile").hidden = !isApprover();
    try {
      const { count } = await apiRequest("/staff/messages/unread-count");
      let waiting = 0;
      if (isApprover()) {
        waiting = (await apiRequest("/staff/time-off?status=Pending").catch(() => [])).length
          + (await apiRequest("/staff/missed-punch?status=Pending").catch(() => [])).length;
        const sub = $("hubApproveSub");
        sub.textContent = waiting ? `${waiting} waiting` : "Time off and missed punches";
        sub.classList.toggle("waiting", !!waiting);
      }
      setBadge("mailCount", count);
      setBadge("hubCount", count + waiting);
      $("hubMailSub").textContent = count ? `${count} unread` : "Messages from the office";
    } catch (_) {}
  }

  // ---------------------------------------------------------------- Time off
  function openTimeOff() {
    chosenType = null;
    $("toName").textContent = (currentUser && currentUser.fullName) || "";
    $("toTypes").innerHTML = TYPES.map((t) => `<button class="choice" data-type="${esc(t)}">${esc(t)}</button>`).join("");
    $("toOtherWrap").hidden = true;
    $("toOther").value = "";
    $("toStart").value = today();
    $("toEnd").value = today();
    $("toPartial").checked = false;
    $("toTimes").hidden = true;
    $("toNotes").value = "";
    showAlert("toError", "");
    showScreen("timeoff");
  }

  async function submitTimeOff() {
    showAlert("toError", "");
    const partial = $("toPartial").checked;
    const body = {
      request_type: chosenType,
      other_reason: $("toOther").value.trim(),
      start_date: $("toStart").value,
      end_date: partial ? $("toStart").value : $("toEnd").value,
      partial_day: partial,
      start_time: partial ? $("toFrom").value : null,
      end_time: partial ? $("toTo").value : null,
      notes: $("toNotes").value.trim(),
    };
    if (!body.request_type) return showAlert("toError", "Choose the type of absence.");
    if (body.request_type === "Other" && !body.other_reason) return showAlert("toError", "Write in the reason for your absence.");
    if (!body.start_date || !body.end_date) return showAlert("toError", "Choose your dates.");
    if (body.end_date < body.start_date) return showAlert("toError", "The last day can't be before the first day.");
    const btn = $("toSubmit");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await apiRequest("/staff/time-off", { method: "POST", body: JSON.stringify(body) });
      toast("Request sent to the office ✓");
      openRequests();
    } catch (err) { showAlert("toError", err.message); }
    finally { btn.disabled = false; btn.textContent = "Submit request"; }
  }

  // ---------------------------------------------------------------- Missed punch
  function openPunch() {
    $("mpName").textContent = (currentUser && currentUser.fullName) || "";
    $("mpDate").value = today();
    $("mpDate").max = today();
    for (const id of ["mpIn", "mpOut", "mpLunchOut", "mpLunchIn", "mpNotes", "mpInitials"]) $(id).value = "";
    $("mpNoLunch").checked = false;
    $("mpLunch").hidden = false;
    showWeek();
    showAlert("mpError", "");
    showScreen("punch");
  }

  function showWeek() {
    const d = $("mpDate").value;
    $("mpWeek").textContent = d ? `${I18n.t("Payroll week")}: ${payWeek(d)} (${I18n.t("Thu–Wed")})` : "";
  }

  async function submitPunch() {
    showAlert("mpError", "");
    const noLunch = $("mpNoLunch").checked;
    const body = {
      punch_date: $("mpDate").value,
      time_in: $("mpIn").value,
      lunch_out: noLunch ? "" : $("mpLunchOut").value,
      lunch_in: noLunch ? "" : $("mpLunchIn").value,
      time_out: $("mpOut").value,
      initials: $("mpInitials").value.trim(),
      notes: $("mpNotes").value.trim(),
    };
    if (!body.punch_date) return showAlert("mpError", "Choose the date of the missed punch.");
    if (body.punch_date > today()) return showAlert("mpError", "The date can't be in the future.");
    if (!body.time_in || !body.time_out) return showAlert("mpError", "Enter your time in and time out.");
    if (!noLunch && (!body.lunch_out || !body.lunch_in)) return showAlert("mpError", "Enter both lunch times, or check \"I didn't take a lunch\".");
    const order = noLunch ? [body.time_in, body.time_out] : [body.time_in, body.lunch_out, body.lunch_in, body.time_out];
    if (order.some((t, i) => i && t <= order[i - 1])) return showAlert("mpError", "The times must be in order: in, lunch out, lunch in, out.");
    if (!body.initials) return showAlert("mpError", "Type your initials.");
    const btn = $("mpSubmit");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await apiRequest("/staff/missed-punch", { method: "POST", body: JSON.stringify(body) });
      toast("Missed punch sent to the office ✓");
      openRequests();
    } catch (err) { showAlert("mpError", err.message); }
    finally { btn.disabled = false; btn.textContent = "Submit missed punch"; }
  }

  async function openRequests() {
    showScreen("requests");
    const list = $("requestsList");
    list.innerHTML = '<div class="skeleton"></div>';
    try {
      const rows = (await loadBoth("/staff/time-off/mine", "/staff/missed-punch/mine"))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const pending = rows.filter((r) => r.status === "Pending").length;
      $("hubRequestsSub").textContent = pending ? `${pending} waiting for approval` : "Status of your requests";
      list.innerHTML = rows.length ? rows.map((r) => `
        <div class="row-card">
          <b>${esc(reqTitle(r))}</b>
          <small>${esc(reqDetail(r))}</small><br>
          <span class="pill ${r.status === "Approved" ? "ok" : r.status === "Denied" ? "bad" : ""}">${esc(r.status === "Pending" ? "Waiting for approval" : r.status)}</span>
          ${r.decided_by ? `<small style="display:block;margin-top:6px">${esc(r.status)} by ${esc(r.decided_by)}${r.decision_note ? ` · ${esc(r.decision_note)}` : ""}</small>` : ""}
          ${r.status === "Pending" ? `<button class="btn btn-ghost" style="margin-top:10px;padding:11px" data-cancel="${esc(r.id)}" data-kind="${r.kind}">Cancel request</button>` : ""}
        </div>`).join("") : `<div class="empty">No requests yet.</div><button class="btn btn-primary" style="margin-top:12px" data-staff-go="timeoff">Request time off</button>`;
    } catch (err) { list.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  async function cancelRequest(id, kind) {
    try { await apiRequest(`/staff/${KIND_PATH[kind]}/${id}/cancel`, { method: "POST" }); toast("Request cancelled"); openRequests(); }
    catch (err) { toast(err.message); }
  }

  // ---------------------------------------------------------------- Approve time off and missed punches (admins)
  let approveRows = [];

  async function openApprove() {
    showScreen("approve");
    const list = $("approveList");
    list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try {
      approveRows = await loadBoth("/staff/time-off", "/staff/missed-punch");
      const pending = approveRows.filter((r) => r.status === "Pending").sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const decided = approveRows.filter((r) => r.status === "Approved" || r.status === "Denied")
        .sort((a, b) => String(b.decided_at || b.updated_at).localeCompare(String(a.decided_at || a.updated_at))).slice(0, 15);
      const card = (r, buttons) => `
        <div class="row-card">
          <b translate="no">${esc(r.full_name)}</b>
          <small>${esc(reqTitle(r))} · ${esc(reqDetail(r))}</small>
          ${r.kind === "punch" ? `<small style="display:block;margin-top:4px">${esc(I18n.t("Payroll week"))} ${esc(payWeek(r.punch_date))} · ${esc(I18n.t("Initials"))} <span translate="no">${esc(r.initials)}</span></small>` : ""}
          ${r.notes ? `<small style="display:block;margin-top:6px" translate="no">${esc(r.notes)}</small>` : ""}
          ${buttons ? `<div class="decide-row">
            <button class="btn btn-approve" data-decide="Approved" data-req="${esc(r.id)}" data-kind="${r.kind}">Approve</button>
            <button class="btn btn-deny" data-decide="Denied" data-req="${esc(r.id)}" data-kind="${r.kind}">Deny</button></div>`
          : `<span class="pill ${r.status === "Approved" ? "ok" : "bad"}">${esc(r.status)}</span>
             <small style="display:block;margin-top:6px">${esc(r.status)} by ${esc(r.decided_by || "")}${r.decision_note ? ` · ${esc(r.decision_note)}` : ""}</small>`}
        </div>`;
      list.innerHTML = `<div class="eyebrow">Waiting for approval</div>
        ${pending.length ? pending.map((r) => card(r, true)).join("") : '<div class="empty">No requests are waiting.</div>'}
        ${decided.length ? `<div class="eyebrow" style="margin-top:18px">Recently decided</div>${decided.map((r) => card(r, false)).join("")}` : ""}`;
      refreshCounts();
    } catch (err) { list.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  function openDecision(id, decision, kind) {
    const r = approveRows.find((x) => x.id === id && x.kind === kind);
    if (!r) return;
    const approve = decision === "Approved";
    const back = document.createElement("div");
    back.className = "sheet-backdrop";
    back.innerHTML = `<div class="sheet"><div class="grab"></div>
      <h3>${approve ? "Approve" : "Deny"} ${kind === "punch" ? "missed punch" : "time off"}?</h3>
      <div class="row-card"><b translate="no">${esc(r.full_name)}</b><small>${esc(reqTitle(r))} · ${esc(reqDetail(r))}</small></div>
      <label class="field"><span>Note to the employee (optional)</span><textarea class="input" id="decideNote" maxlength="1000"></textarea></label>
      <button class="btn ${approve ? "btn-approve" : "btn-deny"}" data-confirm>${approve ? "Approve" : "Deny"}</button>
      <button class="btn btn-ghost" data-close>Cancel</button></div>`;
    back.onclick = async (e) => {
      if (e.target === back || e.target.closest("[data-close]")) return back.remove();
      const btn = e.target.closest("[data-confirm]");
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      try {
        await apiRequest(`/staff/${KIND_PATH[kind]}/${id}/decision`, { method: "POST", body: JSON.stringify({ decision, note: $("decideNote").value.trim() }) });
        back.remove();
        toast(approve ? "Approved ✓ The employee and office were notified" : "Denied ✓ The employee and office were notified");
        openApprove();
      } catch (err) { btn.disabled = false; toast(err.message); }
    };
    document.body.append(back);
  }

  // ---------------------------------------------------------------- Mailbox
  async function openMail() {
    showScreen("mail");
    const list = $("mailList");
    list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try {
      inbox = await apiRequest("/staff/messages");
      list.innerHTML = inbox.length ? inbox.map((m) => `
        <button class="mail-item ${m.read_at ? "" : "unread"}" data-msg="${esc(m.id)}">
          <div class="top"><b>${esc(m.sender_name)}</b><small>${esc(when(m.created_at))}</small></div>
          <div class="subj" translate="no">${esc(m.subject)}</div><div class="prev" translate="no">${esc(m.body)}</div>
        </button>`).join("") : '<div class="empty">No messages yet.</div>';
      refreshCounts();
    } catch (err) { list.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  async function openMessage(id) {
    openMsg = inbox.find((m) => m.id === id);
    if (!openMsg) return;
    $("msgBarTitle").textContent = openMsg.sender_name;
    $("msgMeta").textContent = `From ${openMsg.sender_name}${openMsg.audience ? ` · to ${openMsg.audience}` : ""} · ${new Date(openMsg.created_at).toLocaleString(I18n.locale())}`;
    $("msgSubject").textContent = openMsg.subject;
    $("msgBody").textContent = openMsg.body;
    $("msgReplyBtn").hidden = !openMsg.sender_id;
    showScreen("message");
    if (!openMsg.read_at) {
      try { const r = await apiRequest(`/staff/messages/${id}/read`, { method: "PUT" }); openMsg.read_at = r.read_at; refreshCounts(); } catch (_) {}
    }
  }

  async function openCompose(reply) {
    replyTo = reply || null;
    showAlert("composeError", "");
    $("composeTitle").textContent = replyTo ? `Reply to ${replyTo.sender_name}` : "New message";
    $("composeToWrap").hidden = !!replyTo;
    $("composeSubject").value = replyTo ? (replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`) : "";
    $("composeBody").value = "";
    if (!replyTo) {
      if (isOffice()) {
        if (!recipients.length) recipients = await apiRequest("/staff/recipients").catch(() => []);
        $("composeTo").innerHTML = `<option value="">Choose…</option><option value="office">Office &amp; admins</option><option value="everyone">Everyone</option>
          <optgroup label="Department">${QcChecklists.names.map((d) => `<option value="dept:${esc(d)}">${esc(d)}</option>`).join("")}</optgroup>
          <optgroup label="Person">${recipients.filter((u) => u.id !== currentUser.id).map((u) => `<option value="user:${esc(u.id)}">${esc(u.full_name)}</option>`).join("")}</optgroup>`;
      } else {
        $("composeTo").innerHTML = '<option value="office">Office &amp; admins</option>';
      }
    }
    showScreen("compose");
  }

  async function sendMessage() {
    showAlert("composeError", "");
    const body = { subject: $("composeSubject").value.trim(), body: $("composeBody").value.trim() };
    if (!body.body) return showAlert("composeError", "Write a message.");
    if (replyTo) body.reply_to = replyTo.id;
    else {
      const to = $("composeTo").value;
      if (!to) return showAlert("composeError", "Choose who it's for.");
      if (to.startsWith("user:")) body.recipient_ids = [to.slice(5)]; else body.audience = to;
    }
    const btn = $("composeSend");
    btn.disabled = true;
    try {
      const r = await apiRequest("/staff/messages", { method: "POST", body: JSON.stringify(body) });
      toast(`Sent to ${r.sent} ${r.sent === 1 ? "person" : "people"} ✓`);
      openMail();
    } catch (err) { showAlert("composeError", err.message); }
    finally { btn.disabled = false; }
  }

  // ---------------------------------------------------------------- Company info
  async function openInfo() {
    showScreen("info");
    const list = $("infoList");
    list.innerHTML = '<div class="skeleton"></div>';
    try {
      const rows = await apiRequest("/staff/company-info");
      list.innerHTML = rows.length
        ? rows.map((s) => `<div class="info-card"><h3 translate="no">${esc(s.title)}</h3><div class="info-body" translate="no">${esc(s.body)}</div></div>`).join("")
        : '<div class="empty">Nothing here yet. The office will add shop info soon.</div>';
    } catch (err) { list.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  // ---------------------------------------------------------------- Wiring
  document.addEventListener("DOMContentLoaded", () => {
    $("staffHubBtn").onclick = () => open("staff");
    $("mailBtn").onclick = () => open("mail");
    document.addEventListener("click", (e) => {
      const go = e.target.closest("[data-staff-go]");
      if (go) return open(go.dataset.staffGo);
      const back = e.target.closest("[data-staff-back]");
      if (back) return back.dataset.staffBack === "home" ? enterHome() : open(back.dataset.staffBack);
      const decide = e.target.closest("[data-decide]");
      if (decide) return openDecision(decide.dataset.req, decide.dataset.decide, decide.dataset.kind);
      const cancel = e.target.closest("[data-cancel]");
      if (cancel) return cancelRequest(cancel.dataset.cancel, cancel.dataset.kind);
      const msg = e.target.closest("[data-msg]");
      if (msg) return openMessage(msg.dataset.msg);
      const type = e.target.closest("[data-type]");
      if (type) {
        chosenType = type.dataset.type;
        document.querySelectorAll("#toTypes .choice").forEach((b) => b.classList.toggle("on", b === type));
        $("toOtherWrap").hidden = chosenType !== "Other";
        if (chosenType === "Other") setTimeout(() => $("toOther").focus(), 50);
      }
    });
    $("toPartial").addEventListener("change", () => {
      const on = $("toPartial").checked;
      $("toTimes").hidden = !on;
      $("toEnd").closest(".field").style.opacity = on ? ".4" : "";
      $("toEnd").disabled = on;
    });
    $("toStart").addEventListener("change", () => { if ($("toEnd").value < $("toStart").value) $("toEnd").value = $("toStart").value; });
    $("toSubmit").onclick = submitTimeOff;
    $("mpSubmit").onclick = submitPunch;
    $("mpDate").addEventListener("change", showWeek);
    $("mpNoLunch").addEventListener("change", () => { $("mpLunch").hidden = $("mpNoLunch").checked; });
    $("mailComposeBtn").onclick = () => openCompose();
    $("msgReplyBtn").onclick = () => openCompose(openMsg);
    $("composeSend").onclick = sendMessage;

    window.refreshStaffCounts = refreshCounts;
    refreshCounts();
    clearInterval(pollTimer);
    pollTimer = setInterval(refreshCounts, 30000);
  });
})();
