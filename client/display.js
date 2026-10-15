// Each user's own look: theme, text size and highlight color (client/themes.css). Saved on
// the user's account (PUT /api/auth/display) and cached in this browser, so the page opens
// in the right look before the login check finishes. Loaded in <head> right after shared.js.
const Display = (() => {
  const KEY = "displayPrefs";
  const FONTS = "https://fonts.googleapis.com/css2?family=Monoton&family=Righteous&display=swap";
  let saved = ShopModel.cleanDisplayPrefs(readCache());

  function readCache() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; }
  }

  // Route 66 uses two Google fonts (neon-sign headings, retro menus); only fetched when picked.
  function loadFonts() {
    if (document.getElementById("route66Fonts")) return;
    const link = Object.assign(document.createElement("link"), { id: "route66Fonts", rel: "stylesheet", href: FONTS });
    document.head.append(link);
  }

  function apply(prefs) {
    const p = ShopModel.cleanDisplayPrefs(prefs);
    const root = document.documentElement;
    root.dataset.theme = p.theme;
    root.dataset.text = p.text;
    if (p.accent) root.dataset.accent = p.accent; else delete root.dataset.accent;
    if (p.theme === "route66") loadFonts();
    return p;
  }

  function remember(prefs) {
    saved = apply(prefs);
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (_) {}
  }

  // After login (or on reload with a saved login): the account's choice wins.
  function sync(user) { remember(user && user.displayPrefs); }

  // On logout the login screen goes back to the shop's default look.
  function reset() {
    try { localStorage.removeItem(KEY); } catch (_) {}
    saved = apply({});
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function choices(name, current, render) {
    return `<div class="display-choices display-${name}">${ShopModel.displayOptions[name].map((o) => `
      <label class="display-choice${o.id === current ? " selected" : ""}">
        <input type="radio" name="${name}" value="${esc(o.id)}" ${o.id === current ? "checked" : ""}>${render(o)}
      </label>`).join("")}</div>`;
  }

  function open() {
    const html = `
      <p class="display-intro">Pick how ShopControl looks for you. Only you see it, on any computer you log in on.</p>
      <h3 class="display-heading">Theme</h3>
      ${choices("theme", saved.theme, (o) => `<span class="theme-sample" data-sample="${o.id}"><i></i><b>Aa</b></span><span>${esc(o.name)}</span>`)}
      <h3 class="display-heading">Text size</h3>
      ${choices("text", saved.text, (o) => `<span class="text-sample text-${o.id}">Aa</span><span>${esc(o.name)}</span>`)}
      <h3 class="display-heading">Highlight color</h3>
      <p class="display-hint">Buttons, the selected menu item and what lights up when you point at it.</p>
      ${choices("accent", saved.accent, (o) => `<span class="accent-dot" data-dot="${o.id || "theme"}"></span><span>${esc(o.name)}</span>`)}`;
    let kept = false;
    const dialog = openDialog("Display", html, async (form) => {
      const prefs = { theme: form.get("theme"), text: form.get("text"), accent: form.get("accent") || "" };
      const data = await apiRequest("/auth/display", { method: "PUT", body: JSON.stringify(prefs) });
      kept = true;
      remember(data.displayPrefs);
      if (typeof currentUser !== "undefined" && currentUser) {
        currentUser.displayPrefs = data.displayPrefs;
        try { localStorage.setItem("authUser", JSON.stringify(currentUser)); } catch (_) {}
      }
    });
    dialog.classList.add("display-dialog");
    // Live preview while choosing; Cancel puts the saved look back.
    dialog.querySelector("form").addEventListener("change", (e) => {
      if (e.target.type !== "radio") return;
      dialog.querySelectorAll(`input[name="${e.target.name}"]`).forEach((i) => i.closest(".display-choice").classList.toggle("selected", i.checked));
      const f = new FormData(dialog.querySelector("form"));
      apply({ theme: f.get("theme"), text: f.get("text"), accent: f.get("accent") || "" });
    });
    dialog.addEventListener("close", () => { if (!kept) apply(saved); });
  }

  apply(saved);
  return { apply, sync, reset, open };
})();
