// Staff Hub in the employee app: time-off requests, mailbox and company info.
// Uses helpers from mobile.js (apiRequest, showScreen, esc, toast, showAlert, today).
(() => {
  const TYPES = ["Sick", "Vacation", "Bereavement", "Time off without pay", "Military", "Jury duty", "Maternity/Paternity", "Other"];
  const OFFICE_ROLES = ["office", "manager", "admin", "owner"];
  let chosenType = null;
  let inbox = [];
  let openMsg = null;
  let replyTo = null;
  let recipients = [];
  let pollTimer = null;

  const isOffice = () => OFFICE_ROLES.includes(String((currentUser && currentUser.role) || "").toLowerCase());
  const when = (iso) => {
    const d = new Date(iso), now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const fmtDay = (d) => new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  function dates(r) {
    const s = String(r.start_date).slice(0, 10), e = String(r.end_date).slice(0, 10);
    let out = s === e ? fmtDay(s) : `${fmtDay(s)} – ${fmtDay(e)}`;
    if (r.partial_day && r.start_time) out += ` · ${String(r.start_time).slice(0, 5)}–${String(r.end_time).slice(0, 5)}`;
    return out;
  }

  function open(name) {
    setAccent(DEFAULT_ACCENT);
    if (name === "staff") { refreshCounts(); showScreen("staff"); }
    if (name === "timeoff") openTimeOff();
    if (name === "requests") openRequests();
    if (name === "mail") openMail();
    if (name === "info") openInfo();
  }

  // ---------------------------------------------------------------- Counts
  async function refreshCounts() {
    if (!authToken) return;
    try {
      const { count } = await apiRequest("/staff/messages/unread-count");
      for (const id of ["mailCount", "hubCount"]) {
        const el = $(id);
        if (!el) continue;
        el.hidden = !count;
        el.textContent = count > 9 ? "9+" : String(count);
      }
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

  async function openRequests() {
    showScreen("requests");
    const list = $("requestsList");
    list.innerHTML = '<div class="skeleton"></div>';
    try {
      const rows = await apiRequest("/staff/time-off/mine");
      const pending = rows.filter((r) => r.status === "Pending").length;
      $("hubRequestsSub").textContent = pending ? `${pending} waiting for approval` : "Status of your requests";
      list.innerHTML = rows.length ? rows.map((r) => `
        <div class="row-card">
          <b>${esc(r.request_type === "Other" ? `Other: ${r.other_reason}` : r.request_type)}</b>
          <small>${esc(dates(r))}</small><br>
          <span class="pill ${r.status === "Approved" ? "ok" : r.status === "Denied" ? "bad" : ""}">${esc(r.status === "Pending" ? "Waiting for approval" : r.status)}</span>
          ${r.decided_by ? `<small style="display:block;margin-top:6px">${esc(r.status)} by ${esc(r.decided_by)}${r.decision_note ? ` · ${esc(r.decision_note)}` : ""}</small>` : ""}
          ${r.status === "Pending" ? `<button class="btn btn-ghost" style="margin-top:10px;padding:11px" data-cancel="${esc(r.id)}">Cancel request</button>` : ""}
        </div>`).join("") : `<div class="empty">No requests yet.</div><button class="btn btn-primary" style="margin-top:12px" data-staff-go="timeoff">Request time off</button>`;
    } catch (err) { list.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  async function cancelRequest(id) {
    try { await apiRequest(`/staff/time-off/${id}/cancel`, { method: "POST" }); toast("Request cancelled"); openRequests(); }
    catch (err) { toast(err.message); }
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
          <div class="subj">${esc(m.subject)}</div><div class="prev">${esc(m.body)}</div>
        </button>`).join("") : '<div class="empty">No messages yet.</div>';
      refreshCounts();
    } catch (err) { list.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  async function openMessage(id) {
    openMsg = inbox.find((m) => m.id === id);
    if (!openMsg) return;
    $("msgBarTitle").textContent = openMsg.sender_name;
    $("msgMeta").textContent = `From ${openMsg.sender_name}${openMsg.audience ? ` · to ${openMsg.audience}` : ""} · ${new Date(openMsg.created_at).toLocaleString()}`;
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
        ? rows.map((s) => `<div class="info-card"><h3>${esc(s.title)}</h3><div class="info-body">${esc(s.body)}</div></div>`).join("")
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
      const cancel = e.target.closest("[data-cancel]");
      if (cancel) return cancelRequest(cancel.dataset.cancel);
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
    $("mailComposeBtn").onclick = () => openCompose();
    $("msgReplyBtn").onclick = () => openCompose(openMsg);
    $("composeSend").onclick = sendMessage;

    window.refreshStaffCounts = refreshCounts;
    refreshCounts();
    clearInterval(pollTimer);
    pollTimer = setInterval(refreshCounts, 30000);
  });
})();
