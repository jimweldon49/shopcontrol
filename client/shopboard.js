// Shop board: the interactive touch screen in the shop. It shows the Production Board
// like the TV display, and a technician moves a car by tapping it, tapping the new
// stage and tapping their name. Active when signed in with a "shopboard" account (or
// with ?shopboard=1 in the address). API: /api/shopBoard (server/src/routes/shopBoard.js).
const ShopBoard = (() => {
  // Where a car usually goes next, suggested as the big button. Any stage can be picked.
  const NEXT = {
    "Check-In": "Tear Down", "Tear Down": "Repair Plan", "Repair Plan": "Body", "Waiting Approval": "Body",
    "Waiting on Supplement": "Body", "Waiting on Parts": "Body", "Body": "Prep", "Prep": "Paint", "Paint": "Assembly",
    "Assembly": "Detail", "Sublet": "Detail", "Detail": "QC", "QC": "Ready for Delivery",
  };
  const IDLE_CLOSE_MS = 60000;     // close the move screen if nobody touches it for a minute
  const SCROLL_PAUSE_MS = 90000;   // hold the board still while people are using it
  const UNDO_MS = 15000;

  let people = [];
  let peopleLoadedAt = 0;
  let move = null;        // { job, stage }
  let idleTimer = null;
  let undoTimer = null;
  const e = (v) => escapeHtml(v);

  const active = () => String((currentUser && currentUser.role) || "").toLowerCase() === "shopboard"
    || new URLSearchParams(location.search).has("shopboard");

  async function loadPeople() {
    if (Date.now() - peopleLoadedAt < 10 * 60 * 1000 && people.length) return;
    try {
      people = await apiRequest("/shopBoard/people");
      peopleLoadedAt = Date.now();
    } catch (err) { console.warn("Shop board people:", err.message); }
  }

  function pauseScroll() { window.kioskPausedUntil = Date.now() + SCROLL_PAUSE_MS; }

  function sheet() {
    let el = document.getElementById("shopBoardSheet");
    if (!el) {
      el = document.createElement("div");
      el.id = "shopBoardSheet";
      el.className = "sb-backdrop";
      el.addEventListener("click", onClick);
      document.body.append(el);
    }
    return el;
  }

  function close() {
    clearTimeout(idleTimer);
    move = null;
    const el = document.getElementById("shopBoardSheet");
    if (el) el.remove();
  }

  function touch() {
    pauseScroll();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(close, IDLE_CLOSE_MS);
  }

  function open(id) {
    const job = store.get("daily").find((j) => j.id === id);
    if (!job) return;
    move = { job, stage: null };
    loadPeople().then(() => { if (move && move.stage) render(); });
    render();
  }

  function carHeader(j) {
    const pic = ShopModel.vehicleImage(j);
    return `<div class="sb-car">${pic ? `<img src="${e(pic.src)}" alt="">` : ""}<div>
      <div class="sb-ro">RO #${e(j.roNumber || "")}</div><h2>${e(j.customerName || "")}</h2><p>${e(String(j.vehicle || "").split(" / ")[0])}</p>
      <span class="sb-now">Now in <b>${e(j.currentStage || "—")}</b></span></div></div>`;
  }

  function render() {
    if (!move) return;
    touch();
    const j = move.job;
    const el = sheet();
    if (!move.stage) {
      const next = NEXT[j.currentStage];
      el.innerHTML = `<div class="sb-panel" role="dialog" aria-label="Move RO ${e(j.roNumber || "")}">
        ${carHeader(j)}
        ${next ? `<button class="sb-next" data-stage="${e(next)}">Move to <b>${e(next)}</b> <span>→</span></button>` : ""}
        <div class="sb-label">${next ? "Or pick another stage" : "Move to which stage?"}</div>
        <div class="sb-stages">${ShopModel.production.map((s) => `<button data-stage="${e(s)}" ${s === j.currentStage ? "disabled" : ""}>${e(s)}</button>`).join("")}</div>
        <button class="sb-cancel" data-cancel>Cancel</button></div>`;
    } else {
      const onCar = new Set([...(j.bodyTechs || []), ...(j.painters || []), ...(j.supportTechs || [])]);
      const mine = people.filter((p) => onCar.has(p.full_name));
      const rest = people.filter((p) => !onCar.has(p.full_name));
      const btn = (p) => `<button data-person="${e(p.id)}">${e(p.full_name)}</button>`;
      el.innerHTML = `<div class="sb-panel" role="dialog" aria-label="Who is moving RO ${e(j.roNumber || "")}">
        ${carHeader(j)}
        <div class="sb-moving">${e(j.currentStage || "—")} <span>→</span> <b>${e(move.stage)}</b> <button class="sb-link" data-restage>Change</button></div>
        <div class="sb-label">Who's moving it? Tap your name</div>
        ${mine.length ? `<div class="sb-people sb-people-mine">${mine.map(btn).join("")}</div>` : ""}
        <div class="sb-people">${rest.map(btn).join("") || `<p class="sb-empty">${people.length ? "" : "Loading names…"}</p>`}</div>
        <button class="sb-cancel" data-cancel>Cancel</button></div>`;
    }
  }

  async function doMove(job, stage, personId, isUndo) {
    const res = await apiRequest("/shopBoard/move", {
      method: "POST",
      body: JSON.stringify({ job_id: job.id, stage, moved_by: personId, expected_version: isUndo ? undefined : job.version }),
    });
    await loadAll(true);
    return res;
  }

  async function onClick(ev) {
    touch();
    if (ev.target === ev.currentTarget || ev.target.closest("[data-cancel]")) return close();
    if (!move) return;
    if (ev.target.closest("[data-restage]")) { move.stage = null; return render(); }
    const stageBtn = ev.target.closest("[data-stage]");
    if (stageBtn) { move.stage = stageBtn.dataset.stage; return render(); }
    const personBtn = ev.target.closest("[data-person]");
    if (!personBtn) return;
    const { job, stage } = move;
    const person = people.find((p) => p.id === personBtn.dataset.person);
    const from = job.currentStage;
    document.querySelectorAll("#shopBoardSheet button").forEach((b) => { b.disabled = true; });
    personBtn.classList.add("sb-busy");
    try {
      await doMove(job, stage, person.id);
      close();
      showDone(job, from, stage, person);
    } catch (err) {
      close();
      await loadAll(true).catch(() => {});
      banner(err.message, true);
    }
  }

  // Confirmation with an Undo button for a few seconds.
  function showDone(job, from, stage, person) {
    banner(`RO #${job.roNumber} moved to ${stage} by ${person.full_name}`, false, async () => {
      try {
        const fresh = store.get("daily").find((j) => j.id === job.id) || job;
        await doMove(fresh, from, person.id, true);
        banner(`RO #${job.roNumber} is back in ${from}`);
      } catch (err) { banner(err.message, true); }
    });
  }

  function banner(text, isError, undo) {
    document.getElementById("shopBoardToast")?.remove();
    clearTimeout(undoTimer);
    const el = document.createElement("div");
    el.id = "shopBoardToast";
    el.className = `sb-toast${isError ? " sb-toast-error" : ""}`;
    el.innerHTML = `<span>${e(text)}</span>${undo ? `<button>Undo</button>` : ""}`;
    if (undo) el.querySelector("button").onclick = () => { el.remove(); undo(); };
    document.body.append(el);
    undoTimer = setTimeout(() => el.remove(), undo ? UNDO_MS : 6000);
  }

  function start() {
    if (!active()) return;
    document.body.classList.add("shopboard-mode");
    loadPeople();
    if (!document.getElementById("shopBoardHint")) {
      const hint = document.createElement("div");
      hint.id = "shopBoardHint";
      hint.className = "sb-hint";
      hint.textContent = "Tap a car to move it to its next stage";
      document.body.append(hint);
    }
    document.addEventListener("pointerdown", pauseScroll, { passive: true });
  }

  function stop() {
    close();
    document.body.classList.remove("shopboard-mode");
    document.getElementById("shopBoardHint")?.remove();
    document.removeEventListener("pointerdown", pauseScroll);
  }

  return { active, open, start, stop, NEXT };
})();
