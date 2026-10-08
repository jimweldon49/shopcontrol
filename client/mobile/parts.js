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

  const role = () => String((currentUser && currentUser.role) || "").toLowerCase();
  const canUse = () => PARTS_ROLES.includes(role());
  const canDelete = () => !!(currentUser && currentUser.canDelete);
  const money = (n) => ShopModel.money(n);
  const opts = (list, cur) => list.map((v) => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
  const day = (d) => String(d || "").slice(0, 10);
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  // ---------------------------------------------------------------- Rules (same as the office Parts tab)
  const groupKeyOf = (p) => String(p.parts_ro_number || "").trim() || [p.parts_customer_name || "", p.parts_vehicle || ""].join("||");
  const isLate = (p) => !!p.part_eta && day(p.part_eta) < today() && !["Received", "Mirror Matched", "Complete", "Returned"].includes(p.part_status);
  function problemOf(p) {
    if (p.part_status === "Complete") return null;
    if (isLate(p)) return "Not arrived by ETA";
    if (["Need to Order", ...BAD_STATUSES].includes(p.part_status)) return p.part_status;
    if (p.part_status === "Received" && p.part_mirror_matched !== "Yes") return "Not mirror matched";
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
      mirror: rows.filter((r) => r.part_status === "Received" && r.part_mirror_matched !== "Yes").length,
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
  const visibleRows = () => (problemsOnly ? groupRows().filter(problemOf) : groupRows());

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
    $("pdeskCount").textContent = `${groups.length} vehicle${groups.length === 1 ? "" : "s"}`;
    $("pdeskList").innerHTML = groups.length ? groups.map((g) => {
      const counts = [g.s.needOrder && `${g.s.needOrder} to order`, g.s.waiting && `${g.s.waiting} waiting`, g.s.mirror && `${g.s.mirror} to mirror match`, g.s.returns && `${g.s.returns} return/credit`].filter(Boolean).join(" · ");
      return `<button class="car" data-pgroup="${esc(g.key)}"><div class="body">
        <div class="ro" translate="no">${g.first.parts_ro_number ? "RO " + esc(g.first.parts_ro_number) : "No RO"}</div>
        <div class="name" translate="no">${esc(g.first.parts_vehicle || "Vehicle")}</div>
        <div class="sub" translate="no">${esc(g.first.parts_customer_name || "")}</div>
        <div class="sub">${g.s.open} open of ${g.s.total}${counts ? " · " + counts : ""}</div>
        ${g.s.problems ? `<span class="pill bad">${g.s.problems} problem${g.s.problems === 1 ? "" : "s"}</span>` : g.s.open ? "" : '<span class="pill ok">Complete</span>'}
      </div><span class="arrow-muted">›</span></button>`;
    }).join("") : '<div class="empty">No vehicles match.</div>';
  }

  // ---------------------------------------------------------------- One vehicle's parts
  function openGroup(key, back) {
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
      const facts = [p.part_type, p.part_vendor, Number(p.part_qty || 1) > 1 ? "Qty " + Number(p.part_qty) : "", p.part_eta ? "ETA " + day(p.part_eta) : "", p.part_cost ? money(value(p)) : ""].filter(Boolean).join(" · ");
      return `<div class="prow ${on ? "on" : ""}">
        <button class="pbox" data-psel="${esc(p.id)}" aria-label="Select"><span class="box"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span></button>
        <button class="pbody" data-pedit="${esc(p.id)}">
          <b translate="no">${esc(p.part_description || "Part")}</b>
          <small translate="no">${esc(facts)}</small>
          ${p.part_status !== "Complete" ? `<div class="where ${where ? "" : "none"}" translate="no">📍 ${esc(where || "Not placed")}</div>` : ""}
          <span class="pill ${BAD_STATUSES.includes(p.part_status) || prob === p.part_status ? "bad" : ["Received", "Mirror Matched", "Complete"].includes(p.part_status) ? "ok" : ""}">${esc(p.part_status || "")}</span>
          ${prob && prob !== p.part_status ? `<span class="pill bad">${esc(prob)}</span>` : ""}
          ${p.part_mirror_matched === "Yes" ? '<span class="pill ok">Mirror matched</span>' : ""}
          ${p.has_core ? `<span class="pill ${p.core_returned ? "ok" : "warn"}">${p.core_returned ? "Core returned" : "Core return due"}</span>` : ""}
        </button></div>`;
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
    showScreen("pedit");
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

  function renderCarts() {
    const zones = [...new Set(locations.map((l) => l.zone))];
    $("pcartsList").innerHTML = zones.length ? zones.map((z) => `<div class="eyebrow" translate="no">${esc(z)}</div><div class="loc-grid">${locations.filter((l) => l.zone === z).map((l) => {
      const here = parts.filter((p) => onsite(p) && p.part_location === l.id).length;
      const ros = (l.ros || []).join(" / ");
      return `<button class="loc-tile ${l.kind === "cart" && ros ? "busy" : ""}" data-pcart="${esc(l.id)}"><b translate="no">${esc(l.name)}</b>
        <small translate="no">${ros ? "RO " + esc(ros) : l.kind === "cart" ? "Available" : "Other storage"}</small><small>${here} part${here === 1 ? "" : "s"}</small></button>`;
    }).join("")}</div>`).join("") : '<div class="empty">No carts or locations yet. Add one under Locations.</div>';
  }

  function openCart(id) {
    cartId = id;
    const loc = locations.find((l) => l.id === id);
    if (!loc) return openCarts();
    $("pcartTitle").textContent = loc.kind === "cart" ? `Cart ${loc.name}` : loc.name;
    const here = parts.filter((p) => onsite(p) && p.part_location === loc.id);
    const card = (p) => `<button class="row-card part-card" data-pmove="${esc(p.id)}"><b translate="no">${esc(p.part_description || "Part")}</b>
      <small translate="no">RO ${esc(p.parts_ro_number || "")}${Number(p.part_qty || 1) > 1 ? " · Qty " + Number(p.part_qty) : ""}</small></button>`;
    const shelves = shelvesOf(loc);
    let body;
    if (loc.kind !== "cart") body = here.map(card).join("") || '<div class="empty">No parts here.</div>';
    else {
      // Parts placed on the cart during mirror match but not yet given a shelf.
      const unsorted = here.filter((p) => !p.part_shelf || !shelves.includes(p.part_shelf));
      body = (unsorted.length ? `<div class="eyebrow warn-text">Needs a shelf · ${unsorted.length}</div>${unsorted.map(card).join("")}` : "")
        + shelves.map((s) => { const on = here.filter((p) => p.part_shelf === s); return `<div class="eyebrow">${s === "Top" ? "Top · rarely used" : shelfName(s)}</div>${on.map(card).join("") || '<div class="shelf-empty">Empty</div>'}`; }).join("");
    }
    $("pcartDetail").innerHTML = `<div class="row-card"><b translate="no">${esc(loc.name)}</b><small translate="no">${esc(loc.zone)}${(loc.ros || []).length ? " · RO " + esc(loc.ros.join(" / ")) : ""}</small>
      ${loc.kind === "cart" ? '<small style="display:block;margin-top:4px">Tap a part to move it to another shelf. One vehicle per cart.</small>' : ""}</div>${body}`;
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
    $("pe_part_location").addEventListener("change", () => syncEditShelf(""));
    $("pl_kind").addEventListener("change", syncLocKind);
    $("peditSave").onclick = saveEdit;
    $("peditDelete").onclick = deleteOne;
    $("plocSave").onclick = saveLocation;
    $("plocDelete").onclick = deleteLocation;
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
      const s = t.closest("[data-psel]");
      if (s) return toggleSelect(s.dataset.psel);
      const ed = t.closest("[data-pedit]");
      if (ed) return openEdit(ed.dataset.pedit, "group");
      const edFrom = t.closest("[data-pedit-from]");
      if (edFrom) return openEdit(edFrom.dataset.pid, edFrom.dataset.peditFrom);
      const pk = t.closest("[data-ppick]");
      if (pk) return pick(pk.dataset.ppick);
      const act = t.closest("[data-pact]");
      if (act) return ({ order: orderSheet, receive: receiveSheet, mirror: mirrorSheet, edit: bulkEditSheet, delete: deleteSheet })[act.dataset.pact]();
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
