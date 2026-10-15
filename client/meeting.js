// Morning Meeting (desktop). Everyone can add a topic for tomorrow's meeting. Office staff
// and managers see the topics to proofread, and the day's sheet pulled together by the
// server (API: /api/meeting, server/src/routes/meeting.js): housekeeping topics, time off,
// meetings/training, teardowns, past-due cycle times (DRP / non-DRP) and the out lists.
// The sheet can be touched up in place, then printed on plain white paper.
const Meeting = (() => {
  const RUNNER_ROLES = ["office", "manager", "admin", "owner"];
  const state = { date: "", notes: null, published: null, topics: [], mine: [], error: "", dropped: new Set() };
  const e = (v) => escapeHtml(v == null ? "" : String(v));
  const panel = () => document.getElementById("meeting");
  const canRun = () => RUNNER_ROLES.includes(String(currentUser?.role || "").toLowerCase());
  const money = (n) => `$${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const longDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "2-digit", day: "2-digit", year: "2-digit" });
  const dayName = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  const issues = (n) => (n ? ` – ${n} parts issue${n === 1 ? "" : "s"}` : "");

  async function load() {
    state.error = "";
    if (!state.date) state.date = today();
    try {
      state.mine = await apiRequest("/meeting/topics/mine");
      if (canRun()) {
        [state.topics, state.notes, state.published] = await Promise.all([
          apiRequest("/meeting/topics"),
          apiRequest(`/meeting/notes?date=${state.date}`),
          apiRequest(`/meeting/published?date=${state.date}`),
        ]);
      }
    } catch (err) { state.error = err.message; }
    render();
  }

  // ------------------------------------------------------------ Sheet
  // Each line has a key so the ✕ can leave it off this printout.
  function line(key, html, amount) {
    if (state.dropped.has(key)) return "";
    return `<li data-line="${e(key)}"${amount != null ? ` data-amount="${Number(amount) || 0}"` : ""}><span class="ms-text">${html}</span><button type="button" class="ms-drop no-print" title="Leave off this printout" onclick="Meeting.drop('${e(key)}')">✕</button></li>`;
  }
  const list = (items) => (items.filter(Boolean).length ? `<ul>${items.join("")}</ul>` : `<p class="ms-none">None</p>`);
  const carLine = (section, c, extra, amount) => line(`${section}:${c.id}`, `<b>${e(c.ro)}</b> – ${extra}`, amount);

  function sheet(n) {
    const tk = n.housekeeping.map((t) => line(`topic:${t.id}`, `${e(t.text)} – <i>${t.anonymous ? "Anonymous" : e(t.by)}</i>`));
    const away = [...n.absences.now, ...n.absences.upcoming];
    const out = (section) => (c) => carLine(section, c, `${e(c.vehicle)} – ${money(c.amount)}${issues(c.partsIssues)}`, c.amount);
    const pastDue = (section) => (c) => carLine(section, c, `in ${e(c.stage)}${c.insurance ? ` – ${e(c.insurance)}` : ""} – ${e(c.vehicle)} – due ${e(c.target.slice(5).replace("-", "/"))}${issues(c.partsIssues)}`);
    const outTotal = (section, o) => o.cars.filter((c) => !state.dropped.has(`${section}:${c.id}`)).reduce((s, c) => s + Number(c.amount || 0), 0);
    return `<article class="meeting-sheet" id="meetingSheet" contenteditable="true" spellcheck="true">
      <header><h1>Morning Meeting</h1><p>Date: ${e(longDate(n.date))}</p></header>
      <section><h2>House Keeping</h2>
        ${list(tk)}
        <h3>Time off</h3>${list(away.map((a, i) => line(`away:${i}:${a.text}`, e(a.text))))}
        <h3>Meetings &amp; training</h3>${list(n.meetings.map((m) => line(`mtg:${m.id}`, `${e(m.time)} – ${e(m.title)}${m.location ? ` (${e(m.location)})` : ""}`)))}
      </section>
      <section><h2>Teardowns</h2>${list(n.teardowns.map((c) => carLine("tear", c, `${e(c.vehicle)}${c.stage === "Tear Down" ? " – in Tear Down" : ""}${issues(c.partsIssues)}`)))}</section>
      <section><h2>DRP vehicles past due</h2>${list(n.drpPastDue.map(pastDue("drp")))}</section>
      <section><h2>Non-DRP past due</h2>${list(n.nonDrpPastDue.map(pastDue("nondrp")))}</section>
      <section><h2>Out List – today</h2>${list(n.outToday.cars.map(out("today")))}${n.outToday.cars.length ? `<p class="ms-total">Total – ${money(outTotal("today", n.outToday))}</p>` : ""}</section>
      <section><h2>Out List – ${e(dayName(n.nextDay))}</h2>${list(n.outNext.cars.map(out("next")))}${n.outNext.cars.length ? `<p class="ms-total">Total – ${money(outTotal("next", n.outNext))}</p>` : ""}</section>
    </article>`;
  }

  // ------------------------------------------------------------ Page
  function topicForm() {
    const status = (t) => t.status === "covered" ? `Covered ${t.coveredOn ? t.coveredOn.slice(5).replace("-", "/") : ""}` : t.status === "hidden" ? "Not used" : "Waiting for the next meeting";
    return `<div class="card meeting-add">
      <h3>Add a topic for the morning meeting</h3>
      <p class="muted">Anything the shop should hear about. It goes on the next meeting's sheet with your name, or as "Anonymous" if you tick the box. Managers read it first and can always see who sent it.</p>
      <form onsubmit="Meeting.add(event)">
        <textarea id="meetingTopicText" maxlength="500" rows="2" placeholder="e.g. Roll all windows up when parking a car" required></textarea>
        <label class="check-label"><input type="checkbox" id="meetingTopicAnon"> Post anonymously</label>
        <button type="submit">Add topic</button>
      </form>
      ${state.mine.length ? `<details class="meeting-mine"><summary>Your topics (${state.mine.length})</summary><ul>${state.mine.map((t) => `<li>${e(t.text)} <small>${e(status(t))}${t.anonymous ? " · anonymous" : ""}</small></li>`).join("")}</ul></details>` : ""}
    </div>`;
  }

  function topicReview() {
    const open = state.topics.filter((t) => t.status === "open");
    const removed = state.topics.filter((t) => t.status === "hidden");
    return `<div class="card meeting-topics">
      <h3>Topics to proofread <span class="pill">${open.length}</span></h3>
      ${open.length ? `<ul class="meeting-topic-list">${open.map((t) => `<li><div><b>${e(t.text)}</b><small>${e(t.by)}${t.anonymous ? ` <span class="pill">prints as Anonymous</span>` : ""} · ${e(new Date(t.createdAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }))}${t.editedBy ? ` · edited by ${e(t.editedBy)}` : ""}</small></div>
        <div class="actions"><button type="button" class="quiet" onclick="Meeting.edit('${e(t.id)}')">Edit</button><button type="button" class="danger" onclick="Meeting.setStatus('${e(t.id)}','hidden')">Remove</button></div></li>`).join("")}</ul>` : `<p class="muted">No topics waiting.</p>`}
      ${removed.length ? `<details><summary>Removed (${removed.length})</summary><ul class="meeting-topic-list">${removed.map((t) => `<li><div>${e(t.text)}<small>${e(t.by)}</small></div><div class="actions"><button type="button" class="quiet" onclick="Meeting.setStatus('${e(t.id)}','open')">Put back</button></div></li>`).join("")}</ul></details>` : ""}
    </div>`;
  }

  function render() {
    const p = panel();
    if (!p) return;
    const head = `<div class="section-head heading-row"><div><div class="eyebrow">EVERY MORNING</div><h2>Morning Meeting</h2>
      <p>${canRun() ? "One sheet with the staff topics, time off, meetings, teardowns, past-due cycle times and the out lists. Proofread it, click into any line to touch it up, then print." : "Add anything the shop should hear about at the morning meeting."}</p></div>
      ${canRun() ? `<div class="actions meeting-actions"><input type="date" id="meetingDate" value="${e(state.date)}" onchange="Meeting.setDate(this.value)"><button type="button" class="quiet" onclick="Meeting.refresh()">Rebuild</button><button type="button" onclick="Meeting.print()">🖨 Print meeting notes</button><button type="button" class="quiet" onclick="Meeting.publish()">📣 Publish to staff app</button></div>` : ""}</div>
      ${canRun() ? publishedNote() : ""}`;
    if (state.error) { p.innerHTML = `${head}<div class="workspace-error">${e(state.error)}</div>`; return; }
    if (!canRun()) { p.innerHTML = head + topicForm(); return; }
    p.innerHTML = `${head}<div class="meeting-layout"><div>${state.notes ? sheet(state.notes) : `<p class="muted">Loading…</p>`}</div><aside>${topicReview()}${topicForm()}</aside></div>`;
  }

  function publishedNote() {
    const p = state.published;
    if (!p) return `<p class="meeting-published muted">Not in the employee app yet. Staff only see the notes after you click <b>Publish to staff app</b> (dollar amounts are left out).</p>`;
    const at = new Date(p.publishedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `<p class="meeting-published">✅ Published to the employee app by ${e(p.publishedBy)} at ${e(at)}. Changed something? Publish again to update it. <button type="button" class="link-button" onclick="Meeting.unpublish()">Take it down</button></p>`;
  }

  // The sheet as it is on screen (hand edits and ✕ removals included), as titled sections
  // of plain lines. Totals stay off; the server also strips dollar amounts.
  function sheetSections() {
    const out = [];
    let cur = null;
    for (const sec of document.querySelectorAll("#meetingSheet section")) {
      for (const el of sec.children) {
        if (el.tagName === "H2" || el.tagName === "H3") { cur = { title: el.textContent.trim(), level: el.tagName === "H3" ? 3 : 2, lines: [] }; out.push(cur); }
        else if (el.tagName === "UL" && cur) {
          for (const li of el.querySelectorAll("li")) {
            const c = li.cloneNode(true);
            c.querySelectorAll(".no-print").forEach((b) => b.remove());
            const t = c.textContent.replace(/\s+/g, " ").trim();
            if (t) cur.lines.push(t);
          }
        }
      }
    }
    return out;
  }

  async function publish() {
    if (!document.getElementById("meetingSheet")) return;
    try {
      state.published = await apiRequest("/meeting/publish", { method: "POST", body: JSON.stringify({ date: state.date, sections: sheetSections() }) });
      showStatus("Published to the employee app.");
      panel().querySelector(".meeting-published")?.replaceWith(document.createRange().createContextualFragment(publishedNote()));
    } catch (err) { showStatus(err.message, true); }
  }

  async function unpublish() {
    try {
      await apiRequest(`/meeting/publish/${state.date}`, { method: "DELETE" });
      state.published = null;
      showStatus("Taken off the employee app.");
      panel().querySelector(".meeting-published")?.replaceWith(document.createRange().createContextualFragment(publishedNote()));
    } catch (err) { showStatus(err.message, true); }
  }

  // ------------------------------------------------------------ Actions
  async function add(ev) {
    ev.preventDefault();
    const box = document.getElementById("meetingTopicText");
    const anon = document.getElementById("meetingTopicAnon");
    const text = box.value.trim();
    if (!text) return;
    try {
      await apiRequest("/meeting/topics", { method: "POST", body: JSON.stringify({ text, anonymous: anon.checked }) });
      box.value = "";
      anon.checked = false;
      showStatus("Topic added for the morning meeting.");
      await load();
    } catch (err) { showStatus(err.message, true); }
  }

  function edit(id) {
    const t = state.topics.find((x) => x.id === id);
    if (!t) return;
    openDialog("Edit topic", `<label>Topic (from ${e(t.by)})<textarea name="text" rows="3" maxlength="500" required>${e(t.text)}</textarea></label>
      <label class="check-label"><input type="checkbox" name="anonymous" ${t.anonymous ? "checked" : ""}> Print as Anonymous</label>`, async (form) => {
      await apiRequest(`/meeting/topics/${id}`, { method: "PUT", body: JSON.stringify({ text: form.get("text"), anonymous: form.get("anonymous") === "on" }) });
      await load();
    });
  }

  async function setStatus(id, status) {
    try {
      await apiRequest(`/meeting/topics/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
      await load();
    } catch (err) { showStatus(err.message, true); }
  }

  function drop(key) {
    // Keep any hand edits elsewhere on the sheet: just remove the line.
    state.dropped.add(key);
    const li = document.querySelector(`#meetingSheet li[data-line="${CSS.escape(key)}"]`);
    const section = li?.closest("section");
    li?.remove();
    const total = section?.querySelector(".ms-total");
    if (total) total.textContent = `Total – ${money([...section.querySelectorAll("li[data-amount]")].reduce((s, x) => s + Number(x.dataset.amount), 0))}`;
  }

  function setDate(d) { if (d) { state.date = d; state.dropped.clear(); load(); } }
  function refresh() { state.dropped.clear(); load(); }

  // Prints the sheet as it is on screen (with any hand edits) in its own window, on white
  // paper whatever the theme. The topics on it are then marked covered so they don't come
  // back tomorrow; printing again the same day still includes them.
  async function print() {
    const el = document.getElementById("meetingSheet");
    if (!el) return;
    const copy = el.cloneNode(true);
    copy.removeAttribute("contenteditable");
    copy.querySelectorAll(".no-print").forEach((b) => b.remove());
    const win = window.open("", "_blank", "width=850,height=1000");
    if (!win) return showStatus("Allow pop-ups for ShopControl to print the meeting notes.", true);
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Morning Meeting ${e(state.date)}</title><style>${PRINT_CSS}</style></head><body>${copy.outerHTML}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
    const ids = [...el.querySelectorAll('li[data-line^="topic:"]')].map((li) => li.dataset.line.slice(6));
    if (!ids.length) return;
    try {
      const { covered } = await apiRequest("/meeting/covered", { method: "POST", body: JSON.stringify({ date: state.date, topicIds: ids }) });
      if (covered) showStatus(`${covered} topic${covered === 1 ? "" : "s"} marked covered.`);
      [state.topics, state.mine] = await Promise.all([apiRequest("/meeting/topics"), apiRequest("/meeting/topics/mine")]);
      const aside = panel()?.querySelector(".meeting-layout > aside");
      if (aside) aside.innerHTML = topicReview() + topicForm();
    } catch (err) { showStatus(err.message, true); }
  }

  const PRINT_CSS = `
    @page { margin: 0.6in; }
    body { font: 13pt/1.4 Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; }
    .meeting-sheet header { border-bottom: 2px solid #000; margin-bottom: 10px; padding-bottom: 6px; }
    h1 { font-size: 20pt; margin: 0; } header p { margin: 4px 0 0; font-size: 14pt; font-weight: bold; }
    h2 { font-size: 14pt; margin: 14px 0 4px; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid #999; }
    h3 { font-size: 12pt; margin: 8px 0 2px; }
    ul { margin: 2px 0 6px; padding-left: 22px; } li { margin: 2px 0; }
    section { break-inside: avoid; } .ms-none { color: #555; margin: 2px 0 6px; font-style: italic; }
    .ms-total { font-weight: bold; margin: 4px 0 0 22px; }`;

  function start() {
    const btn = document.querySelector('.tab[data-tab="meeting"]');
    if (btn) btn.addEventListener("click", () => { state.dropped.clear(); load(); });
  }

  return { start, load, add, edit, setStatus, drop, setDate, refresh, print, publish, unpublish };
})();
