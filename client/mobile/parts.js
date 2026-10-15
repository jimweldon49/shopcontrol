// Parts desk in the employee app: what the office program's Parts, Carts & Shelves,
// Returns & Alerts and Manage Locations tabs do, sized for a phone. Only office staff
// and the parts role see it; the server still checks every change (ROLE_PERMISSIONS).
// Uses helpers from mobile.js (apiRequest, showScreen, setAccent, esc, toast, showAlert, today).
(() => {
  const PARTS_ROLES = ["office", "manager", "admin", "owner", "parts"];
  const STATUSES = ["Need to Order", "Ordered", "Backordered", "Received", "Mirror Matched", "Wrong Part", "Return Needed", "Returned", "Credit Pending", "Complete"];
  const TYPES = ["OEM", "Aftermarket", "Used", "Reconditioned", "Sublet", "Material", "Other"];
  const PRIORITIES = ["High", "Normal", "Low"];
  const BAD_STATUSES = ["Backordered", "Wrong Part", "Return Needed", "Credit Pending"];
  const OFFSITE_STATUSES = ["Complete", "Returned", "Credit Pending"];
  const VIEWS = [
    ["all", "All open"], ["problems", "Problems"], ["late", "Not arrived on time"], ["needOrder", "Need to order"],
    ["ordered", "Ordered / waiting"], ["backordered", "Backordered"], ["received", "Received"], ["mirror", "Need mirror match"],
    ["returns", "Returns / credits"], ["noRo", "No RO yet"], ["complete", "Complete"],
  ];

  let parts = [];
  let locations = [];
  let daily = [];
  let view = "all";
  let groupKey = null;
  let groupBack = "desk";
  let problemsOnly = false;
  let selected = new Set();
  let editing = null;
  let editBack = "group";
  let cartId = null;
  let editingLoc = null;
  let todayLane = null;
  let todayAll = false;
  const trayPicked = new Set();
  const cartPicked = new Set();

  const role = () => String((currentUser && currentUser.role) || "").toLowerCase();
  const canUse = () => PARTS_ROLES.includes(role());
  const canDelete = () => !!(currentUser && currentUser.canDelete);
  const money = (n) => ShopModel.money(n);
  const opts = (list, cur) => list.map((v) => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
  const day = (d) => String(d || "").slice(0, 10);
  // Core not returned 3 days after the part was marked Has a core (same rule as the desktop).
  const coreOverdue = (p) => p.has_core && !p.core_returned && !!p.core_flagged_at && Date.now() - new Date(p.core_flagged_at).getTime() >= 3 * 864e5;
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  // ---------------------------------------------------------------- Rules (same as the office Parts tab)
  const groupKeyOf = (p) => String(p.parts_ro_number || "").trim() || [p.parts_customer_name || "", p.parts_vehicle || ""].join("||");
  const isLate = (p) => !!p.part_eta && day(p.part_eta) < today() && !["Received", "Mirror Matched", "Complete", "Returned"].includes(p.part_status);
  function problemOf(p) {
    if (p.part_status === "Complete") return null;
    if (isLate(p)) return "Not arrived by ETA";
    if (["Need to Order", ...BAD_STATUSES].includes(p.part_status)) return p.part_status;
    if (needsMirror(p)) return "Not mirror matched";
    return null;
  }
  const isRealRo = (ro) => /^\d+$/.test(String(ro || "").trim());
  function jobFor(p) {
    const ro = String(p.parts_ro_number || "").trim();
    if (ro) {
      const match = daily.find((d) => String(d.ro_number || "").trim() === ro)
        || daily.find((d) => !d.merged_into && String(d.ccc_estfile_id || "").trim() === ro);
      if (match) return match;
    }
    const cust = String(p.parts_customer_name || "").trim().toLowerCase(), veh = String(p.parts_vehicle || "").trim().toLowerCase();
    return cust && veh ? daily.find((d) => String(d.customer_name || "").trim().toLowerCase() === cust && String(d.vehicle || "").trim().toLowerCase() === veh) || null : null;
  }
  const hasRo = (p) => isRealRo(p.parts_ro_number) || isRealRo(jobFor(p)?.ro_number);
  // A received part only needs mirror matching once its car is on site on the Production
  // Board (same rule as the office Parts tab, partNeedsMirror in app.js).
  function needsMirror(p) {
    if (p.part_status !== "Received" || p.part_mirror_matched === "Yes") return false;
    const j = jobFor(p);
    return !!j && ShopModel.isOnsite({ roNumber: j.ro_number, onsite: j.onsite, mergedInto: j.merged_into, currentStage: j.current_stage });
  }
  function vehicleOnsite(p) {
    const j = jobFor(p);
    return j ? ShopModel.isOnsite({ roNumber: j.ro_number, onsite: j.onsite, mergedInto: j.merged_into, currentStage: j.current_stage }) : true;
  }
  function summarize(rows) {
    return {
      total: rows.length,
      open: rows.filter((r) => r.part_status !== "Complete").length,
      problems: rows.filter(problemOf).length,
      needOrder: rows.filter((r) => r.part_status === "Need to Order").length,
      waiting: rows.filter((r) => ["Ordered", "Backordered"].includes(r.part_status)).length,
      mirror: rows.filter(needsMirror).length,
      returns: rows.filter((r) => ["Wrong Part", "Return Needed", "Returned", "Credit Pending"].includes(r.part_status) || r.part_return_needed === "Yes" || r.part_credit_needed === "Yes").length,
    };
  }
  function matchesView(rows, v) {
    const s = summarize(rows);
    if (v === "all") return s.open > 0;
    if (v === "needOrder") return s.needOrder > 0;
    if (v === "ordered") return s.waiting > 0;
    if (v === "backordered") return rows.some((r) => r.part_status === "Backordered");
    if (v === "received") return rows.some((r) => r.part_status === "Received");
    if (v === "mirror") return s.mirror > 0;
    if (v === "returns") return s.returns > 0;
    if (v === "problems") return hasRo(rows[0]) && s.problems > 0 && rows.some(vehicleOnsite);
    if (v === "noRo") return !hasRo(rows[0]) && s.open > 0;
    if (v === "late") return hasRo(rows[0]) && rows.some(isLate);
    if (v === "complete") return s.open === 0 && s.total > 0;
    return true;
  }
  const value = (p) => Number(p.part_cost || 0) * Number(p.part_qty || 1);
  const ageDays = (p) => p.part_received_date ? Math.max(0, Math.floor((new Date(today() + "T00:00:00") - new Date(day(p.part_received_date) + "T00:00:00")) / 86400000)) : null;
  const onsite = (p) => !OFFSITE_STATUSES.includes(p.part_status);
  const shelfName = (s) => (s === "Top" ? "Top" : "Shelf " + s);
  const shelvesOf = (loc) => (loc && loc.kind === "cart" ? [...(loc.has_top ? ["Top"] : []), ...Array.from({ length: loc.shelf_count || 0 }, (_, i) => String((loc.shelf_count || 0) - i))] : []);
  function whereOf(p) {
    const loc = locations.find((l) => l.id === p.part_location);
    if (!loc) return "";
    return loc.kind === "cart" ? `Cart ${loc.name}${p.part_shelf ? " · " + shelfName(p.part_shelf) : ""}` : `${loc.name} · ${loc.zone}`;
  }
  const groupRows = () => parts.filter((p) => groupKeyOf(p) === groupKey);

  // ---------------------------------------------------------------- Look (same as the office Parts tab, client/partsUi.js)
  const DONE = ["Complete", "Returned"];
  const dayDiff = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 864e5);
  const shortDate = (d) => new Date(`${day(d)}T12:00:00`).toLocaleDateString(I18n.locale(), { month: "short", day: "numeric" });
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const camelJob = (j) => ({ roNumber: j.ro_number, onsite: j.onsite, mergedInto: j.merged_into, currentStage: j.current_stage });
  const jobOnsite = (j) => !!j && ShopModel.isOnsite(camelJob(j));
  const carGone = (p) => { const j = jobFor(p); return !!j && ["Delivered", "Total Loss"].includes(j.current_stage); };
  function stateOf(p) {
    const s = p.part_status || "";
    if (DONE.includes(s)) return { key: "done", label: s };
    if (isLate(p)) { const d = dayDiff(today(), day(p.part_eta)); return { key: "late", label: `Late · ${plural(d, "day")}` }; }
    if (s === "Backordered") return { key: "backorder", label: s };
    if (["Wrong Part", "Return Needed", "Credit Pending"].includes(s)) return { key: "issue", label: s };
    if (s === "Need to Order") return { key: "order", label: "Need to order" };
    if (s === "Ordered") return { key: "ordered", label: "Ordered" };
    if (s === "Received") return { key: "received", label: needsMirror(p) ? "Received · mirror match" : "Received" };
    if (s === "Mirror Matched") return { key: "matched", label: "Mirror matched" };
    return { key: "other", label: s || "No status" };
  }
  const statusPill = (p) => { const s = stateOf(p); return `<span class="pp pp-${s.key}">${esc(s.label)}</span>`; };
  function etaChip(p) {
    const s = p.part_status || "";
    if (DONE.includes(s)) return "";
    if (["Received", "Mirror Matched"].includes(s)) return p.part_received_date ? `<span class="pc pc-in">Arrived ${esc(shortDate(p.part_received_date))}</span>` : "";
    if (!p.part_eta) return ["Ordered", "Backordered"].includes(s) ? '<span class="pc pc-warn">No ETA</span>' : "";
    const d = dayDiff(day(p.part_eta), today());
    if (d < 0) return `<span class="pc pc-late">${plural(-d, "day")} late</span>`;
    if (d === 0) return '<span class="pc pc-today">Due today</span>';
    if (d === 1) return '<span class="pc pc-soon">Tomorrow</span>';
    return `<span class="pc">ETA ${esc(d < 7 ? new Date(`${day(p.part_eta)}T12:00:00`).toLocaleDateString(I18n.locale(), { weekday: "short" }) : shortDate(p.part_eta))}</span>`;
  }
  const rowClass = (p) => ({ late: "pr-late", backorder: "pr-backorder", issue: "pr-issue", done: "pr-muted" }[stateOf(p).key] || "");
  const cartNum = (name) => String(name || "").replace(/^#\s*/, "");
  // ROs on a cart: the ones linked to it, or the ones whose parts are on it.
  const cartRos = (l) => ((l.ros || []).length ? l.ros.map(String) : [...new Set(parts.filter((p) => p.part_location === l.id && !DONE.includes(p.part_status)).map((p) => String(p.parts_ro_number || "").trim()).filter(Boolean))]);

  // Same change to several parts of one RO (the server's bulk update is per RO).
  async function bulkFor(ids, ro, patch) {
    if (!ids.length) throw Error("Select parts first.");
    await apiRequest("/workspace/parts/bulk", { method: "POST", body: JSON.stringify({ action: "update", ids, ro_number: ro, patch }) });
    await reloadParts();
    toast(`Updated ${plural(ids.length, "part")} ✓`);
  }
  async function saveOne(p, patch, msg) {
    await apiRequest(`/parts/${p.id}`, { method: "PUT", body: JSON.stringify({ ...patch, expected_updated_at: p.updated_at }) });
    await reloadParts();
    toast(msg);
  }

  // Put several parts of one RO away in one step: cart (or storage) and shelf.
  function putAwaySheet(ids, after) {
    const list = parts.filter((p) => ids.includes(p.id));
    const ro = String(list[0]?.parts_ro_number || "").trim();
    if (!list.length) return toast("Select parts first.");
    if (list.some((p) => String(p.parts_ro_number || "").trim() !== ro)) return toast("Put away one RO's parts at a time.");
    const sorted = locations.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    const mine = sorted.filter((l) => l.kind === "cart" && cartRos(l).includes(ro));
    const empty = sorted.filter((l) => l.kind === "cart" && !cartRos(l).length);
    const storage = sorted.filter((l) => l.kind !== "cart");
    const opt = (l) => `<option value="${esc(l.id)}">${l.kind === "cart" ? "Cart " + esc(cartNum(l.name)) : esc(l.name)} · ${esc(l.zone || "")}</option>`;
    sheet(`<h3>Put away ${plural(list.length, "part")}</h3><p class="hint" translate="no">RO ${esc(ro)}</p>
      <label class="field"><span>Where</span><select class="input" id="pPutLoc">
        ${mine.length ? `<optgroup label="Already holding RO ${esc(ro)}">${mine.map(opt).join("")}</optgroup>` : ""}
        ${empty.length ? `<optgroup label="Empty carts">${empty.map(opt).join("")}</optgroup>` : ""}
        ${storage.length ? `<optgroup label="Shelves &amp; other storage">${storage.map(opt).join("")}</optgroup>` : ""}
      </select></label>
      <label class="field" id="pPutShelfWrap"><span>Shelf</span><select class="input" id="pPutShelf"></select></label>
      <button class="btn btn-primary" data-confirm>Put away</button><button class="btn btn-ghost" data-close>Cancel</button>`,
      async () => {
        const loc = $("pPutLoc").value;
        if (!loc) throw Error("Pick where they go.");
        await bulkFor(list.map((p) => p.id), ro, { part_location: loc, part_shelf: $("pPutShelf").value || null });
        after();
      });
    const sync = () => {
      const shelves = shelvesOf(locations.find((l) => l.id === $("pPutLoc").value));
      $("pPutShelfWrap").hidden = !shelves.length;
      $("pPutShelf").innerHTML = '<option value="">Sort later</option>' + shelves.map((x) => `<option value="${x}">${shelfName(x)}</option>`).join("");
    };
    $("pPutLoc").onchange = sync; sync();
  }

  // ---------------------------------------------------------------- Today's parts work
  function activeJob(p) {
    const j = jobFor(p);
    return j && !j.merged_into && ShopModel.jobKind(j.ro_number) === "active" && !["Delivered", "Total Loss"].includes(j.current_stage) ? j : null;
  }
  function lanes() {
    const withJob = parts.filter((p) => !DONE.includes(p.part_status)).map((p) => ({ p, j: activeJob(p) })).filter((x) => x.j);
    const byJob = new Map();
    for (const { p, j } of withJob.filter((x) => x.p.part_status === "Need to Order")) {
      if (!byJob.has(j.id)) byJob.set(j.id, { j, list: [] });
      byJob.get(j.id).list.push(p);
    }
    const order = [...byJob.values()].sort((a, b) => (jobOnsite(b.j) - jobOnsite(a.j)) || day(a.j.target_delivery_date || "9999").localeCompare(day(b.j.target_delivery_date || "9999")));
    const waiting = withJob.filter((x) => ["Ordered", "Backordered"].includes(x.p.part_status));
    const follow = waiting.filter(({ p }) => day(p.part_last_follow_up) !== today() && (isLate(p) || p.part_status === "Backordered"
      || (!p.part_eta && p.part_ordered_date && dayDiff(today(), day(p.part_ordered_date)) >= 2))).sort((a, b) => day(a.p.part_eta || "0").localeCompare(day(b.p.part_eta || "0")));
    const receive = waiting.filter(({ p }) => p.part_eta && !isLate(p) && dayDiff(day(p.part_eta), today()) <= 1).sort((a, b) => day(a.p.part_eta).localeCompare(day(b.p.part_eta)));
    return { order, follow, receive };
  }
  function renderToday() {
    const l = lanes();
    if (!todayLane) todayLane = l.follow.length ? "follow" : l.receive.length ? "receive" : "order";
    const tabs = [["order", "Order", l.order.length], ["follow", "Follow up", l.follow.length], ["receive", "Receive", l.receive.length]];
    const car = (j) => `<b translate="no">RO ${esc(j.ro_number)}</b> <span translate="no">· ${esc(String(j.vehicle || "").split(" / ")[0])}</span>`;
    const list = l[todayLane];
    const shown = todayAll ? list : list.slice(0, 5);
    let html;
    if (todayLane === "order") html = shown.map(({ j, list: ps }) => `<div class="today-item"><div class="ti-head"><span>${car(j)}</span><span class="pp pp-order">${plural(ps.length, "part")}</span></div>
      <div class="ti-chips">${jobOnsite(j) ? '<span class="pc pc-in">In the shop</span>' : `<span class="pc" translate="no">${esc(j.current_stage || "")}</span>`}${j.target_delivery_date ? `<span class="pc">Out ${esc(shortDate(j.target_delivery_date))}</span>` : ""}</div>
      <div class="ti-actions"><button class="btn-sm primary" data-porder-car="${esc(j.id)}">Order all</button><button class="btn-sm" data-popen-ro="${esc(j.ro_number)}">Open</button></div></div>`).join("");
    else html = shown.map(({ p, j }) => `<div class="today-item ${rowClass(p)}"><div class="ti-head"><span translate="no">${esc(p.part_description || "Part")}</span>${statusPill(p)}</div>
      <div class="ti-chips">${etaChip(p)}${p.part_vendor ? `<span class="pc" translate="no">${esc(p.part_vendor)}</span>` : ""}</div><small>${car(j)}</small>
      <div class="ti-actions">${todayLane === "follow" ? `<button class="btn-sm primary" data-pfollow="${esc(p.id)}">Called ✓</button><button class="btn-sm" data-pneweta="${esc(p.id)}">New ETA</button>` : `<button class="btn-sm primary" data-preceive="${esc(p.id)}">Received</button>`}</div></div>`).join("");
    $("pToday").innerHTML = `<div class="today-box"><div class="eyebrow">Today's parts work</div>
      <div class="today-tabs">${tabs.map(([k, label, n]) => `<button class="today-tab t-${k} ${k === todayLane ? "on" : ""}" data-ptoday="${k}"><b>${n}</b>${esc(label)}</button>`).join("")}</div>
      ${html || '<div class="empty">Nothing here. 👍</div>'}${list.length > 5 ? `<button class="btn-link" data-ptoday-all>${todayAll ? "Show less" : `Show all ${list.length}`}</button>` : ""}</div>`;
  }
  function orderCarSheet(jobId) {
    const car = lanes().order.find((x) => x.j.id === jobId);
    if (!car) return;
    sheet(`<h3>Order ${plural(car.list.length, "part")}</h3><p class="hint" translate="no">RO ${esc(car.j.ro_number)} · ${esc(String(car.j.vehicle || "").split(" / ")[0])}</p>
      <label class="field"><span>Expected arrival (ETA)</span><input class="input" type="date" id="pCarEta" min="${today()}" value="${addDays(1)}"></label>
      <p class="hint">Leave blank if the vendor didn't give one; it comes up for a follow-up call in 2 days.</p>
      <button class="btn btn-primary" data-confirm>Mark ordered</button><button class="btn btn-ghost" data-close>Cancel</button>`,
      async () => { await bulkFor(car.list.map((p) => p.id), String(car.list[0].parts_ro_number || "").trim(), { part_status: "Ordered", part_ordered_date: today(), part_eta: $("pCarEta").value || null }); renderDesk(); });
  }
  function newEtaSheet(id) {
    const p = parts.find((x) => x.id === id);
    if (!p) return;
    sheet(`<h3 translate="no">${esc(p.part_description || "Part")}</h3><label class="field"><span>When the vendor says it'll arrive</span><input class="input" type="date" id="pNewEta" min="${today()}" value="${addDays(1)}"></label>
      <button class="btn btn-primary" data-confirm>Save ETA</button><button class="btn btn-ghost" data-close>Cancel</button>`,
      async () => { if (!$("pNewEta").value) throw Error("Pick a date."); await saveOne(p, { part_eta: $("pNewEta").value, part_last_follow_up: today() }, "ETA updated ✓"); renderDesk(); });
  }
  let groupSearch = "";
  const visibleRows = () => (problemsOnly ? groupRows().filter(problemOf) : groupRows()).filter((p) => ShopModel.partMatches(p, groupSearch));

  // ---------------------------------------------------------------- Data
  async function load() {
    const [p, l, d] = await Promise.all([apiRequest("/parts"), apiRequest("/inventoryLocations").catch(() => []), apiRequest("/daily").catch(() => [])]);
    parts = p; locations = l; daily = d;
  }
  async function reloadParts() {
    [parts, locations] = await Promise.all([apiRequest("/parts"), apiRequest("/inventoryLocations").catch(() => locations)]);
  }

  function sheet(html, onConfirm) {
    const back = document.createElement("div");
    back.className = "sheet-backdrop";
    back.innerHTML = `<div class="sheet"><div class="grab"></div>${html}<div class="alert alert-error" data-sheet-error></div></div>`;
    back.onclick = async (e) => {
      if (e.target === back || e.target.closest("[data-close]")) return back.remove();
      const btn = e.target.closest("[data-confirm]");
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      try { await onConfirm(back, btn.dataset.confirm); back.remove(); }
      catch (err) { const a = back.querySelector("[data-sheet-error]"); a.textContent = err.message; a.classList.add("show"); btn.disabled = false; }
    };
    document.body.append(back);
    return back;
  }

  // ---------------------------------------------------------------- Parts desk (list of vehicles)
  async function openDesk() {
    setAccent(DEFAULT_ACCENT);
    showScreen("pdesk");
    $("pdeskViews").innerHTML = VIEWS.map(([k, label]) => `<button class="chip ${k === view ? "on" : ""}" data-pview="${k}">${esc(label)}</button>`).join("");
    $("pdeskList").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    try { await load(); renderDesk(); }
    catch (err) { $("pdeskList").innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  function renderDesk() {
    document.querySelectorAll("#pdeskViews .chip").forEach((c) => c.classList.toggle("on", c.dataset.pview === view));
    const q = $("pdeskSearch").value.trim().toLowerCase();
    const map = new Map();
    for (const p of parts) { const k = groupKeyOf(p); if (!map.has(k)) map.set(k, []); map.get(k).push(p); }
    const groups = [...map.entries()].map(([key, rows]) => ({ key, rows, first: rows[0], s: summarize(rows),
      hay: rows.map((r) => [r.parts_ro_number, r.parts_customer_name, r.parts_vehicle, r.part_description, r.part_vendor, r.part_status, r.part_notes, whereOf(r)].join(" ")).join(" ").toLowerCase() }))
      .filter((g) => matchesView(g.rows, view) && g.hay.includes(q))
      .sort((a, b) => (b.s.open - a.s.open) || String(a.first.parts_ro_number || "").localeCompare(String(b.first.parts_ro_number || ""), undefined, { numeric: true }));
    renderToday();
    // Cars still here with late parts first; delivered cars last.
    const lateOf = (g) => (carGone(g.first) ? 0 : g.rows.filter(isLate).length);
    groups.sort((a, b) => (carGone(a.first) - carGone(b.first)) || (lateOf(b) - lateOf(a)) || 0);
    $("pdeskCount").textContent = `${groups.length} vehicle${groups.length === 1 ? "" : "s"}`;
    const BAR = ["late", "backorder", "issue", "order", "ordered", "received", "matched", "done"];
    $("pdeskList").innerHTML = groups.length ? groups.map((g) => {
      const counts = {};
      for (const r of g.rows) { const k = stateOf(r).key; counts[k] = (counts[k] || 0) + 1; }
      const gone = carGone(g.first), late = gone ? 0 : counts.late || 0, j = jobFor(g.first);
      const unplaced = g.rows.filter((r) => ["Received", "Mirror Matched"].includes(r.part_status) && !r.part_location).length;
      const chips = [late && `<span class="pp pp-late">${late} late</span>`, counts.backorder && `<span class="pp pp-backorder">${counts.backorder} backordered</span>`,
        counts.order && `<span class="pp pp-order">${counts.order} to order</span>`, counts.ordered && `<span class="pp pp-ordered">${counts.ordered} on order</span>`,
        g.s.mirror && `<span class="pp pp-received">${g.s.mirror} to mirror match</span>`, unplaced && `<span class="pc pc-warn">${unplaced} not put away</span>`].filter(Boolean).join("");
      return `<button class="pro-card ${late ? "has-late" : ""} ${gone ? "gone" : ""}" data-pgroup="${esc(g.key)}">
        <div class="pro-top"><span class="pro-num" translate="no">${esc(g.first.parts_ro_number || "No RO")}</span>${j ? (jobOnsite(j) ? '<span class="pc pc-in">In the shop</span>' : `<span class="pc" translate="no">${esc(j.current_stage || "")}</span>`) : ""}</div>
        <b class="pro-car" translate="no">${esc(String(g.first.parts_vehicle || "Vehicle").split(" / ")[0])}</b><small translate="no">${esc(g.first.parts_customer_name || "")} · ${plural(g.rows.length, "part")}</small>
        <div class="pro-bar">${BAR.filter((k) => counts[k]).map((k) => `<i class="seg-${k}" style="flex:${counts[k]}"></i>`).join("")}</div>
        <div class="pro-chips">${chips || '<span class="pp pp-matched">All set</span>'}</div></button>`;
    }).join("") : '<div class="empty">No vehicles match.</div>';
  }

  // ---------------------------------------------------------------- One vehicle's parts
  function openGroup(key, back) {
    if (key !== groupKey) { groupSearch = ""; $("pgroupSearch").value = ""; }
    groupKey = key;
    if (back) groupBack = back;
    selected = new Set();
    problemsOnly = (view === "problems" || view === "late") && groupBack === "desk" && groupRows().some(problemOf);
    renderGroup();
    showScreen("pgroup");
  }

  function renderGroup() {
    const rows = groupRows();
    if (!rows.length) { openDesk(); return; }
    const first = rows[0];
    const ro = String(first.parts_ro_number || "").trim();
    $("pgroupTitle").textContent = ro ? `Parts · RO ${ro}` : "Parts";
    const carts = locations.filter((l) => l.kind === "cart" && (l.ros || []).map(String).includes(ro));
    const probs = rows.filter(problemOf).length;
    $("pgroupHead").innerHTML = `<div class="row-card"><b translate="no">${esc(first.parts_vehicle || "Vehicle")}</b>
      <small translate="no">${esc(first.parts_customer_name || "")}</small><br><small>${probs} problem part${probs === 1 ? "" : "s"} of ${rows.length}</small></div>
      ${carts.length ? `<div class="where-banner"><span>Parts cart</span><b translate="no">${carts.map((c) => esc(c.name)).join(" + ")}</b><small translate="no">${esc(carts[0].zone)}</small></div>` : ""}`;
    $("pProblemsOnly").checked = problemsOnly;
    const list = visibleRows();
    $("pgroupList").innerHTML = list.map((p) => {
      const prob = problemOf(p), on = selected.has(p.id), where = whereOf(p);
      const facts = [p.part_type, p.part_vendor, Number(p.part_qty || 1) > 1 ? "Qty " + Number(p.part_qty) : "", p.part_cost ? money(value(p)) : ""].filter(Boolean).join(" · ");
      return `<div class="prow ${on ? "on" : ""} ${rowClass(p)}">
        <button class="pbox" data-psel="${esc(p.id)}" aria-label="Select"><span class="box"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span></button>
        <button class="pbody" data-pedit="${esc(p.id)}"><div class="pbody-row">${PartPhoto.thumb(p.photo_url, p.part_description || "Part", 56)}<div>
          <b translate="no">${esc(p.part_description || "Part")}</b>
          <small translate="no">${esc(facts)}</small>
          <div class="p-chips">${statusPill(p)}${etaChip(p)}</div>
          ${p.part_status !== "Complete" ? `<div class="where ${where ? "" : "none"}" translate="no">📍 ${esc(where || (["Received", "Mirror Matched"].includes(p.part_status) ? "Not put away" : "Not placed"))}</div>` : ""}
          ${p.part_mirror_matched === "Yes" ? '<span class="pill ok">Mirror matched</span>' : ""}
          ${p.has_core ? `<span class="pill ${p.core_returned ? "ok" : "warn"}">${p.core_returned ? "Core returned" : coreOverdue(p) ? "Core overdue 3+ days" : "Core return due"}</span>` : ""}
          <span class="photo-btn" role="button" data-pphoto="${esc(p.id)}">📷 ${p.photo_url ? "Retake photo" : "Add photo"}</span>
        </div></div></button></div>`;
    }).join("") || '<div class="empty">No problem parts. Turn off "Problem parts only" to see them all.</div>';
    syncSelection();
  }

  function syncSelection() {
    const n = selected.size;
    $("pselCount").textContent = n ? `${n} selected` : "Tap the boxes to pick parts";
    $("pActions").hidden = !n;
    $("pAddToGroup").hidden = !!n;
    $("pBulkDelete").hidden = !canDelete();
  }

  function toggleSelect(id) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    renderGroup();
  }

  function pick(which) {
    const rows = visibleRows();
    if (which === "all") selected = new Set(rows.map((r) => r.id));
    if (which === "none") selected = new Set();
    if (which === "ordered") selected = new Set(rows.filter((r) => ["Ordered", "Backordered"].includes(r.part_status)).map((r) => r.id));
    if (which === "mirrored") selected = new Set(rows.filter((r) => r.part_mirror_matched === "Yes").map((r) => r.id));
    renderGroup();
  }

  async function bulk(patch, action = "update") {
    const ids = [...selected];
    if (!ids.length) throw Error("Select parts first.");
    await apiRequest("/workspace/parts/bulk", { method: "POST", body: JSON.stringify({ action, ids, ro_number: groupRows()[0]?.parts_ro_number || "", patch: action === "update" ? patch : undefined }) });
    await reloadParts();
    selected = new Set();
    toast(`${action === "delete" ? "Deleted" : "Updated"} ${ids.length} part${ids.length === 1 ? "" : "s"} ✓`);
    renderGroup();
  }

  function orderSheet() {
    const n = selected.size;
    sheet(`<h3>Order ${n} part${n === 1 ? "" : "s"}</h3>
      <label class="field"><span>Expected arrival (ETA)</span><input class="input" type="date" id="pOrderEta" min="${today()}" value="${addDays(1)}"></label>
      <p class="hint">If a part isn't marked received by this date it shows under Not arrived on time. Leave blank if the vendor didn't give one.</p>
      <button class="btn btn-primary" data-confirm>Mark ordered</button><button class="btn btn-ghost" data-close>Cancel</button>`,
      () => bulk({ part_status: "Ordered", part_ordered_date: today(), part_eta: $("pOrderEta").value || null }));
  }

  function receiveSheet() {
    const n = selected.size;
    sheet(`<h3>Receive ${n} part${n === 1 ? "" : "s"}</h3>
      <p class="hint">Sets the status to Received with today's date. Mirror match them next to put them on a cart.</p>
      <button class="btn btn-primary" data-confirm>Mark received</button><button class="btn btn-ghost" data-close>Cancel</button>`,
      () => bulk({ part_status: "Received", part_received_date: today() }));
  }

  // Mirror matching is when a part gets put away, so pick its cart at the same time.
  function mirrorSheet() {
    const n = selected.size;
    const ro = String(groupRows()[0]?.parts_ro_number || "").trim();
    const mine = locations.filter((l) => l.kind === "cart" && (l.ros || []).map(String).includes(ro));
    const empty = locations.filter((l) => l.kind === "cart" && !(l.ros || []).length);
    const storage = locations.filter((l) => l.kind !== "cart");
    const opt = (l) => `<option value="${esc(l.id)}">${esc(l.name)} · ${esc(l.zone || "")}</option>`;
    const current = groupRows().find((r) => r.part_location && mine.some((l) => l.id === r.part_location))?.part_location || mine[0]?.id || "";
    const s = sheet(`<h3>Mirror match ${n} part${n === 1 ? "" : "s"}</h3>
      <label class="field"><span>Put on cart</span><select class="input" id="pMirrorCart">
        <option value="">Don't place yet</option>
        ${mine.length ? `<optgroup label="Already holding RO ${esc(ro)}">${mine.map(opt).join("")}</optgroup>` : ""}
        ${empty.length ? `<optgroup label="Empty carts">${empty.map(opt).join("")}</optgroup>` : ""}
        ${storage.length ? `<optgroup label="Other storage">${storage.map(opt).join("")}</optgroup>` : ""}
      </select></label>
      <label class="field"><span>Shelf (optional)</span><select class="input" id="pMirrorShelf"></select></label>
      ${!mine.length && !empty.length ? '<p class="hint">No empty carts right now. Add one under Locations.</p>' : ""}
      <button class="btn btn-primary" data-confirm>Mirror matched</button><button class="btn btn-ghost" data-close>Cancel</button>`,
      async () => {
        const loc = $("pMirrorCart").value || null;
        const patch = { part_mirror_matched: "Yes" };
        if (loc) { patch.part_location = loc; patch.part_shelf = $("pMirrorShelf").value || null; }
        await bulk(patch);
      });
    const sync = () => { $("pMirrorShelf").innerHTML = '<option value="">Sort later</option>' + shelvesOf(locations.find((l) => l.id === $("pMirrorCart").value)).map((x) => `<option value="${x}">${shelfName(x)}</option>`).join(""); };
    $("pMirrorCart").value = current; sync();
    $("pMirrorCart").onchange = sync;
    return s;
  }

  // Same fields as "Edit selected" in the office program: only ticked fields change.
  function bulkEditSheet() {
    const n = selected.size;
    const fields = [
      ["part_status", "Status", STATUSES], ["part_vendor", "Vendor"], ["part_assigned_to", "Assigned to"], ["part_eta", "ETA", null, "date"],
      ["part_notes", "Notes"], ["part_mirror_matched", "Mirror matched", ["No", "Yes"]], ["part_return_needed", "Return needed", ["No", "Yes"]],
      ["part_credit_needed", "Credit needed", ["No", "Yes"]], ["has_core", "Has a core", ["Yes", "No"]], ["core_returned", "Core returned", ["Yes", "No"]],
    ];
    sheet(`<h3>Edit ${n} part${n === 1 ? "" : "s"}</h3><p class="hint">Only the fields you tick will change.</p>
      ${fields.map(([k, label, list, type]) => `<div class="bulk-field"><label class="toggle-row"><input type="checkbox" data-apply="${k}"> Change ${esc(label.toLowerCase())}</label>
        ${list ? `<select class="input" data-val="${k}">${opts(list)}</select>` : `<input class="input" data-val="${k}" type="${type || "text"}">`}</div>`).join("")}
      <button class="btn btn-primary" data-confirm>Save changes</button><button class="btn btn-ghost" data-close>Cancel</button>`,
      async (back) => {
        const patch = {};
        back.querySelectorAll("[data-apply]:checked").forEach((c) => {
          const k = c.dataset.apply, v = back.querySelector(`[data-val="${k}"]`).value;
          patch[k] = ["has_core", "core_returned"].includes(k) ? v === "Yes" : v;
        });
        if (!Object.keys(patch).length) throw Error("Tick at least one field to change.");
        await bulk(patch);
      });
  }

  function deleteSheet() {
    const n = selected.size;
    sheet(`<h3>Delete ${n} part${n === 1 ? "" : "s"}?</h3><p class="hint">This can't be undone.</p>
      <button class="btn btn-deny" data-confirm>Delete</button><button class="btn btn-ghost" data-close>Cancel</button>`,
      () => bulk(null, "delete"));
  }

  // ---------------------------------------------------------------- Add / edit one part
  function openEdit(id, back, preset) {
    editing = id ? parts.find((p) => p.id === id) : null;
    if (id && !editing) return;
    editBack = back || "group";
    const p = editing || { part_type: "OEM", part_status: "Need to Order", part_priority: "Normal", part_mirror_matched: "No", part_return_needed: "No", part_credit_needed: "No", part_qty: 1, ...(preset || {}) };
    $("peditTitle").textContent = editing ? "Edit part" : "Add a part";
    showAlert("peditError", "");
    const f = (k) => $("pe_" + k);
    for (const k of ["parts_ro_number", "parts_customer_name", "parts_vehicle", "part_description", "part_vendor", "part_cost", "part_qty", "part_assigned_to", "part_notes"]) f(k).value = p[k] ?? "";
    for (const k of ["part_ordered_date", "part_eta", "part_received_date", "part_last_follow_up"]) f(k).value = day(p[k]);
    f("part_type").innerHTML = opts(TYPES, p.part_type);
    f("part_status").innerHTML = opts(STATUSES, p.part_status);
    f("part_priority").innerHTML = opts(PRIORITIES, p.part_priority);
    for (const k of ["part_mirror_matched", "part_return_needed", "part_credit_needed"]) f(k).innerHTML = opts(["No", "Yes"], p[k] || "No");
    f("has_core").checked = p.has_core === true;
    f("core_returned").checked = p.core_returned === true;
    // A group edit can't change which vehicle a part belongs to; a single edit can (same as the office).
    f("part_location").innerHTML = '<option value="">Not placed yet</option>' + locations.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}${l.kind === "cart" && (l.ros || []).length ? " — RO " + esc(l.ros.join(" / ")) : ""}</option>`).join("");
    f("part_location").value = p.part_location || "";
    syncEditShelf(p.part_shelf || "");
    $("peditDelete").hidden = !editing || !canDelete();
    renderEditPhoto();
    showScreen("pedit");
  }

  // ---------------------------------------------------------------- Part photos
  function renderEditPhoto() {
    const box = $("pePhotoBox");
    box.hidden = !editing;
    if (!editing) return;
    box.innerHTML = `${editing.photo_url ? PartPhoto.thumb(editing.photo_url, editing.part_description || "Part", 84) : '<span class="pe-photo-empty">📷</span>'}
      <div><b>${editing.photo_url ? "Part photo" : "No photo yet"}</b><small class="hint" style="display:block">Techs see it in the app so they know what they're looking for.</small>
      <span class="photo-btn" role="button" data-pphoto="${esc(editing.id)}">📷 ${editing.photo_url ? "Retake" : "Take photo"}</span>${editing.photo_url ? ' <span class="photo-btn" role="button" data-pphoto-remove>Remove</span>' : ""}</div>`;
  }
  async function takePhoto(id) {
    try {
      const url = await PartPhoto.take(id);
      if (!url) return;
      await reloadParts();
      toast("Photo saved ✓");
      if (editing && editing.id === id) { editing = parts.find((p) => p.id === id) || editing; renderEditPhoto(); }
      if ($("screen-pgroup").classList.contains("active")) renderGroup();
    } catch (err) { toast(err.message); }
  }
  async function removePhoto(id) {
    if (!id) return;
    try {
      await PartPhoto.remove(id);
      await reloadParts();
      editing = parts.find((p) => p.id === id) || editing;
      renderEditPhoto();
      toast("Photo removed ✓");
    } catch (err) { toast(err.message); }
  }

  function syncEditShelf(cur) {
    const loc = locations.find((l) => l.id === $("pe_part_location").value);
    const shelves = shelvesOf(loc);
    $("pe_shelfWrap").hidden = !shelves.length;
    $("pe_part_shelf").innerHTML = '<option value="">No shelf yet</option>' + shelves.map((s) => `<option value="${s}">${shelfName(s)}</option>`).join("");
    $("pe_part_shelf").value = cur !== undefined ? cur : "";
  }

  async function saveEdit() {
    showAlert("peditError", "");
    const v = (k) => $("pe_" + k).value.trim();
    const body = {};
    for (const k of ["parts_ro_number", "parts_customer_name", "parts_vehicle", "part_description", "part_type", "part_vendor", "part_status", "part_priority",
      "part_ordered_date", "part_eta", "part_received_date", "part_mirror_matched", "part_return_needed", "part_credit_needed", "part_assigned_to", "part_last_follow_up", "part_notes"]) body[k] = v(k);
    body.part_cost = v("part_cost") || null;
    body.part_qty = v("part_qty") || 1;
    body.part_location = v("part_location") || null;
    body.part_shelf = body.part_location ? v("part_shelf") || null : null;
    body.has_core = $("pe_has_core").checked;
    body.core_returned = $("pe_core_returned").checked;
    if (!body.parts_ro_number) return showAlert("peditError", "Enter the RO number.");
    if (!body.part_description) return showAlert("peditError", "Describe the part.");
    const btn = $("peditSave");
    btn.disabled = true;
    try {
      const saved = editing
        ? await apiRequest(`/parts/${editing.id}`, { method: "PUT", body: JSON.stringify({ ...body, expected_updated_at: editing.updated_at }) })
        : await apiRequest("/parts", { method: "POST", body: JSON.stringify(body) });
      await reloadParts();
      toast("Part saved ✓");
      if (editBack === "group" || !editing) openGroup(groupKeyOf(saved), ["job", "desk"].includes(editBack) ? editBack : undefined);
      else goBack(editBack);
    } catch (err) { showAlert("peditError", err.message); }
    finally { btn.disabled = false; }
  }

  function deleteOne() {
    if (!editing) return;
    const p = editing;
    sheet(`<h3>Delete this part?</h3><div class="row-card"><b translate="no">${esc(p.part_description || "Part")}</b><small translate="no">RO ${esc(p.parts_ro_number || "")}</small></div>
      <button class="btn btn-deny" data-confirm>Delete</button><button class="btn btn-ghost" data-close>Cancel</button>`,
      async () => {
        await apiRequest(`/parts/${p.id}`, { method: "DELETE" });
        await reloadParts();
        toast("Part deleted ✓");
        goBack(editBack);
      });
  }

  // ---------------------------------------------------------------- Carts & shelves
  async function openCarts() {
    showScreen("pcarts");
    $("pcartsList").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try { await reloadParts(); renderCarts(); }
    catch (err) { $("pcartsList").innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  // Received / mirror-matched parts for cars in the shop that aren't put away yet.
  const trayParts = () => parts.filter((p) => ["Received", "Mirror Matched"].includes(p.part_status) && !p.part_location && jobOnsite(jobFor(p)));
  const roOf = (id) => String(parts.find((p) => p.id === id)?.parts_ro_number || "").trim();
  function pickTray(id) {
    if (trayPicked.has(id)) trayPicked.delete(id);
    else { for (const x of [...trayPicked]) if (roOf(x) !== roOf(id)) trayPicked.delete(x); trayPicked.add(id); }
    renderCarts();
  }
  function pickTrayRo(ro) {
    const ids = trayParts().filter((p) => String(p.parts_ro_number || "").trim() === ro).map((p) => p.id);
    const all = ids.every((id) => trayPicked.has(id));
    trayPicked.clear();
    if (!all) ids.forEach((id) => trayPicked.add(id));
    renderCarts();
  }

  // Every part the RO still needs is in and on one of its carts (same rule as the office,
  // client/partsUi.js allPartsHere). Returns and credits don't count.
  function allPartsHere(ro) {
    const carts = new Set(locations.filter((l) => l.kind === "cart" && cartRos(l).includes(ro)).map((l) => l.id));
    const needed = parts.filter((p) => String(p.parts_ro_number || "").trim() === ro && !DONE.includes(p.part_status) && !["Return Needed", "Credit Pending"].includes(p.part_status));
    return needed.length > 0 && needed.every((p) => ["Received", "Mirror Matched"].includes(p.part_status) && carts.has(p.part_location));
  }
  function cartCar(l, here, ros) {
    if (l.kind !== "cart" || !ros.length || !here.length) return "";
    const jobs = here.map(jobFor).filter(Boolean);
    if (jobs.length === here.length && jobs.every((j) => ["Delivered", "Total Loss"].includes(j.current_stage))) return "gone";
    if (!jobs.some(jobOnsite)) return "";
    return ros.every(allPartsHere) ? "complete" : "here";
  }

  function tile(l) {
    const here = parts.filter((p) => onsite(p) && p.part_location === l.id);
    const ros = l.kind === "cart" ? cartRos(l) : [...new Set(here.map((p) => String(p.parts_ro_number || "").trim()).filter(Boolean))];
    const shelves = shelvesOf(l), used = new Set(here.map((p) => p.part_shelf).filter((s) => shelves.includes(s))).size;
    const unshelved = l.kind === "cart" ? here.filter((p) => !p.part_shelf || !shelves.includes(p.part_shelf)).length : 0;
    const car = cartCar(l, here, ros);
    const name = l.kind === "cart" ? cartNum(l.name) : l.name;
    return `<button class="inv-tile ${here.length || (l.kind === "cart" && ros.length) ? "in-use" : "free"} ${l.kind === "cart" ? "" : "storage"} ${car === "complete" ? "complete" : ""}" data-pcart="${esc(l.id)}">
      <span class="inv-kind">${l.kind === "cart" ? "Cart" : "Storage"}</span><span class="inv-num ${name.length > 5 ? "long" : ""}" translate="no">${esc(name)}</span>
      <span class="inv-ro" translate="no">${ros.length ? "RO " + esc(ros.slice(0, 2).join(", ")) + (ros.length > 2 ? ` +${ros.length - 2}` : "") : "Empty"}</span>
      <span class="inv-count"><b>${here.length}</b> ${here.length === 1 ? "part" : "parts"}</span>
      ${shelves.length ? `<span class="inv-fill"><i style="width:${Math.round((used / shelves.length) * 100)}%"></i></span>` : ""}
      ${car === "gone" ? '<span class="inv-flag bad">Car delivered · clear cart</span>' : car === "complete" ? '<span class="inv-flag good">✓\u00a0All parts here</span>' : car === "here" ? '<span class="inv-flag good">Car in shop</span>' : ""}${car !== "gone" && unshelved ? `<span class="inv-flag">${unshelved} need a shelf</span>` : ""}</button>`;
  }

  function renderCarts() {
    const tray = trayParts();
    for (const id of [...trayPicked]) if (!tray.some((p) => p.id === id)) trayPicked.delete(id);
    const byRo = new Map();
    for (const p of tray) { const ro = String(p.parts_ro_number || "").trim(); if (!byRo.has(ro)) byRo.set(ro, []); byRo.get(ro).push(p); }
    const trayHtml = tray.length ? `<details class="tray-box" ${trayPicked.size ? "open" : ""}><summary><span class="eyebrow">Needs a home</span><b>${plural(tray.length, "part")} received, not put away</b><small>Tap an RO to pick all its parts, or tap parts one by one. Then Put away.</small></summary>
      ${[...byRo].map(([ro, list]) => `<div class="tray-ro ${list.every((p) => trayPicked.has(p.id)) ? "on" : ""}"><button class="tray-ro-head" data-ptray-ro="${esc(ro)}"><span class="box"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><b translate="no">RO ${esc(ro)}</b><small translate="no">${esc(String(list[0].parts_vehicle || "").split(" / ")[0])} · ${list.length}</small></button>
        ${list.map((p) => `<button class="tray-part ${trayPicked.has(p.id) ? "on" : ""}" data-ptray="${esc(p.id)}"><span class="box"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span translate="no">${esc(p.part_description || "Part")}</span></button>`).join("")}</div>`).join("")}</details>`
      : '<div class="tray-box empty-tray">Nothing waiting to be put away.</div>';
    const zones = [...new Set(locations.map((l) => l.zone))].sort((a, b) => (locations.some((l) => l.zone === b && l.kind === "cart") - locations.some((l) => l.zone === a && l.kind === "cart")) || String(a || "").localeCompare(String(b || "")));
    const sortN = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
    $("pcartsList").innerHTML = trayHtml + (zones.length ? zones.map((z) => `<div class="eyebrow" translate="no">${esc(z)}</div><div class="inv-grid">${locations.filter((l) => l.zone === z).sort(sortN).map(tile).join("")}</div>`).join("") : '<div class="empty">No carts or locations yet. Add one under Locations.</div>');
    $("pTrayFoot").hidden = !trayPicked.size;
    $("pTrayPut").textContent = `Put away ${plural(trayPicked.size, "part")}`;
  }

  function pickCart(id) {
    if (cartPicked.has(id)) cartPicked.delete(id); else cartPicked.add(id);
    openCart(cartId);
  }
  // Several ticked parts to one shelf of this cart.
  function moveManySheet() {
    const loc = locations.find((l) => l.id === cartId), ids = [...cartPicked];
    if (!loc || !ids.length) return;
    const shelves = shelvesOf(loc), ro = roOf(ids[0]);
    sheet(`<h3>Move ${plural(ids.length, "part")}</h3><div class="eyebrow">To</div>
      <div class="choice-grid">${shelves.map((s) => `<button class="choice" data-confirm="${s}">${shelfName(s)}</button>`).join("")}</div>
      <button class="btn btn-ghost" style="margin-top:14px" data-close>Cancel</button>`,
      async (_, shelf) => { await bulkFor(ids, ro, { part_location: loc.id, part_shelf: shelf }); cartPicked.clear(); openCart(loc.id); });
  }

  function openCart(id) {
    if (id !== cartId) cartPicked.clear();
    cartId = id;
    const loc = locations.find((l) => l.id === id);
    if (!loc) return openCarts();
    $("pcartTitle").textContent = loc.kind === "cart" ? `Cart ${loc.name}` : loc.name;
    const here = parts.filter((p) => onsite(p) && p.part_location === loc.id);
    for (const x of [...cartPicked]) if (!here.some((p) => p.id === x)) cartPicked.delete(x);
    const card = (p) => `<div class="prow ${cartPicked.has(p.id) ? "on" : ""} ${rowClass(p)}"><button class="pbox" data-pcart-pick="${esc(p.id)}" aria-label="Select"><span class="box"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span></button>
      <button class="pbody" data-pmove="${esc(p.id)}"><div class="pbody-row">${PartPhoto.thumb(p.photo_url, p.part_description || "Part", 48)}<div><b translate="no">${esc(p.part_description || "Part")}</b>
      <small translate="no">RO ${esc(p.parts_ro_number || "")}${Number(p.part_qty || 1) > 1 ? " · Qty " + Number(p.part_qty) : ""}</small><div class="p-chips">${statusPill(p)}</div></div></div></button></div>`;
    const shelves = shelvesOf(loc);
    let body;
    if (loc.kind !== "cart") body = here.map(card).join("") || '<div class="empty">No parts here.</div>';
    else {
      // Parts placed on the cart during mirror match but not yet given a shelf.
      const unsorted = here.filter((p) => !p.part_shelf || !shelves.includes(p.part_shelf));
      body = (unsorted.length ? `<div class="eyebrow warn-text">Needs a shelf · ${unsorted.length}</div>${unsorted.map(card).join("")}` : "")
        + shelves.map((s) => { const on = here.filter((p) => p.part_shelf === s); return `<div class="shelf-block"><div class="shelf-label">${s === "Top" ? "Top · rarely used" : shelfName(s)}<span>${on.length}</span></div>${on.map(card).join("") || '<div class="shelf-empty">Empty</div>'}</div>`; }).join("");
    }
    const ros = loc.kind === "cart" ? cartRos(loc) : [];
    $("pcartDetail").innerHTML = `<div class="cart-hero"><span class="inv-kind">${loc.kind === "cart" ? "Cart" : esc(loc.zone || "Storage")}</span><span class="inv-num" translate="no">${esc(loc.kind === "cart" ? cartNum(loc.name) : loc.name)}</span>
      <b class="inv-ro" translate="no">${ros.length ? "RO " + esc(ros.join(" / ")) : loc.kind === "cart" ? "Empty" : ""}</b><small>${plural(here.length, "part")}${loc.kind === "cart" ? " · tick parts and Move to shelf, or tap one" : ""}</small></div>${body}`;
    $("pCartFoot").hidden = !cartPicked.size || loc.kind !== "cart";
    $("pCartMove").textContent = `Move ${plural(cartPicked.size, "part")} to a shelf`;
    showScreen("pcart");
  }

  // Phones can't drag between shelves, so tapping a part offers the shelves instead.
  function moveSheet(id) {
    const p = parts.find((x) => x.id === id), loc = locations.find((l) => l.id === cartId);
    if (!p || !loc) return;
    const shelves = shelvesOf(loc);
    sheet(`<h3 translate="no">${esc(p.part_description || "Part")}</h3><small class="hint" translate="no">RO ${esc(p.parts_ro_number || "")} · ${esc(whereOf(p))}</small>
      ${shelves.length ? `<div class="eyebrow">Move to</div><div class="choice-grid">${shelves.map((s) => `<button class="choice ${p.part_shelf === s ? "on" : ""}" data-confirm="${s}">${shelfName(s)}</button>`).join("")}</div>` : ""}
      <button class="btn btn-ghost" style="margin-top:14px" data-confirm="edit">Open part</button><button class="btn btn-ghost" data-close>Close</button>`,
      async (_, shelf) => {
        if (shelf === "edit") return openEdit(p.id, "cart");
        if (shelf === p.part_shelf) return;
        await apiRequest(`/parts/${p.id}`, { method: "PUT", body: JSON.stringify({ part_location: loc.id, part_shelf: shelf, expected_updated_at: p.updated_at }) });
        await reloadParts();
        toast(`Moved to ${shelfName(shelf)} ✓`);
        openCart(loc.id);
      });
  }

  // ---------------------------------------------------------------- Returns & alerts
  async function openReturns() {
    showScreen("preturns");
    $("preturnsBody").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try { await reloadParts(); renderReturns(); }
    catch (err) { $("preturnsBody").innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  function renderReturns() {
    const here = parts.filter(onsite);
    const sum = (rows) => money(rows.reduce((s, p) => s + value(p), 0));
    const awaiting = here.filter((p) => p.part_status === "Return Needed");
    const credits = parts.filter((p) => p.part_status === "Credit Pending");
    const aging = here.filter((p) => (ageDays(p) ?? -1) >= 25).sort((a, b) => ageDays(b) - ageDays(a));
    const cores = parts.filter((p) => p.has_core && !p.core_returned && p.part_status !== "Complete");
    const returns = parts.filter((p) => ["Return Needed", "Returned", "Credit Pending"].includes(p.part_status));
    const row = (p, extra) => `<button class="row-card part-card" data-pedit-from="returns" data-pid="${esc(p.id)}"><b translate="no">${esc(p.part_description || "Part")}</b>
      <small translate="no">RO ${esc(p.parts_ro_number || "")} · ${esc(p.parts_vehicle || "")}</small><div>${extra}</div></button>`;
    $("preturnsBody").innerHTML = `<div class="stat-grid">
        <div class="stat"><small>On-site value</small><b>${sum(here)}</b><small>${here.length} part${here.length === 1 ? "" : "s"} in storage</small></div>
        <div class="stat"><small>Awaiting return</small><b>${sum(awaiting)}</b><small>Included in on-site value</small></div>
        <div class="stat"><small>Credits outstanding</small><b>${sum(credits)}</b><small>Returned, not on site</small></div>
        <div class="stat ${aging.length ? "bad" : ""}"><small>25+ days on site</small><b>${aging.length}</b><small>Review return eligibility</small></div>
      </div>
      <div class="eyebrow">Needs attention · 25+ days</div>
      ${aging.map((p) => row(p, `<div class="where" translate="no">📍 ${esc(whereOf(p) || "Not placed")}</div><span class="pill bad">${ageDays(p)} days</span> <span class="pill">${money(value(p))}</span>`)).join("") || '<div class="empty">Nothing overdue right now.</div>'}
      <div class="eyebrow">Core returns due · ${cores.length}</div>
      ${cores.map((p) => row(p, `<span class="pill warn">Core return due</span> <span class="pill">${esc(p.part_status || "")}</span>`)).join("") || '<div class="empty">No cores waiting to go back.</div>'}
      <div class="eyebrow">Return &amp; credit tracking</div>
      ${returns.map((p) => row(p, `<span class="pill ${p.part_status === "Returned" ? "" : "bad"}">${esc(p.part_status)}</span> <span class="pill">${money(value(p))}</span>${p.part_notes ? `<small style="display:block;margin-top:6px" translate="no">${esc(p.part_notes)}</small>` : ""}`)).join("") || '<div class="empty">No returns or credits in progress.</div>'}`;
  }

  // ---------------------------------------------------------------- Manage locations
  async function openLocations() {
    showScreen("plocs");
    $("plocsList").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try { await reloadParts(); renderLocations(); }
    catch (err) { $("plocsList").innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  function renderLocations() {
    const rows = locations.slice().sort((a, b) => String(a.zone || "").localeCompare(String(b.zone || "")) || String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }));
    $("plocsList").innerHTML = rows.map((l) => `<button class="row-card part-card" data-ploc="${esc(l.id)}"><b translate="no">${esc(l.name)}</b>
      <small translate="no">${l.kind === "cart" ? `Cart · ${l.shelf_count || 0} shelves${l.has_top ? " + top" : ""}` : "Storage"} · ${esc(l.zone || "")}</small>
      ${(l.ros || []).length ? `<span class="pill" translate="no">RO ${esc(l.ros.join(" / "))}</span>` : l.kind === "cart" ? '<span class="pill ok">Available</span>' : ""}</button>`).join("")
      || '<div class="empty">No carts or storage locations yet.</div>';
  }

  function openLocation(id) {
    editingLoc = id ? locations.find((l) => l.id === id) : null;
    const l = editingLoc || { kind: "cart", shelf_count: 5, has_top: true, ros: [] };
    $("plocTitle").textContent = editingLoc ? `Edit ${editingLoc.name}` : "Add a location";
    showAlert("plocError", "");
    $("pl_kind").value = l.kind;
    $("pl_name").value = l.name || "";
    $("pl_zone").value = l.zone || "";
    $("pl_shelf_count").value = l.shelf_count || 5;
    $("pl_has_top").checked = l.has_top === true;
    $("pl_ros").value = (l.ros || []).join(", ");
    $("pl_same_car").checked = false;
    syncLocKind();
    $("plocDelete").hidden = !editingLoc || !canDelete();
    showScreen("ploc");
  }

  function syncLocKind() {
    $("pl_cartFields").hidden = $("pl_kind").value !== "cart";
  }

  async function saveLocation() {
    showAlert("plocError", "");
    const kind = $("pl_kind").value;
    const body = {
      kind, name: $("pl_name").value.trim(), zone: $("pl_zone").value.trim(),
      shelf_count: kind === "cart" ? Number($("pl_shelf_count").value || 0) : null,
      has_top: kind === "cart" ? $("pl_has_top").checked : false,
      ros: kind === "cart" ? $("pl_ros").value.split(",").map((s) => s.trim()).filter(Boolean) : [],
      confirm_same_car: $("pl_same_car").checked,
    };
    const btn = $("plocSave");
    btn.disabled = true;
    try {
      if (editingLoc) await apiRequest(`/inventoryLocations/${editingLoc.id}`, { method: "PUT", body: JSON.stringify({ ...body, expected_updated_at: editingLoc.updated_at }) });
      else await apiRequest("/inventoryLocations", { method: "POST", body: JSON.stringify(body) });
      toast("Location saved ✓");
      openLocations();
    } catch (err) { showAlert("plocError", err.message); }
    finally { btn.disabled = false; }
  }

  function deleteLocation() {
    const l = editingLoc;
    if (!l) return;
    sheet(`<h3>Delete ${esc(l.name)}?</h3><p class="hint">Only empty locations can be deleted.</p>
      <button class="btn btn-deny" data-confirm>Delete</button><button class="btn btn-ghost" data-close>Cancel</button>`,
      async () => { await apiRequest(`/inventoryLocations/${l.id}`, { method: "DELETE" }); toast("Location deleted ✓"); openLocations(); });
  }

  // ---------------------------------------------------------------- From a vehicle in the shop
  // The vehicle screen's Parts list gets a "Manage parts" button for parts staff.
  async function openForJob(job) {
    const ro = String(job.ro_number || "").trim(), est = String(job.ccc_estfile_id || "").trim();
    try { await load(); } catch (err) { return toast(err.message); }
    const key = parts.some((p) => groupKeyOf(p) === ro) ? ro : est && parts.some((p) => groupKeyOf(p) === est) ? est : null;
    if (key) return openGroup(key, "job");
    openEdit(null, "job", { parts_ro_number: ro, parts_customer_name: job.customer_name || "", parts_vehicle: String(job.vehicle || "").split(" / ")[0] });
  }

  function goBack(to) {
    if (to === "home") return enterHome();
    if (to === "job") { renderJob(); return showScreen("job"); }
    if (to === "desk") return openDesk();
    if (to === "group") return groupKey && groupRows().length ? (renderGroup(), showScreen("pgroup")) : openDesk();
    if (to === "carts") return openCarts();
    if (to === "cart") return cartId ? openCart(cartId) : openCarts();
    if (to === "returns") return openReturns();
    if (to === "locs") return openLocations();
  }

  // ---------------------------------------------------------------- Wiring
  function syncEntry() {
    const on = !!authToken && canUse();
    $("partsDeskBtn").hidden = !on;
    $("partsManageBtn").hidden = !on;
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("partsDeskBtn").onclick = openDesk;
    $("partsManageBtn").onclick = () => activeJob && openForJob(activeJob);
    $("pdeskSearch").addEventListener("input", renderDesk);
    $("pProblemsOnly").addEventListener("change", (e) => { problemsOnly = e.target.checked; selected = new Set(); renderGroup(); });
    $("pgroupSearch").addEventListener("input", (e) => { groupSearch = e.target.value; selected = new Set(); renderGroup(); });
    $("pe_part_location").addEventListener("change", () => syncEditShelf(""));
    $("pl_kind").addEventListener("change", syncLocKind);
    $("peditSave").onclick = saveEdit;
    $("peditDelete").onclick = deleteOne;
    $("plocSave").onclick = saveLocation;
    $("plocDelete").onclick = deleteLocation;
    $("pTrayPut").onclick = () => putAwaySheet([...trayPicked], () => { trayPicked.clear(); renderCarts(); });
    $("pCartMove").onclick = moveManySheet;
    $("pAddToGroup").onclick = () => {
      const f = groupRows()[0] || {};
      openEdit(null, "group", { parts_ro_number: f.parts_ro_number || "", parts_customer_name: f.parts_customer_name || "", parts_vehicle: f.parts_vehicle || "" });
    };
    document.addEventListener("click", (e) => {
      const t = e.target;
      const v = t.closest("[data-pview]");
      if (v) { view = v.dataset.pview; return renderDesk(); }
      const g = t.closest("[data-pgroup]");
      if (g) return openGroup(g.dataset.pgroup, "desk");
      if (t.closest(".part-thumb")) return;
      const ph = t.closest("[data-pphoto]");
      if (ph) return takePhoto(ph.dataset.pphoto);
      if (t.closest("[data-pphoto-remove]")) return removePhoto(editing && editing.id);
      const s = t.closest("[data-psel]");
      if (s) return toggleSelect(s.dataset.psel);
      const ed = t.closest("[data-pedit]");
      if (ed) return openEdit(ed.dataset.pedit, "group");
      const edFrom = t.closest("[data-pedit-from]");
      if (edFrom) return openEdit(edFrom.dataset.pid, edFrom.dataset.peditFrom);
      const pk = t.closest("[data-ppick]");
      if (pk) return pick(pk.dataset.ppick);
      const act = t.closest("[data-pact]");
      if (act) return ({ order: orderSheet, receive: receiveSheet, mirror: mirrorSheet, putaway: () => putAwaySheet([...selected], () => { selected = new Set(); renderGroup(); }), edit: bulkEditSheet, delete: deleteSheet })[act.dataset.pact]();
      const tt = t.closest("[data-ptoday]");
      if (tt) { todayLane = tt.dataset.ptoday; todayAll = false; return renderToday(); }
      if (t.closest("[data-ptoday-all]")) { todayAll = !todayAll; return renderToday(); }
      const oc = t.closest("[data-porder-car]");
      if (oc) return orderCarSheet(oc.dataset.porderCar);
      const orr = t.closest("[data-popen-ro]");
      if (orr) return openGroup(orr.dataset.popenRo, "desk");
      const fu = t.closest("[data-pfollow]");
      if (fu) { const p = parts.find((x) => x.id === fu.dataset.pfollow); return p && saveOne(p, { part_last_follow_up: today() }, "Follow-up logged ✓").then(renderDesk, (err) => toast(err.message)); }
      const ne = t.closest("[data-pneweta]");
      if (ne) return newEtaSheet(ne.dataset.pneweta);
      const rc = t.closest("[data-preceive]");
      if (rc) { const p = parts.find((x) => x.id === rc.dataset.preceive); return p && saveOne(p, { part_status: "Received", part_received_date: today() }, "Received ✓ Mirror match it, then put it away.").then(renderDesk, (err) => toast(err.message)); }
      const tp = t.closest("[data-ptray]");
      if (tp) return pickTray(tp.dataset.ptray);
      const tr = t.closest("[data-ptray-ro]");
      if (tr) return pickTrayRo(tr.dataset.ptrayRo);
      const cp = t.closest("[data-pcart-pick]");
      if (cp) return pickCart(cp.dataset.pcartPick);
      const go = t.closest("[data-pgo]");
      if (go) return ({ desk: openDesk, carts: openCarts, returns: openReturns, locs: openLocations, newpart: () => openEdit(null, "desk"), newloc: () => openLocation(null) })[go.dataset.pgo]();
      const c = t.closest("[data-pcart]");
      if (c) return openCart(c.dataset.pcart);
      const m = t.closest("[data-pmove]");
      if (m) return moveSheet(m.dataset.pmove);
      const l = t.closest("[data-ploc]");
      if (l) return openLocation(l.dataset.ploc);
      const back = t.closest("[data-pback]");
      if (back) return goBack(back.dataset.pback === "edit" ? editBack : back.dataset.pback);
      const gb = t.closest("[data-pgroup-back]");
      if (gb) return goBack(groupBack);
    });
    // The account (and its role) loads in mobile.js; show the entry points once it has.
    syncEntry();
    new MutationObserver(syncEntry).observe($("screen-home"), { attributes: true, attributeFilter: ["class"] });
    new MutationObserver(syncEntry).observe($("screen-parts"), { attributes: true, attributeFilter: ["class"] });
  });
})();
