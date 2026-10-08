// Office side of the customer status page (conceptautobody.app/update): the
// "Customer status page" panel in the job editor and the contact info admins set
// under Settings. API: /api/customer-portal (server/src/routes/portal.js).
const CustomerPortalAdmin = (() => {
  const STAFF_ROLES = ["office", "manager", "admin", "owner", "estimator"];
  const e = (v) => escapeHtml(v);
  const canUse = () => STAFF_ROLES.includes(String((currentUser && currentUser.role) || "").toLowerCase());
  let job = null;
  let data = { url: null, updates: [] };

  // ---------------------------------------------------------------- Job editor panel
  async function show(r) {
    const box = document.getElementById("portalBox");
    if (!box) return;
    job = r;
    box.hidden = !canUse() || !r || ShopModel.jobKind(r.roNumber) !== "active";
    if (box.hidden) return;
    box.innerHTML = '<p class="board-tip">Loading customer status page…</p>';
    try { data = await apiRequest(`/customer-portal/${r.id}`); }
    catch (err) { box.innerHTML = `<p class="board-tip">${e(err.message)}</p>`; return; }
    if (job === r) render();
  }

  function hide() {
    job = null;
    const box = document.getElementById("portalBox");
    if (box) { box.hidden = true; box.innerHTML = ""; }
  }

  function render() {
    const box = document.getElementById("portalBox");
    if (!box || !job) return;
    box.innerHTML = `
      <div class="heading-row"><h3>Customer status page</h3>
        ${data.url ? `<a href="${e(data.url)}" target="_blank" rel="noopener" class="link-button">Open what the customer sees ↗</a>` : ""}</div>
      <p class="board-tip" style="margin-top:6px">The customer sees this car's progress (no prices, notes or names) and the updates you post here. They can also look it up at conceptautobody.app/update with RO ${e(job.roNumber)} and their last name.</p>
      <div class="toolbar">
        ${data.url
          ? `<input id="portalUrl" readonly value="${e(data.url)}" style="flex:1;min-width:220px" aria-label="Customer link"><button type="button" id="portalCopy">Copy customer link</button>`
          : `<button type="button" id="portalMake">Create customer link</button>`}
      </div>
      <label class="wide" style="margin-top:12px">Post an update for the customer
        <textarea id="portalMessage" maxlength="1000" placeholder="e.g. Parts arrived today. We're starting body work tomorrow."></textarea></label>
      <div class="toolbar"><button type="button" id="portalPost">Post update</button>
        <small class="board-tip" style="margin:0">Posting also sets Customer Updated to Yes.</small></div>
      <div id="portalUpdates">${data.updates.length ? data.updates.map((u) => `
        <div class="setting-row"><span><b>${e(formatDateTime(u.created_at))}</b> · ${e(u.created_by || "")}<br>${e(u.message)}</span>
          <button type="button" class="quiet" data-portal-remove="${e(u.id)}">Remove</button></div>`).join("") : '<p class="board-tip">No updates posted yet.</p>'}</div>`;
    const copy = document.getElementById("portalCopy");
    if (copy) copy.onclick = copyLink;
    const make = document.getElementById("portalMake");
    if (make) make.onclick = makeLink;
    document.getElementById("portalPost").onclick = post;
    box.querySelectorAll("[data-portal-remove]").forEach((b) => (b.onclick = () => remove(b.dataset.portalRemove, b)));
  }

  async function makeLink() {
    try {
      const r = await apiRequest(`/customer-portal/${job.id}/link`, { method: "POST" });
      data.url = r.url;
      render();
      await copyLink();
    } catch (err) { showStatus(err.message, true); }
  }

  async function copyLink() {
    const input = document.getElementById("portalUrl");
    try { await navigator.clipboard.writeText(data.url); showStatus("Customer link copied. Paste it into a text or email to the customer."); }
    catch (_) { if (input) { input.focus(); input.select(); } showStatus("Press Ctrl+C to copy the selected link."); }
  }

  async function post() {
    const box = document.getElementById("portalMessage");
    const message = box.value.trim();
    if (!message) return showStatus("Write the update the customer will see.", true);
    const btn = document.getElementById("portalPost");
    btn.disabled = true;
    try {
      const r = await apiRequest(`/customer-portal/${job.id}/updates`, { method: "POST", body: JSON.stringify({ message }) });
      data.updates.unshift(r.update);
      // The job changed on the server; keep the open editor in step so Save still works.
      if (document.getElementById("dailyId").value === job.id) {
        document.getElementById("customerUpdatedToday").value = "Yes";
        const stamp = document.getElementById("dailyExpectedUpdatedAt");
        stamp.value = r.job.updated_at;
        stamp.dataset.version = String(r.job.version);
      }
      Object.assign(job, { customerUpdatedToday: "Yes", customerUpdatedAt: r.job.customer_updated_at, updatedAt: r.job.updated_at, version: r.job.version });
      render();
      showStatus(data.url ? "Update posted. The customer sees it on their status page." : "Update posted. Create a customer link to share the status page.");
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
    } catch (err) { showStatus(err.message, true); }
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

  return { show, hide };
})();
