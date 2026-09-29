// Vehicle search in the header: finds any job, whatever its stage (opportunity, in
// production, delivered or total loss), by RO, estimate number, customer, vehicle,
// VIN, plate, color, insurance, estimator or claim number. Active jobs open in the job
// window; finished jobs open their Completed Jobs file. Press "/" or Ctrl+K to jump here.
const VehicleSearch = (() => {
  const FINISHED = ["Delivered", "Total Loss"];
  const MAX_RESULTS = 12;
  let results = [];
  let active = -1;
  const e = (v) => escapeHtml(v);
  const input = () => document.getElementById("globalSearch");
  const box = () => document.getElementById("globalSearchResults");

  function claimOf(j) {
    const m = String(j.endOfDayNotes || "").match(/Claim #:\s*([^.\s][^.]*?)\./);
    return m ? m[1].trim() : "";
  }
  function haystack(j) {
    return [j.roNumber, j.cccEstfileId, j.customerName, j.vehicle, j.vehicleColor, j.insurance, j.estimator, claimOf(j), j.currentStage, j.location]
      .join(" ").toLowerCase();
  }
  const isOpportunity = (j) => !/^\d+$/.test(String(j.roNumber || "").trim());

  function search(q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const exact = q.trim().toLowerCase();
    return store.get("daily")
      .filter((j) => !j.mergedInto)
      .filter((j) => { const h = haystack(j); return terms.every((t) => h.includes(t)); })
      .sort((a, b) => {
        const ea = String(a.roNumber || "").trim().toLowerCase() === exact ? 0 : 1;
        const eb = String(b.roNumber || "").trim().toLowerCase() === exact ? 0 : 1;
        if (ea !== eb) return ea - eb;
        const fa = FINISHED.includes(a.currentStage) ? 1 : 0, fb = FINISHED.includes(b.currentStage) ? 1 : 0;
        if (fa !== fb) return fa - fb;
        return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      });
  }

  function statusOf(j) {
    if (FINISHED.includes(j.currentStage)) {
      const d = j.deliveredAt || j.actualDeliveredDate;
      return { cls: "done", text: `${j.currentStage}${d ? " " + new Date(String(d).length <= 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}` };
    }
    if (isOpportunity(j)) return { cls: "opp", text: `Opportunity · ${j.currentStage || ""}` };
    return { cls: "live", text: `${j.currentStage || ""}${j.onsite ? " · on site" : ""}` };
  }

  function render(q) {
    const el = box();
    if (!el) return;
    if (!q.trim()) { el.hidden = true; el.innerHTML = ""; return; }
    const all = search(q);
    results = all.slice(0, MAX_RESULTS);
    active = results.length ? 0 : -1;
    el.hidden = false;
    el.innerHTML = results.length
      ? results.map((j, i) => {
          const s = statusOf(j);
          return `<button type="button" class="search-hit${i === active ? " active" : ""}" data-i="${i}" onmousedown="event.preventDefault()" onclick="VehicleSearch.open(${i})">
            <span class="search-ro">${e(j.roNumber || "—")}</span>
            <span class="search-main"><b>${e(j.customerName || "")}</b><small>${e(j.vehicle || "")}</small></span>
            <span class="search-stage ${s.cls}">${e(s.text)}</span></button>`;
        }).join("") + (all.length > MAX_RESULTS ? `<div class="search-more">${all.length - MAX_RESULTS} more. Keep typing to narrow it down.</div>` : "")
      : `<div class="search-more">No vehicle matches “${e(q.trim())}”. Deleted jobs are under Completed Jobs → Show deleted jobs.</div>`;
  }

  function highlight() {
    const el = box();
    if (!el) return;
    el.querySelectorAll(".search-hit").forEach((b) => b.classList.toggle("active", Number(b.dataset.i) === active));
    const cur = el.querySelector(".search-hit.active");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function close() {
    const el = box();
    if (el) el.hidden = true;
  }

  function open(i) {
    const j = results[i];
    if (!j) return;
    close();
    const inp = input();
    if (inp) inp.blur();
    if (FINISHED.includes(j.currentStage) && typeof CompletedJobs !== "undefined") {
      const tab = document.querySelector('.tab[data-tab="completedJobs"]');
      if (tab) tab.click();
      CompletedJobs.openJob(j.id);
    } else {
      openBoardJob(j.id);
    }
  }

  function init() {
    const inp = input();
    if (!inp || inp.dataset.bound) return;
    inp.dataset.bound = "1";
    inp.addEventListener("input", () => render(inp.value));
    inp.addEventListener("focus", () => { if (inp.value.trim()) render(inp.value); });
    inp.addEventListener("blur", () => setTimeout(close, 120));
    inp.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown" && results.length) { active = (active + 1) % results.length; highlight(); ev.preventDefault(); }
      else if (ev.key === "ArrowUp" && results.length) { active = (active - 1 + results.length) % results.length; highlight(); ev.preventDefault(); }
      else if (ev.key === "Enter") { if (active >= 0) open(active); ev.preventDefault(); }
      else if (ev.key === "Escape") { inp.value = ""; close(); inp.blur(); }
    });
    document.addEventListener("keydown", (ev) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target && ev.target.tagName) || "") || (ev.target && ev.target.isContentEditable);
      if ((ev.key === "/" && !typing) || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k")) {
        if (!document.getElementById("appRoot") || document.getElementById("appRoot").hidden) return;
        ev.preventDefault();
        inp.focus();
        inp.select();
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  return { open, search };
})();
