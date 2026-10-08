// Customer status page (conceptautobody.app/update). /update/<link> shows one
// vehicle; /update alone asks for the RO number and last name. API: /api/portal
// (server/src/routes/portal.js).
(() => {
  const $ = (id) => document.getElementById(id);
  const REFRESH_MS = 2 * 60 * 1000;
  let token = (location.pathname.match(/^\/update\/([A-Za-z0-9_-]{8,64})\/?$/) || [])[1] || null;
  let timer = null;

  const ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  };

  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function when(iso) {
    const d = new Date(iso), now = new Date();
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return `Today at ${time}`;
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
    return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
  }

  function show(view) {
    $("loading").hidden = view !== "loading";
    $("status").hidden = view !== "status";
    $("lookup").hidden = view !== "lookup";
  }

  function render(data) {
    const s = data.status;
    document.body.className = `state-${s.state}`;
    const photo = $("photo");
    $("photoWrap").hidden = !data.vehicleImage;
    if (data.vehicleImage) { photo.src = data.vehicleImage; photo.alt = data.vehicle; }

    const vehicle = $("vehicle");
    vehicle.replaceChildren(el("b", {}, data.vehicle || "Your vehicle"), document.createTextNode(` · RO ${data.ro}`));
    $("headline").textContent = s.headline;
    $("detail").textContent = s.detail || "";
    $("detail").hidden = !s.detail;
    const latest = [s.since, ...data.updates.map((u) => u.at)].filter(Boolean).sort().pop();
    $("since").textContent = latest ? `Updated ${when(latest).replace(/^T/, "t").replace(/^Y/, "y")}` : "";

    // Steps: done, the current one, then what's ahead.
    $("routeCard").hidden = s.state === "closed";
    $("route").replaceChildren(...s.steps.map((label, i) => {
      const state = i < s.step ? "done" : i === s.step ? "now" : "next";
      const li = el("li", { class: state });
      const dot = el("span", { class: "dot", "aria-hidden": "true" });
      if (state === "done") dot.innerHTML = ICONS.check;
      const name = el("span", { class: "label" }, label);
      if (state === "now") name.append(el("small", {}, s.state === "ready" ? "Ready" : "Now"));
      li.append(dot, name);
      li.setAttribute("aria-label", `${label}: ${state === "done" ? "done" : state === "now" ? "current step" : "coming up"}`);
      return li;
    }));

    const list = $("updates");
    list.replaceChildren(...data.updates.map((u) => {
      const li = el("li");
      li.append(el("time", { datetime: u.at }, when(u.at)), el("p", {}, u.message));
      return li;
    }));
    $("noUpdates").hidden = data.updates.length > 0;

    const c = data.contact || {};
    $("readyBox").hidden = s.state !== "ready";
    $("readyHours").textContent = [c.hours && `Hours: ${c.hours}`, c.address].filter(Boolean).join(" · ") || "Give us a call to set a pickup time.";
    const actions = $("contactActions");
    actions.replaceChildren();
    const digits = (p) => String(p || "").replace(/[^\d+]/g, "");
    if (c.phone) actions.append(button(`tel:${digits(c.phone)}`, "Call us", ICONS.phone, true));
    if (c.textPhone) actions.append(button(`sms:${digits(c.textPhone)}`, "Text us", ICONS.text, !c.phone));
    actions.hidden = !actions.children.length;
    const info = $("contactInfo");
    info.replaceChildren();
    if (c.phone) info.append(el("span", {}, `Phone: ${c.phone}`));
    if (c.textPhone && c.textPhone !== c.phone) info.append(el("span", {}, `Text: ${c.textPhone}`));
    if (c.hours) info.append(el("span", {}, `Hours: ${c.hours}`));
    if (c.address) {
      const a = el("a", { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`, target: "_blank", rel: "noopener" }, c.address);
      info.append(a);
    }
    $("contactCard").hidden = !actions.children.length && !info.children.length;
    show("status");
  }

  function button(href, label, icon, primary) {
    const a = el("a", { class: `btn${primary ? " primary" : ""}`, href });
    a.innerHTML = icon;
    a.append(document.createTextNode(label));
    return a;
  }

  async function load(quiet) {
    if (!quiet) show("loading");
    try {
      const res = await fetch(`/api/portal/status/${token}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Error(body.error || "We couldn't load your repair status. Please try again.");
      render(body);
    } catch (err) {
      if (quiet) return;
      showLookup(err.message);
    }
  }

  function showLookup(message) {
    clearInterval(timer);
    $("lookupError").textContent = message || "";
    $("lookupError").hidden = !message;
    document.body.className = "";
    show("lookup");
  }

  $("lookupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const ro = $("ro").value.trim().replace(/^#/, ""), lastName = $("lastName").value.trim();
    if (!/^\d{5}$/.test(ro)) return showLookup("Enter the 5-digit RO number from your paperwork.");
    if (!lastName) return showLookup("Enter the last name on the repair order.");
    const btn = $("lookupBtn");
    btn.disabled = true;
    btn.textContent = "Looking it up…";
    try {
      const res = await fetch("/api/portal/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ro, lastName }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Error(body.error || "Something went wrong. Please try again.");
      token = body.token;
      history.replaceState(null, "", `/update/${token}`);
      start();
    } catch (err) { showLookup(err.message); }
    finally { btn.disabled = false; btn.textContent = "Show my repair status"; }
  });

  function start() {
    load(false);
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) load(true); }, REFRESH_MS);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && token && !$("status").hidden) load(true); });

  if (token) start(); else showLookup("");
})();
