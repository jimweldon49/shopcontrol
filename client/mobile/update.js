// Picks up new deploys without anyone force-refreshing. Phones keep the app open in
// memory for days, so check the server's version (/api/version) when the app comes
// back to the screen and every few minutes. When it changed, reload right away if
// that loses nothing; on a form or with something being typed, show a bar to tap.
(() => {
  // Screens that are only for looking; anything else may hold unsaved input.
  const SAFE_SCREENS = ["login", "home", "job", "done", "staff", "requests", "approve", "mail", "message", "info",
    "pdesk", "pcarts", "pcart", "preturns", "plocs", "ploc"];
  const CHECK_MS = 5 * 60 * 1000;
  let loaded = null;
  let waiting = false;
  let lastCheck = 0;

  async function serverVersion() {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) throw Error(res.status);
    return (await res.json()).mobile;
  }

  function safeToReload() {
    const screen = document.querySelector(".screen.active");
    const name = screen ? screen.id.replace("screen-", "") : "";
    const el = document.activeElement;
    const typing = el && el.matches("input, textarea, select") && !(name === "login" && !el.value);
    return SAFE_SCREENS.includes(name) && !typing && !document.querySelector(".sheet-backdrop");
  }

  function showBar() {
    if (document.getElementById("updateBar")) return;
    const bar = document.createElement("button");
    bar.id = "updateBar";
    bar.className = "update-bar";
    bar.textContent = "A new version is ready. Tap to update";
    bar.onclick = () => location.reload();
    document.body.append(bar);
  }

  async function check() {
    if (document.hidden || Date.now() - lastCheck < 15000) return;
    lastCheck = Date.now();
    try {
      const v = await serverVersion();
      if (!loaded) { loaded = v; return; }
      if (v !== loaded) waiting = true;
    } catch (_) { return; }
    if (!waiting) return;
    if (safeToReload()) location.reload();
    else showBar();
  }

  // Once an update is waiting, reload as soon as the person goes back to a safe screen.
  document.addEventListener("click", () => setTimeout(() => { if (waiting && safeToReload()) location.reload(); }, 300));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  window.addEventListener("focus", check);
  window.addEventListener("pageshow", (e) => { if (e.persisted) check(); });
  setInterval(check, CHECK_MS);
  serverVersion().then((v) => { loaded = v; }).catch(() => {});
})();
