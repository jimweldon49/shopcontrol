// Parts look and daily work (desktop). Status/ETA/location chips, the Today's parts work
// lanes (order, follow up, receive), RO cards on the Parts tab, putting several parts away
// at once, and the cart / storage tiles on Carts & Shelves and the Shop Floor Plan.
// Uses the parts helpers in app.js (isPartLate, partNeedsMirror, partLocationName,
// dailyRecordForPartsRow, ...). The server's bulk update takes one RO at a time and keeps
// one vehicle per cart, so multi-RO actions send one request per RO.
const PartsUi = (() => {
  const e = (v) => escapeHtml(v == null ? "" : String(v));
  const DONE = ["Complete", "Returned"];
  const ISSUES = ["Wrong Part", "Return Needed", "Credit Pending"];
  const dayDiff = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 864e5);
  const shortDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const cartNum = (name) => String(name || "").replace(/^#\s*/, "");
  const natural = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true });

  // ------------------------------------------------------------ Chips
  // One state per part, in order of how much it needs attention.
  function state(r) {
    const s = r.partStatus || "";
    if (DONE.includes(s)) return { key: "done", label: s };
    if (isPartLate(r)) { const d = dayDiff(today(), r.partEta); return { key: "late", label: `Late · ${d} day${d === 1 ? "" : "s"}` }; }
    if (s === "Backordered") return { key: "backorder", label: "Backordered" };
    if (ISSUES.includes(s)) return { key: "issue", label: s };
    if (s === "Need to Order") return { key: "order", label: "Need to order" };
    if (s === "Ordered") return { key: "ordered", label: "Ordered" };
    if (s === "Received") return partNeedsMirror(r) ? { key: "received", label: "Received · mirror match" } : { key: "received", label: "Received" };
    if (s === "Mirror Matched") return { key: "matched", label: "Mirror matched" };
    return { key: "other", label: s || "No status" };
  }
  const statusPill = (r) => { const s = state(r); return `<span class="pp pp-${s.key}">${e(s.label)}</span>`; };

  function etaChip(r) {
    const s = r.partStatus || "";
    if (DONE.includes(s)) return "";
    if (["Received", "Mirror Matched"].includes(s)) return r.partReceivedDate ? `<span class="pc pc-in">Arrived ${e(shortDate(r.partReceivedDate))}</span>` : "";
    if (!r.partEta) return ["Ordered", "Backordered"].includes(s) ? `<span class="pc pc-warn">No ETA</span>` : "";
    const d = dayDiff(r.partEta, today());
    if (d < 0) return `<span class="pc pc-late">${plural(-d, "day")} late</span>`;
    if (d === 0) return `<span class="pc pc-today">Due today</span>`;
    if (d === 1) return `<span class="pc pc-soon">Tomorrow</span>`;
    const label = d < 7 ? new Date(`${r.partEta}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" }) : shortDate(r.partEta);
    return `<span class="pc">ETA ${e(label)}</span>`;
  }

  function locChip(r) {
    const name = partLocationName(r);
    if (name) return `<span class="pc pc-loc">📍 ${e(name)}</span>`;
    return ["Received", "Mirror Matched"].includes(r.partStatus) ? `<span class="pc pc-warn">Not put away</span>` : "";
  }

  const rowClass = (r) => ({ late: "pr-late", backorder: "pr-backorder", issue: "pr-issue", done: "pr-muted" }[state(r).key] || "");

  // ------------------------------------------------------------ Saving
  async function refresh() {
    [cache.parts, cache.inventoryLocations] = await Promise.all([api.list("parts"), api.list("inventoryLocations")]).then((r) => r.map((rows) => rows.map(objToCamel)));
    renderParts(); renderCartsShelves(); renderFloorPlan(); renderDashboard();
    const key = typeof currentPartsGroupKey !== "undefined" ? currentPartsGroupKey : null;
    if (key && $("partsModal")?.style.display === "flex") openPartsGroup(encodeURIComponent(key), true);
  }

  // Same change for parts on any number of ROs: one bulk request per RO.
  async function updateParts(parts, patch) {
    const byRo = new Map();
    for (const p of parts) {
      const ro = String(p.partsRoNumber || "").trim();
      if (!byRo.has(ro)) byRo.set(ro, []);
      byRo.get(ro).push(p.id);
    }
    try {
      for (const [ro, ids] of byRo) {
        if (!ro) throw Error("A part without an RO can't be changed in a group. Edit it on its own.");
        await apiRequest("/workspace/parts/bulk", { method: "POST", body: JSON.stringify({ action: "update", ids, ro_number: ro, patch: objToSnake(patch) }) });
      }
      showStatus(`Updated ${plural(parts.length, "part")}.`);
    } finally { await refresh(); }
  }

  // ------------------------------------------------------------ Put away
  const shelvesOf = (l) => (l && l.kind === "cart" ? [...(l.hasTop ? ["Top"] : []), ...Array.from({ length: l.shelfCount || 0 }, (_, i) => String(i + 1))] : []);
  // ROs on a cart: the ones assigned to it, or the ones whose parts are sitting on it.
  function cartRos(l) {
    if (l.ros && l.ros.length) return l.ros;
    return [...new Set(store.get("parts").filter((p) => p.partLocation === l.id && !DONE.includes(p.partStatus)).map((p) => String(p.partsRoNumber || "").trim()).filter(Boolean))];
  }

  function putAway(parts) {
    if (!parts.length) return showStatus("Select parts first.", true);
    const ros = [...new Set(parts.map((p) => String(p.partsRoNumber || "").trim()))];
    // One RO at a time: a cart (or a shelf) holds one vehicle's parts.
    if (ros.length > 1) return showStatus("Put away one RO's parts at a time.", true);
    const locations = store.get("inventoryLocations").slice().sort(natural);
    const mine = locations.filter((l) => l.kind === "cart" && cartRos(l).includes(ros[0]));
    const empty = locations.filter((l) => l.kind === "cart" && !cartRos(l).length);
    const storage = locations.filter((l) => l.kind !== "cart");
    const opt = (l) => `<option value="${e(l.id)}">${l.kind === "cart" ? `Cart ${e(cartNum(l.name))}` : e(l.name)} · ${e(l.zone || "")}</option>`;
    const dialog = openDialog(`Put away ${plural(parts.length, "part")}`, `
      <p class="board-tip">RO ${e(ros[0])}: they all go to the same place in one step.</p>
      <ul class="putaway-list">${parts.slice(0, 12).map((p) => `<li>${e(p.partDescription || "Part")} <small>RO ${e(p.partsRoNumber || "")}</small></li>`).join("")}${parts.length > 12 ? `<li><small>+ ${parts.length - 12} more</small></li>` : ""}</ul>
      <div class="form-grid">
        <label>Where<select name="location" id="putAwayLocation" required>
          ${mine.length ? `<optgroup label="Carts already holding RO ${e(ros[0])}">${mine.map(opt).join("")}</optgroup>` : ""}
          ${empty.length ? `<optgroup label="Empty carts">${empty.map(opt).join("")}</optgroup>` : ""}
          ${storage.length ? `<optgroup label="Shelves &amp; other storage">${storage.map(opt).join("")}</optgroup>` : ""}
        </select></label>
        <label id="putAwayShelfLabel">Shelf<select name="shelf" id="putAwayShelf"></select></label>
      </div>`, async (form) => {
      const location = form.get("location");
      if (!location) throw Error("Pick where they go.");
      await updateParts(parts, { partLocation: location, partShelf: form.get("shelf") || null });
    });
    const locSel = dialog.querySelector("#putAwayLocation"), shelfSel = dialog.querySelector("#putAwayShelf");
    const sync = () => {
      const l = locations.find((x) => x.id === locSel.value);
      const shelves = shelvesOf(l);
      dialog.querySelector("#putAwayShelfLabel").hidden = !shelves.length;
      shelfSel.innerHTML = `<option value="">Sort later</option>${shelves.map((s) => `<option value="${s}">${s === "Top" ? "Top" : `Shelf ${s}`}</option>`).join("")}`;
    };
    locSel.onchange = sync; sync();
    dialog.querySelector("[type=submit]").textContent = "Put away";
  }

  // ------------------------------------------------------------ Today's parts work
  const activeJob = (p) => {
    const j = dailyRecordForPartsRow(p, store.get("daily"));
    return j && !j.mergedInto && ShopModel.jobKind(j.roNumber) === "active" && !["Delivered", "Total Loss"].includes(j.currentStage) ? j : null;
  };
  const showAll = { order: false, follow: false, receive: false };

  function lanes() {
    const parts = store.get("parts").filter((p) => !DONE.includes(p.partStatus));
    const withJob = parts.map((p) => ({ p, j: activeJob(p) })).filter((x) => x.j);
    // Order: grouped by car; cars in the shop first, then by when they're due out.
    const byRo = new Map();
    for (const { p, j } of withJob.filter((x) => x.p.partStatus === "Need to Order")) {
      if (!byRo.has(j.id)) byRo.set(j.id, { j, parts: [] });
      byRo.get(j.id).parts.push(p);
    }
    const order = [...byRo.values()].sort((a, b) => (ShopModel.isOnsite(b.j) - ShopModel.isOnsite(a.j))
      || String(a.j.targetDeliveryDate || "9999").localeCompare(String(b.j.targetDeliveryDate || "9999")) || String(a.j.roNumber).localeCompare(String(b.j.roNumber)));
    const waiting = withJob.filter((x) => ["Ordered", "Backordered"].includes(x.p.partStatus));
    // Follow up: late, backordered, or ordered 2+ days ago with no ETA; not already called today.
    const follow = waiting.filter(({ p }) => p.partLastFollowUp !== today() && (isPartLate(p) || p.partStatus === "Backordered"
      || (!p.partEta && p.partOrderedDate && dayDiff(today(), p.partOrderedDate) >= 2)))
      .sort((a, b) => (a.p.partEta || "0").localeCompare(b.p.partEta || "0"));
    // Receive: due today or tomorrow and not late yet.
    const receive = waiting.filter(({ p }) => p.partEta && !isPartLate(p) && dayDiff(p.partEta, today()) <= 1)
      .sort((a, b) => a.p.partEta.localeCompare(b.p.partEta) || String(a.p.partsRoNumber).localeCompare(String(b.p.partsRoNumber)));
    return { order, follow, receive };
  }

  const carLabel = (j) => `<span class="lane-car"><b>RO ${e(j.roNumber)}</b> · ${e(String(j.vehicle || "").split(" / ")[0])}</span>`;
  const carState = (j) => (ShopModel.isOnsite(j) ? `<span class="pc pc-in">In the shop</span>` : `<span class="pc">${e(j.currentStage || "Not here yet")}</span>`) + (j.targetDeliveryDate ? `<span class="pc">Out ${e(shortDate(j.targetDeliveryDate))}</span>` : "");
  const more = (lane, n, shown) => (n > shown ? `<button type="button" class="link-button lane-more" onclick="PartsUi.toggleLane('${lane}')">${showAll[lane] ? "Show less" : `Show all ${n}`}</button>` : "");

  function renderToday() {
    const box = $("partsToday");
    if (!box) return;
    const { order, follow, receive } = lanes();
    const cap = (lane, list, n) => (showAll[lane] ? list : list.slice(0, n));
    const orderHtml = cap("order", order, 6).map(({ j, parts }) => `<div class="lane-item">
        <div class="lane-head">${carLabel(j)}<span class="pp pp-order">${plural(parts.length, "part")}</span></div>
        <div class="lane-chips">${carState(j)}</div>
        <small class="lane-parts">${e(parts.slice(0, 3).map((p) => p.partDescription || "Part").join(" · "))}${parts.length > 3 ? ` +${parts.length - 3} more` : ""}</small>
        <div class="actions"><button type="button" onclick="PartsUi.orderCar('${e(j.id)}')">Order all</button><button type="button" class="quiet" onclick="PartsUi.openRo('${e(j.roNumber)}')">Open</button></div>
      </div>`).join("");
    const partItem = (p, j, actions) => `<div class="lane-item ${rowClass(p)}">
        <div class="lane-head"><span>${e(p.partDescription || "Part")}</span>${statusPill(p)}</div>
        <div class="lane-chips">${etaChip(p)}${p.partVendor ? `<span class="pc">${e(p.partVendor)}</span>` : ""}</div>
        <small class="lane-parts">${carLabel(j)}${p.partLastFollowUp ? ` · last call ${e(shortDate(p.partLastFollowUp))}` : ""}</small>
        <div class="actions">${actions}</div>
      </div>`;
    const followHtml = cap("follow", follow, 6).map(({ p, j }) => partItem(p, j,
      `<button type="button" onclick="PartsUi.followedUp('${e(p.id)}')">Called ✓</button><button type="button" class="quiet" onclick="PartsUi.newEta('${e(p.id)}')">New ETA</button>`)).join("");
    const receiveHtml = cap("receive", receive, 6).map(({ p, j }) => partItem(p, j,
      `<button type="button" onclick="PartsUi.receive('${e(p.id)}')">Received</button>`)).join("");
    const lane = (key, title, hint, list, html) => `<section class="parts-lane lane-${key}">
        <header><h3>${title}</h3><span class="lane-count">${list.length}</span></header><p class="lane-hint">${hint}</p>
        ${html || `<p class="lane-empty">Nothing here. 👍</p>`}${more(key, list.length, 6)}</section>`;
    box.innerHTML = `<details class="parts-today" ${loadOpen() ? "open" : ""} ontoggle="PartsUi.saveOpen(this.open)">
      <summary><span class="eyebrow">TODAY'S PARTS WORK</span><b>${plural(order.length, "car")} to order · ${plural(follow.length, "part")} to follow up · ${plural(receive.length, "part")} arriving</b></summary>
      <div class="parts-lanes">
        ${lane("order", "Order", "Cars with parts still to order: in the shop first, then by out date.", order, orderHtml)}
        ${lane("follow", "Follow up", "Late, backordered, or ordered 2+ days ago with no ETA. Call the vendor, then click Called.", follow, followHtml)}
        ${lane("receive", "Receive", "Due in today or tomorrow. Click Received when it's in the door.", receive, receiveHtml)}
      </div></details>`;
  }
  function loadOpen() { try { return localStorage.getItem("partsTodayOpen") !== "0"; } catch (_) { return true; } }
  function saveOpen(open) { try { localStorage.setItem("partsTodayOpen", open ? "1" : "0"); } catch (_) {} }
  function toggleLane(lane) { showAll[lane] = !showAll[lane]; renderToday(); }

  const findPart = (id) => store.get("parts").find((p) => p.id === id);
  async function savePart(id, patch, done) {
    const p = findPart(id);
    if (!p) return;
    try { await upsert("parts", { id, ...patch, expectedUpdatedAt: p.updatedAt }); showStatus(done); } catch (_) {}
    renderToday();
  }
  const followedUp = (id) => savePart(id, { partLastFollowUp: today() }, "Follow-up logged.");
  const receive = (id) => savePart(id, { partStatus: "Received", partReceivedDate: today() }, "Marked received. Mirror match it, then put it away.");
  function newEta(id) {
    const p = findPart(id);
    if (!p) return;
    openDialog(`New ETA · ${p.partDescription || "Part"}`, `<label>When the vendor says it'll arrive<input type="date" name="eta" required min="${today()}" value="${addDaysKey(1)}"></label>`, async (f) => {
      await savePart(id, { partEta: f.get("eta"), partLastFollowUp: today() }, "ETA updated.");
    });
  }
  function orderCar(jobId) {
    const { order } = lanes();
    const car = order.find((x) => x.j.id === jobId);
    if (!car) return;
    openDialog(`Order ${plural(car.parts.length, "part")} · RO ${car.j.roNumber}`, `
      <ul class="putaway-list">${car.parts.map((p) => `<li>${e(p.partDescription || "Part")}</li>`).join("")}</ul>
      <label>Expected arrival (ETA)<input type="date" name="eta" min="${today()}" value="${addDaysKey(1)}"></label>
      <p class="board-tip">Leave the ETA blank if the vendor didn't give one; it'll come up for a follow-up call in 2 days.</p>`, async (f) => {
      await updateParts(car.parts, { partStatus: "Ordered", partOrderedDate: today(), partEta: f.get("eta") || null });
    });
  }
  function openRo(ro) {
    const p = store.get("parts").find((x) => String(x.partsRoNumber || "").trim() === String(ro).trim());
    if (p) openPartsGroup(encodeURIComponent(partGroupKey(p)));
  }

  // ------------------------------------------------------------ RO cards (Parts tab)
  // A car that's gone (delivered / total loss): its leftover parts don't need chasing.
  function carGone(row) {
    const j = dailyRecordForPartsRow(row, store.get("daily"));
    return !!j && ["Delivered", "Total Loss"].includes(j.currentStage);
  }
  const BAR = ["late", "backorder", "issue", "order", "ordered", "received", "matched", "done"];
  function roCard(g) {
    const counts = {};
    for (const r of g.rows) { const k = state(r).key; counts[k] = (counts[k] || 0) + 1; }
    const total = g.rows.length || 1;
    const job = dailyRecordForPartsRow(g.first, store.get("daily"));
    const gone = carGone(g.first);
    const late = gone ? 0 : counts.late || 0, mirror = g.rows.filter((r) => partNeedsMirror(r)).length;
    const unplaced = g.rows.filter((r) => ["Received", "Mirror Matched"].includes(r.partStatus) && !r.partLocation).length;
    const carts = [...new Set(g.rows.map((r) => partLocationName(r).split(" · ")[0]).filter(Boolean))];
    const chips = [
      late && `<span class="pp pp-late">${late} late</span>`,
      counts.backorder && `<span class="pp pp-backorder">${counts.backorder} backordered</span>`,
      counts.issue && `<span class="pp pp-issue">${counts.issue} return/credit</span>`,
      counts.order && `<span class="pp pp-order">${counts.order} to order</span>`,
      counts.ordered && `<span class="pp pp-ordered">${counts.ordered} on order</span>`,
      mirror && `<span class="pp pp-received">${mirror} to mirror match</span>`,
      unplaced && `<span class="pc pc-warn">${unplaced} not put away</span>`,
    ].filter(Boolean).join("");
    return `<button type="button" class="parts-ro-card ${late ? "has-late" : ""} ${gone ? "ro-gone" : ""}" onclick="openPartsGroup('${encodeURIComponent(g.key)}')">
      <div class="ro-top"><span class="ro-num">${e(g.first.partsRoNumber || "No RO")}</span>${job ? (ShopModel.isOnsite(job) ? `<span class="pc pc-in">In the shop</span>` : `<span class="pc">${e(job.currentStage || "")}</span>`) : ""}</div>
      <div class="ro-car"><b>${e(String(g.first.partsVehicle || "").split(" / ")[0] || "Vehicle")}</b><small>${e(g.first.partsCustomerName || "")}</small></div>
      <div class="ro-bar" title="${BAR.filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(", ")}">${BAR.filter((k) => counts[k]).map((k) => `<i class="seg-${k}" style="flex:${counts[k] / total}"></i>`).join("")}</div>
      <div class="ro-meta"><span>${plural(g.rows.length, "part")}</span><span>${g.summary.open} open</span>${carts.length ? `<span>📍 ${e(carts.slice(0, 2).join(", "))}${carts.length > 2 ? "…" : ""}</span>` : ""}</div>
      <div class="ro-chips">${chips || `<span class="pp pp-matched">All set</span>`}</div>
    </button>`;
  }

  // ------------------------------------------------------------ Carts & floor plan
  // Every part the RO still needs is in and sitting on one of its carts. Returns and credits
  // don't count; a wrong part does (the right one is still needed).
  const NOT_NEEDED = ["Return Needed", "Credit Pending"];
  function allPartsHere(ro) {
    const carts = new Set(store.get("inventoryLocations").filter((l) => l.kind === "cart" && cartRos(l).includes(ro)).map((l) => l.id));
    const needed = store.get("parts").filter((p) => String(p.partsRoNumber || "").trim() === ro && !DONE.includes(p.partStatus) && !NOT_NEEDED.includes(p.partStatus));
    return needed.length > 0 && needed.every((p) => ["Received", "Mirror Matched"].includes(p.partStatus) && carts.has(p.partLocation));
  }
  // The car behind a cart: "gone" (delivered), "complete" (in the shop, every part on the cart),
  // "here" (in the shop) or "" (not here yet / unknown).
  function cartCar(l, here, ros) {
    if (l.kind !== "cart" || !ros.length || !here.length) return "";
    const daily = store.get("daily");
    const jobs = here.map((p) => dailyRecordForPartsRow(p, daily)).filter(Boolean);
    if (jobs.length === here.length && jobs.every((j) => ["Delivered", "Total Loss"].includes(j.currentStage))) return "gone";
    if (!jobs.some((j) => ShopModel.isOnsite(j))) return "";
    return ros.every(allPartsHere) ? "complete" : "here";
  }

  function tile(l, selectedId) {
    const here = store.get("parts").filter((p) => isPartOnsite(p) && p.partLocation === l.id);
    // Carts: their RO. Shelves and bins hold several cars, so list whose parts are there.
    const ros = l.kind === "cart" ? cartRos(l) : [...new Set(here.map((p) => String(p.partsRoNumber || "").trim()).filter(Boolean))];
    const shelves = shelvesOf(l);
    const unshelved = l.kind === "cart" ? here.filter((p) => !p.partShelf || !shelves.includes(p.partShelf)).length : 0;
    const used = new Set(here.map((p) => p.partShelf).filter((s) => shelves.includes(s))).size;
    const car = cartCar(l, here, ros);
    const kind = l.kind !== "cart" ? (here.length ? "storage in-use" : "storage free") : (here.length || ros.length ? "in-use" : "free") + (car === "complete" ? " complete" : "");
    return `<button type="button" class="inv-tile ${kind} ${selectedId === l.id ? "selected" : ""}" onclick="selectInventoryLocation('${e(l.id)}')" data-location="${e(l.id)}">
      <span class="inv-kind">${l.kind === "cart" ? "Cart" : "Storage"}</span>
      <span class="inv-num ${(l.kind === "cart" ? cartNum(l.name) : l.name).length > 6 ? "long" : ""}">${e(l.kind === "cart" ? cartNum(l.name) : l.name)}</span>
      <span class="inv-ro">${ros.length ? `RO ${e(ros.slice(0, 2).join(", "))}${ros.length > 2 ? ` +${ros.length - 2}` : ""}` : "Empty"}</span>
      <span class="inv-count"><b>${here.length}</b> ${here.length === 1 ? "part" : "parts"}</span>
      ${shelves.length ? `<span class="inv-fill" title="${used} of ${shelves.length} shelves used"><i style="width:${Math.round((used / shelves.length) * 100)}%"></i></span>` : ""}
      <span class="inv-flags">${car === "gone" ? `<span class="inv-flag bad">Car delivered · clear cart</span>` : car === "complete" ? `<span class="inv-flag good">✓\u00a0All parts here</span>` : car === "here" ? `<span class="inv-flag good">Car in shop</span>` : ""}${car !== "gone" && unshelved ? `<span class="inv-flag">${unshelved} need a shelf</span>` : ""}</span>
    </button>`;
  }

  // Received / mirror-matched parts for cars in the shop that haven't been put away yet.
  const trayPicked = new Set();
  function trayParts() {
    return store.get("parts").filter((p) => ["Received", "Mirror Matched"].includes(p.partStatus) && !p.partLocation)
      .filter((p) => { const j = dailyRecordForPartsRow(p, store.get("daily")); return j && ShopModel.isOnsite(j); });
  }
  function trayHtml() {
    const parts = trayParts();
    for (const id of [...trayPicked]) if (!parts.some((p) => p.id === id)) trayPicked.delete(id);
    if (!parts.length) return `<div class="putaway-tray empty-tray"><b>Nothing waiting to be put away.</b> Received parts for cars in the shop show up here.</div>`;
    const byRo = new Map();
    for (const p of parts) { const ro = String(p.partsRoNumber || "").trim(); if (!byRo.has(ro)) byRo.set(ro, []); byRo.get(ro).push(p); }
    return `<div class="putaway-tray">
      <header><div><span class="eyebrow">NEEDS A HOME</span><b>${plural(parts.length, "part")} received and not put away</b></div>
        <div class="actions"><span class="tray-count">${trayPicked.size} selected</span><button type="button" ${trayPicked.size ? "" : "disabled"} onclick="PartsUi.putAwayPicked()">Put away selected</button></div></header>
      <p class="board-tip">Tick an RO's parts (or the RO box for all of them), then <b>Put away selected</b> to pick the cart and shelf, or drag them onto a shelf of the cart open below. They all move together.</p>
      <div class="tray-groups">${[...byRo].map(([ro, list]) => `<div class="tray-group">
        <label class="tray-ro"><input type="checkbox" ${list.every((p) => trayPicked.has(p.id)) ? "checked" : ""} onchange="PartsUi.pickRo('${e(ro)}', this.checked)"> <b>RO ${e(ro)}</b> <small>${e(String(list[0].partsVehicle || "").split(" / ")[0])} · ${list.length}</small></label>
        ${list.map((p) => `<label class="tray-part ${trayPicked.has(p.id) ? "picked" : ""}" draggable="true" data-part="${e(p.id)}" ondragstart="PartsUi.dragStart(event)"><input type="checkbox" ${trayPicked.has(p.id) ? "checked" : ""} onchange="PartsUi.pick('${e(p.id)}', this.checked)"> ${e(p.partDescription || "Part")}${Number(p.partQty || 1) > 1 ? ` <small>×${e(p.partQty)}</small>` : ""}</label>`).join("")}
      </div>`).join("")}</div></div>`;
  }
  // Picks stay within one RO: ticking another RO's part starts a new selection.
  const roOf = (id) => String(store.get("parts").find((p) => p.id === id)?.partsRoNumber || "").trim();
  function keepOnlyRo(ro) { for (const id of [...trayPicked]) if (roOf(id) !== ro) trayPicked.delete(id); }
  function pick(id, on) { if (on) { keepOnlyRo(roOf(id)); trayPicked.add(id); } else trayPicked.delete(id); renderCartsShelves(); }
  function pickRo(ro, on) { if (on) keepOnlyRo(ro); for (const p of trayParts().filter((x) => String(x.partsRoNumber || "").trim() === ro)) { if (on) trayPicked.add(p.id); else trayPicked.delete(p.id); } renderCartsShelves(); }
  function putAwayPicked() { putAway(store.get("parts").filter((p) => trayPicked.has(p.id))); }

  // Part cards on a cart's shelves can be ticked too; dragging a ticked card (or a ticked
  // tray part) moves everything that's ticked.
  const shelfPicked = new Set();
  function partCard(p) {
    const picked = shelfPicked.has(p.id);
    return `<div class="part-chip-card ${rowClass(p)} ${picked ? "picked" : ""}" draggable="true" data-part="${e(p.id)}" ondragstart="PartsUi.dragStart(event)">
      <input type="checkbox" ${picked ? "checked" : ""} onchange="PartsUi.pickShelf('${e(p.id)}', this.checked)" aria-label="Select ${e(p.partDescription || "part")}">
      ${PartPhoto.thumb(p.photoUrl, p.partDescription || "Part", 40)}<button type="button" class="pcc-body" onclick="editParts('${e(p.id)}')"><b>${e(p.partDescription || "Part")}</b><small>RO ${e(p.partsRoNumber || "")}${Number(p.partQty || 1) > 1 ? ` · ×${e(p.partQty)}` : ""}</small>${statusPill(p)}</button>
    </div>`;
  }
  function pickShelf(id, on) {
    if (on) { for (const x of [...shelfPicked]) if (roOf(x) !== roOf(id)) shelfPicked.delete(x); shelfPicked.add(id); } else shelfPicked.delete(id);
    renderCartsShelves();
  }
  function dragStart(ev) {
    const id = ev.currentTarget.dataset.part;
    const set = trayPicked.has(id) ? trayPicked : shelfPicked.has(id) ? shelfPicked : null;
    ev.dataTransfer.setData("text/plain", JSON.stringify(set ? [...set] : [id]));
  }
  async function dropOnShelf(raw, locationId, shelf) {
    let ids;
    try { ids = JSON.parse(raw); } catch (_) { ids = [raw]; }
    const parts = store.get("parts").filter((p) => ids.includes(p.id));
    if (!parts.length || !locationId) return;
    for (const p of parts) { trayPicked.delete(p.id); shelfPicked.delete(p.id); }
    try { await updateParts(parts, { partLocation: locationId, partShelf: shelf }); } catch (err) { showStatus(err.message, true); }
  }

  // Take (or retake) a part's photo; it shows in every parts list and the techs' app.
  async function photo(id) {
    try {
      const url = await PartPhoto.take(id);
      if (url) { showStatus("Photo saved."); await refresh(); }
    } catch (err) { showStatus(err.message, true); }
  }
  async function removePhoto(id) {
    try { await PartPhoto.remove(id); showStatus("Photo removed."); await refresh(); } catch (err) { showStatus(err.message, true); }
  }

  return {
    photo, removePhoto, carGone, statusPill, etaChip, locChip, rowClass, state, putAway, updateParts, renderToday, saveOpen, toggleLane,
    followedUp, receive, newEta, orderCar, openRo, roCard, tile, natural, cartNum, cartRos, trayHtml,
    pick, pickRo, putAwayPicked, partCard, pickShelf, dragStart, dropOnShelf,
  };
})();
