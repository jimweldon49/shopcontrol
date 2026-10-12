// Tech Board (desktop): drag a car from the main board onto TODAY, choose the departments
// and techs who work on it today ("Any Tech" = everyone in that department), and it shows
// up on their phones in order. A department stays on the board until its QC checklist for
// the car is fully checked and signed. API: /api/tech-board (server/src/routes/techBoard.js).
const TechBoard = (() => {
  const state = { jobs: [], techs: {}, today: "", canEdit: false, loaded: false, error: "", timer: null, dragFrom: null };
  const e = (v) => escapeHtml(v == null ? "" : String(v));
  const DEPTS = QcChecklists.departments;
  const anyLabel = (d) => (d === "Paint" ? "Any Painter" : "Any Tech");
  const deptColor = (d) => (QcChecklists.byId[d] || {}).color || "#94a3b8";
  const panel = () => document.getElementById("techBoard");
  const active = () => { const p = panel(); return p && p.classList.contains("active"); };

  async function load() {
    try {
      const data = await apiRequest("/tech-board");
      Object.assign(state, { jobs: data.jobs, techs: data.techs, today: data.today, canEdit: data.canEdit, loaded: true, error: "" });
    } catch (err) { state.error = err.message; }
    render();
  }

  // Order a department's cars the way the techs' phones do: hot, carried over, then the board order.
  const byListOrder = (a, b) => (b.hot - a.hot) || (b.carriedOver - a.carriedOver) || (a.position - b.position);

  function deptChip(d) {
    const who = [...(d.anyTech ? [anyLabel(d.department)] : []), ...d.users.map((u) => u.name)].join(", ");
    const status = d.done ? "QC signed ✓" : `${d.progress.done}/${d.progress.total} checked`;
    return `<span class="tb-chip ${d.done ? "done" : ""}" style="--c:${deptColor(d.department)}"><b>${e(d.department)}</b> ${e(who)} <small>${e(status)}</small></span>`;
  }

  function vehicleName(v) { return String(v || "Vehicle").split(" / ")[0]; }

  function todayRow(j, i) {
    return `<div class="tb-row ${j.done ? "done" : ""} ${j.hot ? "hot" : ""}" draggable="${state.canEdit}" data-board-job="${e(j.jobId)}">
      <span class="tb-pos">${i + 1}</span>
      <div class="tb-car"><b>RO ${e(j.roNumber)}</b> · ${e(vehicleName(j.vehicle))}<small>${e(j.customerName || "")} · ${e(j.stage || "")}${j.carriedOver ? ` · <span class="tb-carried">Rolled over · ${j.daysOver} day${j.daysOver === 1 ? "" : "s"} (since ${e(j.addedOn)})</span>` : ""}${j.done ? " · <b>All done</b>" : ""}</small>
        <div class="tb-chips">${j.departments.map(deptChip).join("")}</div></div>
      ${state.canEdit ? `<div class="actions">
        <button type="button" class="${j.hot ? "danger" : "quiet"}" onclick="TechBoard.toggleHot('${e(j.jobId)}')">${j.hot ? "🔥 Hot" : "Make hot"}</button>
        <button type="button" class="quiet" onclick="TechBoard.assign('${e(j.jobId)}')">Edit</button>
        <button type="button" class="quiet" onclick="TechBoard.remove('${e(j.jobId)}')">Remove</button></div>` : j.hot ? '<span class="tb-hot">🔥 Hot</span>' : ""}
    </div>`;
  }

  // One column per department: the "board on display" for the day.
  function deptColumns() {
    const cols = DEPTS.map((d) => {
      const cars = state.jobs.filter((j) => j.departments.some((x) => x.department === d.id)).sort(byListOrder);
      if (!cars.length) return "";
      return `<section class="tb-col" style="--c:${d.color}"><header><h3>${e(d.id)}</h3><span>${cars.filter((j) => !j.departments.find((x) => x.department === d.id).done).length} open</span></header>
        ${cars.map((j) => {
          const x = j.departments.find((y) => y.department === d.id);
          const who = [...(x.anyTech ? [anyLabel(d.id)] : []), ...x.users.map((u) => u.name)].join(", ");
          return `<div class="tb-card ${x.done ? "done" : ""} ${j.hot ? "hot" : ""}"><div class="tb-card-top"><b>RO ${e(j.roNumber)}</b>${j.hot ? '<span class="tb-hot">🔥 Hot</span>' : ""}</div>${j.carriedOver ? `<small class="tb-carried">Rolled over · ${j.daysOver} day${j.daysOver === 1 ? "" : "s"}</small>` : ""}
            <div>${e(vehicleName(j.vehicle))}</div><small>${e(who)}</small>
            <div class="tb-bar"><i style="width:${Math.round((x.progress.done / (x.progress.total || 1)) * 100)}%"></i></div>
            <small>${x.done ? `QC signed by ${e(x.signedBy.join(", "))} ✓` : `${x.progress.done}/${x.progress.total} checked`}</small></div>`;
        }).join("")}</section>`;
    }).join("");
    return cols || '<p class="empty">Nothing is on TODAY yet.</p>';
  }

  // The main board's onsite cars by stage, to drag from.
  function mainBoard() {
    const onBoard = new Set(state.jobs.filter((j) => !j.done).map((j) => j.jobId));
    const jobs = store.get("daily").filter(ShopModel.isOnsite);
    return ShopModel.production.map((stage) => {
      const cars = jobs.filter((j) => j.currentStage === stage);
      if (!cars.length) return "";
      return `<section class="tb-stage"><h4>${e(stage)} <span>${cars.length}</span></h4>${cars.map((j) => {
        const color = /^#[0-9a-f]{6}$/i.test(j.cardColor || "") ? j.cardColor : "#cfedf2";
        return `<div class="tb-main-card" draggable="${state.canEdit}" data-main-job="${e(j.id)}" style="background:${color}">
          <b>RO ${e(j.roNumber)}</b>${onBoard.has(j.id) ? '<span class="tb-on">On TODAY</span>' : ""}<div>${e(vehicleName(j.vehicle))}</div><small>${e(j.customerName || "")}</small></div>`;
      }).join("")}</section>`;
    }).join("") || '<p class="empty">No onsite vehicles.</p>';
  }

  function render() {
    const p = panel();
    if (!p) return;
    const open = state.jobs.filter((j) => !j.done).length;
    p.innerHTML = `<div class="section-head heading-row"><div><div class="eyebrow">TECHS</div><h2>Tech Board</h2>
        <p>${state.canEdit ? "Drag a car from the board below onto <b>TODAY</b> and choose who works on it. Each tech's phone lists their cars in this order: hot cars first, then cars rolled over from earlier days. Anything not finished rolls over to the next day by itself and stays on the list until that department's QC is fully checked and signed. At 5:00 PM on weekdays, unfinished hot cars are emailed to their techs and the office." : "Today's work for each department."}</p></div>
        <div class="actions"><button type="button" class="quiet" onclick="TechBoard.load()">Refresh</button><button type="button" onclick="TechBoard.tv()">Show on TV</button></div></div>
      ${state.error ? `<p class="workspace-error">${e(state.error)}</p>` : ""}
      <div class="tb-today" id="tbToday"><div class="heading-row"><h3>TODAY · ${e(state.today)}</h3><small>${open} car${open === 1 ? "" : "s"} in progress${state.canEdit ? " · drag rows to change the order" : ""}</small></div>
        ${state.jobs.length ? state.jobs.map(todayRow).join("") : `<p class="tb-drop-hint">${state.canEdit ? "Drop a car here" : "Nothing is on TODAY yet."}</p>`}</div>
      <h3 class="tb-heading">By department</h3><div class="tb-cols">${deptColumns()}</div>
      <h3 class="tb-heading">Production Board</h3><div class="tb-main">${mainBoard()}</div>`;
    bindDrag();
  }

  function bindDrag() {
    if (!state.canEdit) return;
    const today = document.getElementById("tbToday");
    panel().querySelectorAll("[data-main-job]").forEach((card) => {
      card.ondragstart = (ev) => { state.dragFrom = { kind: "main", id: card.dataset.mainJob }; ev.dataTransfer.setData("text/plain", card.dataset.mainJob); ev.dataTransfer.effectAllowed = "copy"; };
    });
    panel().querySelectorAll("[data-board-job]").forEach((row) => {
      row.ondragstart = (ev) => { state.dragFrom = { kind: "row", id: row.dataset.boardJob }; ev.dataTransfer.setData("text/plain", row.dataset.boardJob); ev.dataTransfer.effectAllowed = "move"; };
    });
    today.ondragover = (ev) => { if (!state.dragFrom) return; ev.preventDefault(); today.classList.add("drag-over"); };
    today.ondragleave = (ev) => { if (!today.contains(ev.relatedTarget)) today.classList.remove("drag-over"); };
    today.ondrop = (ev) => {
      ev.preventDefault();
      today.classList.remove("drag-over");
      const from = state.dragFrom;
      state.dragFrom = null;
      if (!from) return;
      if (from.kind === "main") return assign(from.id, { x: ev.clientX, y: ev.clientY });
      reorder(from.id, ev.target.closest("[data-board-job]"), ev.clientY);
    };
    panel().querySelectorAll("[data-main-job]").forEach((card) => { card.onclick = () => assign(card.dataset.mainJob); });
  }

  // The card springs back from where it was dropped to its place on the board.
  function snapBack(jobId, from) {
    const card = panel() && panel().querySelector(`[data-main-job="${CSS.escape(jobId)}"]`);
    if (!card || !from) return;
    const r = card.getBoundingClientRect();
    card.style.transition = "none";
    card.style.transform = `translate(${from.x - (r.left + r.width / 2)}px, ${from.y - (r.top + r.height / 2)}px) scale(.9)`;
    card.getBoundingClientRect();
    card.style.transition = "transform .7s cubic-bezier(.34,1.56,.64,1)";
    card.style.transform = "";
    card.addEventListener("transitionend", () => { card.style.transition = ""; }, { once: true });
  }

  async function reorder(movedId, targetRow, y) {
    const ids = state.jobs.map((j) => j.jobId).filter((id) => id !== movedId);
    let at = ids.length;
    if (targetRow && targetRow.dataset.boardJob !== movedId) {
      const r = targetRow.getBoundingClientRect();
      at = ids.indexOf(targetRow.dataset.boardJob) + (y > r.top + r.height / 2 ? 1 : 0);
    }
    ids.splice(at, 0, movedId);
    state.jobs.sort((a, b) => ids.indexOf(a.jobId) - ids.indexOf(b.jobId)).forEach((j, i) => (j.position = i + 1));
    render();
    try { await apiRequest("/tech-board/order", { method: "PUT", body: JSON.stringify({ jobIds: ids }) }); }
    catch (err) { showStatus(err.message, true); }
    load();
  }

  // Which departments and techs work on this car today.
  function assign(jobId, droppedAt) {
    const job = store.get("daily").find((j) => j.id === jobId);
    const current = state.jobs.find((j) => j.jobId === jobId);
    const title = job ? `RO ${job.roNumber} · ${vehicleName(job.vehicle)}` : current ? `RO ${current.roNumber}` : "Tech Board";
    const sections = DEPTS.map((d) => {
      const cur = current && current.departments.find((x) => x.department === d.id);
      const picked = new Set(cur ? cur.users.map((u) => u.id) : []);
      const techs = state.techs[d.id] || [];
      return `<fieldset class="tb-dept" style="--c:${d.color}"><legend>${e(d.id)}${cur && cur.done ? " <small>(QC signed: choosing it again starts it over)</small>" : ""}</legend>
        <label class="check-label tb-any"><input type="checkbox" name="any:${e(d.id)}" ${cur && cur.anyTech && !cur.done ? "checked" : ""}>${anyLabel(d.id)} <small>everyone in ${e(d.id)}</small></label>
        ${techs.map((t) => `<label class="check-label"><input type="checkbox" name="user:${e(d.id)}" value="${e(t.id)}" ${picked.has(t.id) && !cur.done ? "checked" : ""}>${e(t.name)}</label>`).join("") || `<small class="muted">No employees have ${e(d.id)} as their QC department.</small>`}
      </fieldset>`;
    }).join("");
    const dialog = openDialog(`Today: ${title}`, `<p class="board-tip">Who needs to complete their work on this car today? It goes to the top of their list on their phones and stays there until their department's QC is fully checked and signed.</p>${sections}`,
      async (form) => {
        const departments = DEPTS.map((d) => ({ department: d.id, anyTech: form.get(`any:${d.id}`) === "on", userIds: form.getAll(`user:${d.id}`) }))
          .filter((x) => x.anyTech || x.userIds.length);
        if (!departments.length && !current) throw Error("Check at least one department or tech.");
        await apiRequest(`/tech-board/jobs/${jobId}`, { method: "PUT", body: JSON.stringify({ departments }) });
        showStatus(departments.length ? `RO ${job ? job.roNumber : ""} is on today's Tech Board.` : "Taken off the Tech Board.");
        await load();
      });
    dialog.querySelector("[type=submit]").textContent = "Save";
    dialog.addEventListener("close", () => snapBack(jobId, droppedAt));
  }

  async function toggleHot(jobId) {
    const j = state.jobs.find((x) => x.jobId === jobId);
    if (!j) return;
    try { await apiRequest(`/tech-board/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify({ hot: !j.hot }) }); await load(); }
    catch (err) { showStatus(err.message, true); }
  }

  function remove(jobId) {
    const j = state.jobs.find((x) => x.jobId === jobId);
    if (!j) return;
    const dialog = openDialog(`Take RO ${j.roNumber} off the Tech Board?`, `<p>It comes off every tech's list. QC checklists aren't changed.</p>`, async () => {
      await apiRequest(`/tech-board/jobs/${jobId}`, { method: "PUT", body: JSON.stringify({ departments: [] }) });
      await load();
    });
    dialog.querySelector("[type=submit]").textContent = "Take it off";
  }

  // Full screen department columns for the shop TV; refreshes with the board.
  function tv() {
    const p = panel();
    p.classList.add("tb-tv");
    const exit = () => { p.classList.remove("tb-tv"); document.removeEventListener("fullscreenchange", onChange); };
    const onChange = () => { if (!document.fullscreenElement) exit(); };
    if (p.requestFullscreen) p.requestFullscreen().then(() => document.addEventListener("fullscreenchange", onChange)).catch(exit);
    else exit();
  }

  function start() {
    const btn = document.querySelector('.tab[data-tab="techBoard"]');
    if (btn) btn.addEventListener("click", load);
    document.addEventListener("dragend", () => { state.dragFrom = null; });
    clearInterval(state.timer);
    state.timer = setInterval(() => { if (active()) load(); }, 30000);
  }

  return { start, load, render, assign, toggleHot, remove, tv };
})();
