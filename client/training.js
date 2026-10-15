// Training (desktop, office staff and managers): each person's courses for the year, with
// due dates. Scheduling one puts a Training appointment on the calendar. Status follows the
// server's pace rules (server/src/routes/training.js): behind = fewer done than an even pace
// through the year; overdue = a course past its own due date. API: /api/training.
const Training = (() => {
  const MANAGE_ROLES = ["office", "manager", "admin", "owner"];
  const state = { people: [], roster: [], today: "", error: "" };
  const e = (v) => escapeHtml(v == null ? "" : String(v));
  const panel = () => document.getElementById("training");
  const canManage = () => MANAGE_ROLES.includes(String(currentUser?.role || "").toLowerCase());
  const short = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.slice(0, 4) === state.today.slice(0, 4) ? undefined : "numeric" }) : "");
  const clock = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const STATUS = {
    overdue: (p) => ({ label: `${p.overdue} overdue`, cls: "danger" }),
    behind: (p) => ({ label: `Behind by ${p.behindBy}`, cls: "warn" }),
    done: () => ({ label: "All done", cls: "good" }),
    "on track": () => ({ label: "On track", cls: "good" }),
  };

  async function load() {
    try {
      const [data, roster] = await Promise.all([apiRequest("/training"), apiRequest("/users/roster")]);
      Object.assign(state, { people: data.people, today: data.today, roster, error: "" });
    } catch (err) { state.error = err.message; }
    render();
  }

  function courseRow(c) {
    const late = !c.completedOn && c.dueDate < state.today;
    return `<tr class="${c.completedOn ? "tr-done" : ""}">
      <td><b>${e(c.course)}</b>${c.provider ? `<small>${e(c.provider)}</small>` : ""}${c.notes ? `<small>${e(c.notes)}</small>` : ""}</td>
      <td class="${late ? "status-bad" : ""}">${e(short(c.dueDate))}${late ? " · overdue" : ""}</td>
      <td>${c.scheduledDate ? `${e(short(c.scheduledDate))} ${e(clock(c.scheduledTime))}<small>On the calendar</small>` : `<span class="muted">Not scheduled</span>`}</td>
      <td>${c.completedOn ? `<span class="status-good">✓ ${e(short(c.completedOn))}</span>` : ""}</td>
      <td><div class="actions">
        ${c.completedOn ? "" : `<button type="button" onclick="Training.markDone('${e(c.id)}')">Done</button>`}
        <button type="button" class="quiet" onclick="Training.edit('${e(c.id)}')">Edit</button>
        <button type="button" class="danger" onclick="Training.remove('${e(c.id)}')">Remove</button>
      </div></td></tr>`;
  }

  function personCard(p) {
    const s = STATUS[p.status](p);
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    const pace = p.total ? Math.min(100, Math.round((p.expected / p.total) * 100)) : 0;
    return `<div class="card training-person">
      <header><h3>${e(p.name)}</h3><span class="training-pill ${s.cls}">${e(s.label)}</span></header>
      <div class="training-progress" title="${p.done} of ${p.total} done this year; about ${p.expected} by now keeps pace">
        <div class="training-bar"><i style="width:${pct}%"></i><b style="left:${pace}%"></b></div>
        <small>${p.done} of ${p.total} done this year · about ${p.expected} by now keeps pace</small>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Course</th><th>Due</th><th>Scheduled</th><th>Done</th><th></th></tr></thead>
        <tbody>${p.courses.map(courseRow).join("")}</tbody></table></div>
      <button type="button" class="quiet" onclick="Training.add('${e(p.userId)}')">+ Add a course for ${e(p.name.split(" ")[0])}</button>
    </div>`;
  }

  function render() {
    const p = panel();
    if (!p) return;
    const order = { overdue: 0, behind: 1, "on track": 2, done: 3 };
    const people = [...state.people].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
    const counts = people.reduce((c, x) => ({ ...c, [x.status]: (c[x.status] || 0) + 1 }), {});
    p.innerHTML = `<div class="section-head heading-row"><div><div class="eyebrow">STAFF</div><h2>Training</h2>
        <p>Each person's I-CAR and other training for the year. Schedule a course and it goes on the calendar as Training. Anyone behind pace gets a reminder every Monday, and managers get a summary.</p></div>
        <div class="actions"><button type="button" onclick="Training.add()">+ Add training</button></div></div>
      ${state.error ? `<div class="workspace-error">${e(state.error)}</div>` : ""}
      ${people.length ? `<div class="board-summary training-summary">
        <div><small>Overdue</small><b class="${counts.overdue ? "status-bad" : ""}">${counts.overdue || 0}</b></div>
        <div><small>Behind pace</small><b>${counts.behind || 0}</b></div>
        <div><small>On track</small><b>${counts["on track"] || 0}</b></div>
        <div><small>All done</small><b>${counts.done || 0}</b></div></div>` : ""}
      ${people.length ? people.map(personCard).join("") : `<div class="card"><p class="muted">No training added yet. Click <b>Add training</b> to start each person's list for the year.</p></div>`}`;
  }

  const find = (id) => state.people.flatMap((p) => p.courses).find((c) => c.id === id);
  const yearEnd = () => `${state.today.slice(0, 4)}-12-31`;

  function form(c = {}, userIds = []) {
    const people = c.id ? "" : `<fieldset class="staff-picker"><legend>Who needs it</legend>
      ${state.roster.map((u) => `<label class="check-label"><input type="checkbox" name="user_ids" value="${e(u.id)}" ${userIds.includes(u.id) ? "checked" : ""}>${e(u.full_name)}</label>`).join("")}</fieldset>`;
    return `${people}<div class="form-grid">
      ${input("Course", "course", c.course || "", "text", 'required maxlength="200" placeholder="e.g. Steel GMA (MIG) Welding"')}
      ${input("Provider", "provider", c.provider ?? "I-CAR", "text", 'maxlength="60"')}
      ${input("Done by", "due_date", c.dueDate || yearEnd(), "date", "required")}
      ${input("Scheduled date (puts it on the calendar)", "scheduled_date", c.scheduledDate || "", "date")}
      ${input("Start time", "scheduled_time", c.scheduledTime || "08:00", "time")}
      ${input("Length (hours)", "hours", c.duration ? c.duration / 60 : 4, "number", 'min="0.25" max="24" step="0.25"')}
      ${input("Where", "location", c.location || "", "text", 'maxlength="200" placeholder="e.g. Online, I-CAR Modesto"')}
      ${c.id ? input("Completed on", "completed_on", c.completedOn || "", "date") : ""}
    </div><label>Notes<textarea name="notes" rows="2" maxlength="2000">${e(c.notes || "")}</textarea></label>`;
  }

  function body(f) {
    return {
      course: f.get("course"), provider: f.get("provider"), due_date: f.get("due_date"),
      scheduled_date: f.get("scheduled_date") || null, scheduled_time: f.get("scheduled_date") ? f.get("scheduled_time") || "08:00" : null,
      duration: Math.round(Number(f.get("hours") || 4) * 60), location: f.get("location"), notes: f.get("notes"),
      ...(f.has("completed_on") ? { completed_on: f.get("completed_on") || null } : {}),
    };
  }

  function add(userId) {
    openDialog("Add training", form({}, userId ? [userId] : []), async (f) => {
      const ids = f.getAll("user_ids");
      if (!ids.length) throw Error("Pick at least one person.");
      await apiRequest("/training", { method: "POST", body: JSON.stringify({ ...body(f), user_ids: ids }) });
      await load();
    });
  }

  function edit(id) {
    const c = find(id);
    if (!c) return;
    openDialog(`Edit training – ${c.name}`, form(c), async (f) => {
      await apiRequest(`/training/${id}`, { method: "PUT", body: JSON.stringify(body(f)) });
      await load();
    });
  }

  async function markDone(id) {
    try {
      await apiRequest(`/training/${id}`, { method: "PUT", body: JSON.stringify({ completed_on: today() }) });
      await load();
    } catch (err) { showStatus(err.message, true); }
  }

  function remove(id) {
    const c = find(id);
    if (!c) return;
    const dialog = openDialog(`Remove "${c.course}" for ${c.name}?`, `<p>It comes off their list${c.scheduledDate ? " and off the calendar" : ""}.</p>`, async () => {
      await apiRequest(`/training/${id}`, { method: "DELETE" });
      await load();
    });
    dialog.querySelector("[type=submit]").textContent = "Remove";
  }

  function start() {
    const btn = document.getElementById("trainingTabBtn");
    if (!btn) return;
    btn.style.display = canManage() ? "" : "none";
    btn.addEventListener("click", load);
  }

  return { start, load, add, edit, markDone, remove };
})();
