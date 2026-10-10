// Office side of the customer status page (conceptautobody.app/update): the
// "Customer status page" panel in the job editor and the contact info admins set
// under Settings. API: /api/customer-portal (server/src/routes/portal.js).
const CustomerPortalAdmin = (() => {
  const STAFF_ROLES = ["office", "manager", "admin", "owner", "estimator"];
  const e = (v) => escapeHtml(v);
  const canUse = () => STAFF_ROLES.includes(String((currentUser && currentUser.role) || "").toLowerCase());

  // ---------------------------------------------------------------- Job panel
  // One panel per box: the job editor's #portalBox and the Customer Service tab's
  // #csPortalBox. Everything inside is looked up within its own box.
  function makePanel(boxId, onChange) {
    let job = null;
    let data = { url: null, updates: [] };
    const box = () => document.getElementById(boxId);
    const q = (name) => box().querySelector(`[data-p="${name}"]`);

    async function show(r) {
      const b = box();
      if (!b) return;
      job = r;
      b.hidden = !canUse() || !r || ShopModel.jobKind(r.roNumber) !== "active";
      if (b.hidden) return;
      b.innerHTML = '<p class="board-tip">Loading customer status page…</p>';
      try { data = await apiRequest(`/customer-portal/${r.id}`); }
      catch (err) { b.innerHTML = `<p class="board-tip">${e(err.message)}</p>`; return; }
      if (job === r) render();
    }

    function hide() {
      job = null;
      const b = box();
      if (b) { b.hidden = true; b.innerHTML = ""; }
    }

    function render() {
      const b = box();
      if (!b || !job) return;
      b.innerHTML = `
        <div class="heading-row"><h3>Customer status page${boxId === "portalBox" ? "" : ` · RO ${e(job.roNumber)}`}</h3>
          ${data.url ? `<a href="${e(data.url)}" target="_blank" rel="noopener" class="link-button">Open what the customer sees ↗</a>` : ""}</div>
        ${boxId === "portalBox" ? "" : `<p style="margin:4px 0 0"><b>${e(job.customerName)}</b> · ${e(job.vehicle || "")} · ${e(job.currentStage || "")}</p>`}
        <p class="board-tip" style="margin-top:6px">The customer sees this car's progress (no prices, notes or names) and the updates you post here. They can also look it up at conceptautobody.app/update with RO ${e(job.roNumber)} and their last name.</p>
        <div class="toolbar">
          ${data.url
            ? `<input data-p="url" readonly value="${e(data.url)}" style="flex:1;min-width:220px" aria-label="Customer link"><button type="button" data-p="copy">Copy customer link</button>`
            : `<button type="button" data-p="make">Create customer link</button>`}
        </div>
        <label class="wide" style="margin-top:12px">Post an update for the customer
          <textarea data-p="message" maxlength="1000" placeholder="e.g. Parts arrived today. We're starting body work tomorrow."></textarea></label>
        <div class="toolbar"><button type="button" data-p="post">Post update</button>
          <small class="board-tip" style="margin:0">Posting also sets Customer Updated to Yes.</small></div>
        <div>${data.updates.length ? data.updates.map((u) => `
          <div class="setting-row"><span><b>${e(formatDateTime(u.created_at))}</b> · ${e(u.created_by || "")}<br>${e(u.message)}</span>
            <button type="button" class="quiet" data-portal-remove="${e(u.id)}">Remove</button></div>`).join("") : '<p class="board-tip">No updates posted yet.</p>'}</div>`;
      if (q("copy")) q("copy").onclick = copyLink;
      if (q("make")) q("make").onclick = makeLink;
      q("post").onclick = post;
      b.querySelectorAll("[data-portal-remove]").forEach((btn) => (btn.onclick = () => remove(btn.dataset.portalRemove, btn)));
    }

    async function makeLink() {
      try {
        const r = await apiRequest(`/customer-portal/${job.id}/link`, { method: "POST" });
        data.url = r.url;
        render();
        await copyLink();
        if (onChange) onChange(job);
      } catch (err) { showStatus(err.message, true); }
    }

    async function copyLink() {
      const input = q("url");
      try { await navigator.clipboard.writeText(data.url); showStatus("Customer link copied. Paste it into a text or email to the customer."); }
      catch (_) { if (input) { input.focus(); input.select(); } showStatus("Press Ctrl+C to copy the selected link."); }
    }

    async function post() {
      const message = q("message").value.trim();
      if (!message) return showStatus("Write the update the customer will see.", true);
      const btn = q("post");
      btn.disabled = true;
      try {
        const r = await apiRequest(`/customer-portal/${job.id}/updates`, { method: "POST", body: JSON.stringify({ message }) });
        data.updates.unshift(r.update);
        // The job changed on the server; keep an open job editor in step so Save still works.
        if (document.getElementById("dailyId").value === job.id) {
          document.getElementById("customerUpdatedToday").value = "Yes";
          const stamp = document.getElementById("dailyExpectedUpdatedAt");
          stamp.value = r.job.updated_at;
          stamp.dataset.version = String(r.job.version);
        }
        Object.assign(job, { customerUpdatedToday: "Yes", customerUpdatedAt: r.job.customer_updated_at, updatedAt: r.job.updated_at, version: r.job.version });
        render();
        showStatus(data.url ? "Update posted. The customer sees it on their status page." : "Update posted. Create a customer link to share the status page.");
        if (onChange) onChange(job);
      } catch (err) { showStatus(err.message, true); }
      finally { btn.disabled = false; }
    }

    async function remove(id, btn) {
      if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = "Click again to remove"; return; }
      try {
        await apiRequest(`/customer-portal/updates/${id}`, { method: "DELETE" });
        data.updates = data.updates.filter((u) => u.id !== id);
        render();
        showStatus("Update removed from the customer's page.");
        if (onChange) onChange(job);
      } catch (err) { showStatus(err.message, true); }
    }

    return { show, hide, current: () => job };
  }

  const editorPanel = makePanel("portalBox", () => { if (isOpen()) loadSummary(); });

  // ---------------------------------------------------------------- Customer Service tab
  const CLOSED = ["Delivered", "Total Loss", "No Show"];
  let summary = new Map();   // jobId -> { url, lastUpdateAt, updateCount }
  let view = "needs";
  let search = "";
  let selectedId = null;
  const csPanel = makePanel("csPortalBox", () => { loadSummary(); });
  const isOpen = () => document.getElementById("customerService")?.classList.contains("active");

  const openJobs = () => store.get("daily").filter((j) => !j.mergedInto && ShopModel.jobKind(j.roNumber) === "active" && !CLOSED.includes(j.currentStage));
  const needs = (j) => typeof needsCustomerUpdate === "function" && needsCustomerUpdate(j);

  async function loadSummary() {
    try {
      const r = await apiRequest("/customer-portal");
      summary = new Map(r.jobs.map((x) => [x.jobId, x]));
    } catch (err) { showStatus(err.message, true); }
    renderTab();
  }

  function updateCounts() {
    const n = canUse() ? openJobs().filter(needs).length : 0;
    const label = n ? String(n) : "";
    const tabCount = document.getElementById("customerServiceCount");
    if (tabCount) tabCount.textContent = label;
    const groupCount = document.querySelector('.nav-group[data-group="customers"] .nav-group-count');
    if (groupCount) groupCount.textContent = label;
    const tab = document.querySelector('.tab[data-tab="customerService"]');
    if (tab) tab.style.display = canUse() ? "" : "none";
  }

  function renderTab() {
    updateCounts();
    const host = document.getElementById("customerService");
    if (!host || !isOpen()) return;
    if (!canUse()) { host.innerHTML = '<p class="board-tip">Only office staff can manage the customer status page.</p>'; return; }
    const all = openJobs();
    const onsite = all.filter((j) => j.onsite);
    const lists = { needs: all.filter(needs), onsite, all };
    const term = search.toLowerCase();
    const rows = lists[view].filter((j) => !term || [j.roNumber, j.customerName, j.vehicle].some((v) => String(v || "").toLowerCase().includes(term)))
      .sort((a, b) => String(a.roNumber).localeCompare(String(b.roNumber)));
    const linked = all.filter((j) => summary.get(j.id)?.url).length;
    const lastUpdate = (j) => {
      const s = summary.get(j.id);
      if (s && s.lastUpdateAt) return `Posted ${e(formatDateTime(s.lastUpdateAt))}<small>${s.updateCount} update${s.updateCount === 1 ? "" : "s"} on their page</small>`;
      return '<span class="board-tip" style="margin:0">Nothing posted yet</span>';
    };
    const focused = document.activeElement && document.activeElement.id === "csSearch";
    // The panel on the right is built once and only reloads when you pick another
    // car, so a background refresh never wipes an update someone is typing.
    if (!document.getElementById("csList")) {
      host.innerHTML = `
        <div class="section-head heading-row"><div><div class="eyebrow">CUSTOMER SERVICE</div><h2>Customer Status Page</h2>
          <p>Share each customer's private link to conceptautobody.app/update and post the updates they see. Customers can also look up their car with the RO number and their last name.</p></div></div>
        <div class="board-summary" id="csSummary"></div>
        <div class="cs-layout"><div id="csList"></div>
          <div class="card" id="csPortalBox"><p class="board-tip">Pick a car to share its link or post an update.</p></div></div>`;
    }
    document.getElementById("csSummary").innerHTML = `
        <div><small>Need an update today</small><b>${lists.needs.length}</b></div>
        <div><small>Cars in the shop</small><b>${onsite.length}</b></div>
        <div><small>Open ROs with a link</small><b>${linked}</b></div>
        <div><small>Open ROs without a link</small><b>${all.length - linked}</b></div>`;
    const list = document.getElementById("csList");
    list.innerHTML = `
          <div class="cs-filter toolbar">
            ${[["needs", `Need an update (${lists.needs.length})`], ["onsite", `In the shop (${onsite.length})`], ["all", `All open ROs (${all.length})`]]
              .map(([k, label]) => `<button type="button" class="${view === k ? "" : "quiet"}" aria-pressed="${view === k}" data-cs-view="${k}">${label}</button>`).join("")}
            <input id="csSearch" type="search" placeholder="Search RO, customer, vehicle" value="${e(search)}" aria-label="Search customer status list" style="flex:1;min-width:180px">
          </div>
          <div class="table-wrap"><table><thead><tr><th>RO</th><th>Customer / vehicle</th><th>Stage</th><th>Last update to customer</th><th></th></tr></thead><tbody>
          ${rows.map((j) => `<tr class="${j.id === selectedId ? "selected" : ""}">
            <td>${e(j.roNumber)}${needs(j) ? '<small class="late">Update due</small>' : ""}</td>
            <td>${e(j.customerName)}<small>${e(j.vehicle || "")}</small></td>
            <td>${e(j.currentStage || "")}<small>${j.onsite ? "In the shop" : "Not here yet"}</small></td>
            <td>${lastUpdate(j)}<small>${summary.get(j.id)?.url ? "Link shared" : "No link yet"}</small></td>
            <td><button type="button" ${j.id === selectedId ? "" : 'class="quiet"'} data-cs-open="${e(j.id)}">${j.id === selectedId ? "Selected" : "Manage"}</button></td>
          </tr>`).join("") || `<tr><td colspan="5">${view === "needs" ? "Every car in the shop is up to date." : "No open ROs match."}</td></tr>`}
          </tbody></table></div>
          <p class="board-tip">“Need an update” uses the same rule as the Dashboard's Customer Updates Needed count. Posting an update here marks the customer updated.</p>`;
    list.querySelectorAll("[data-cs-view]").forEach((b) => (b.onclick = () => { view = b.dataset.csView; renderTab(); }));
    const input = document.getElementById("csSearch");
    input.oninput = () => { search = input.value; renderTab(); };
    if (focused) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    list.querySelectorAll("[data-cs-open]").forEach((b) => (b.onclick = () => {
      selectedId = b.dataset.csOpen;
      const job = all.find((j) => j.id === selectedId);
      renderTab();
      if (job) csPanel.show(job);
    }));
  }

  document.addEventListener("click", (ev) => {
    if (ev.target.closest && ev.target.closest('.tab[data-tab="customerService"]')) setTimeout(loadSummary);
  });
  if (typeof renderAll === "function") {
    const originalRenderAll = renderAll;
    window.renderAll = function () { originalRenderAll.apply(this, arguments); renderTab(); };
  }

  // ---------------------------------------------------------------- Settings: shop contact info
  function settingsCard() {
    const host = document.getElementById("workspaceSettings");
    if (!host || typeof workspace === "undefined") return;
    const admin = ["admin", "owner"].includes(currentUser && currentUser.role);
    const c = workspace.settings.customerPortal || {};
    const card = document.createElement("div");
    card.className = "card";
    card.style.marginTop = "18px";
    card.innerHTML = `<h3>Customer status page</h3>
      <p class="board-tip">Shown to customers on conceptautobody.app/update, with Call and Text buttons.${admin ? "" : " An owner or admin can change these."}</p>
      <form id="portalContactForm" class="form-grid">
        <label>Shop phone<input name="phone" maxlength="40" value="${e(c.phone || "")}" placeholder="(209) 555-0100" ${admin ? "" : "disabled"}></label>
        <label>Number customers can text<input name="textPhone" maxlength="40" value="${e(c.textPhone || "")}" placeholder="Leave blank if you don't take texts" ${admin ? "" : "disabled"}></label>
        <label>Hours<input name="hours" maxlength="300" value="${e(c.hours || "")}" placeholder="Mon–Fri 8 AM–5 PM" ${admin ? "" : "disabled"}></label>
        <label class="wide">Address<input name="address" maxlength="300" value="${e(c.address || "")}" placeholder="Street, city" ${admin ? "" : "disabled"}></label>
        ${admin ? '<div class="wide form-actions"><button type="submit">Save contact info</button></div>' : ""}
      </form>`;
    host.append(card);
    const form = card.querySelector("form");
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const customerPortal = Object.fromEntries(["phone", "textPhone", "hours", "address"].map((k) => [k, String(f.get(k) || "").trim()]));
      try { await saveWorkspaceSettings({ ...workspace.settings, customerPortal }); showStatus("Customer status page contact info saved."); }
      catch (err) { showStatus(err.message, true); }
    };
  }

  // Add the contact card under the shared settings every time they render.
  if (typeof renderWorkspaceSettings === "function") {
    const original = renderWorkspaceSettings;
    window.renderWorkspaceSettings = function () { original.apply(this, arguments); settingsCard(); };
  }

  return { show: editorPanel.show, hide: editorPanel.hide, renderTab };
})();
