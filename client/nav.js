// Left menu groups (index.html .nav-group): click a heading to open or close it.
// Open groups are remembered per computer, the group holding the page you're on
// always opens, and a group whose pages are all hidden for your role is hidden.
(() => {
  const KEY = "navGroupsOpen";
  const DEFAULT_OPEN = ["jobs", "boards", "customers"];
  const groups = [...document.querySelectorAll(".nav-group")];
  if (!groups.length) return;

  let open;
  try { open = new Set(JSON.parse(localStorage.getItem(KEY)) || DEFAULT_OPEN); }
  catch (_) { open = new Set(DEFAULT_OPEN); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...open])); } catch (_) {} };

  function setOpen(group, isOpen, remember = true) {
    group.classList.toggle("open", isOpen);
    group.querySelector(".nav-group-toggle").setAttribute("aria-expanded", String(isOpen));
    if (!remember) return;
    if (isOpen) open.add(group.dataset.group); else open.delete(group.dataset.group);
    save();
  }

  function hideEmptyGroups() {
    for (const group of groups) {
      const items = [...group.querySelectorAll(".nav-group-items > *")];
      group.hidden = items.length > 0 && items.every((el) => el.style.display === "none");
    }
  }

  for (const group of groups) {
    setOpen(group, open.has(group.dataset.group), false);
    group.querySelector(".nav-group-toggle").addEventListener("click", () => setOpen(group, !group.classList.contains("open")));
  }

  // Opening a page from a dashboard card, search or an Edit button opens its group too.
  document.addEventListener("click", (ev) => {
    const tab = ev.target.closest && ev.target.closest(".nav-group .tab");
    if (tab) setOpen(tab.closest(".nav-group"), true);
  }, true);

  // Role checks show or hide Time Off / Employees after login.
  new MutationObserver(hideEmptyGroups).observe(document.querySelector("nav.tabs"), { subtree: true, attributes: true, attributeFilter: ["style"] });
  hideEmptyGroups();
})();
