// English / Spanish for the employee app. Only what's shown on screen is translated:
// everything saved (checklist item ids, time-off types, rework choices, stages) stays
// in English, so the office program and QC reports always read in English.
//
// How it works: the app keeps writing its screens in English. A watcher translates any
// text (and placeholder / aria-label / label attributes) that exactly matches a phrase
// below, or one of the patterns for phrases with numbers or names in them. Switching
// back to English restores the original text. Anything a person typed (messages, notes,
// company info) is inside translate="no" and is left alone.
const I18n = (() => {
  const KEY = "appLang";
  let lang = "en";
  try { lang = localStorage.getItem(KEY) === "es" ? "es" : "en"; } catch (_) {}

  // Exact phrases (English → Spanish).
  const ES = {
    // Sign in / password
    "Build it right.": "Hazlo bien.", "Check it off.": "Márcalo.",
    "Sign in with your Shop Control account.": "Entra con tu cuenta de Shop Control.",
    "Username": "Usuario", "Password": "Contraseña", "Sign in": "Entrar", "Signing in…": "Entrando…",
    "Enter your username and password.": "Escribe tu usuario y contraseña.",
    "Invalid username or password.": "Usuario o contraseña incorrectos.",
    "Too many failed login attempts. Please wait 15 minutes and try again.": "Demasiados intentos fallidos. Espera 15 minutos y vuelve a intentar.",
    "Your session expired. Please sign in again.": "Tu sesión expiró. Vuelve a entrar.",
    "Choose your": "Elige tu", "password.": "contraseña.",
    "You signed in with a temporary password. Pick your own to continue (at least 8 characters).": "Entraste con una contraseña temporal. Elige la tuya para continuar (mínimo 8 caracteres).",
    "Current (temporary) password": "Contraseña actual (temporal)", "New password": "Contraseña nueva", "Confirm new password": "Confirma la contraseña nueva",
    "Save password": "Guardar contraseña", "Sign out": "Salir", "Password saved ✓": "Contraseña guardada ✓",
    "Enter your current (temporary) password.": "Escribe tu contraseña actual (temporal).",
    "Your new password must be at least 8 characters.": "Tu contraseña nueva debe tener al menos 8 caracteres.",
    "The two new passwords don't match.": "Las dos contraseñas nuevas no coinciden.",
    "Your current password isn't right.": "Tu contraseña actual no es correcta.",
    "Choose a password different from the temporary one.": "Elige una contraseña diferente a la temporal.",
    // Home
    "Shop QC": "QC del taller", "Mailbox": "Buzón", "Notifications": "Notificaciones", "Hey there": "Hola",
    "Staff Hub": "Centro del personal", "Time off · mailbox · company info": "Días libres · buzón · información",
    "Search RO, customer or vehicle": "Buscar RO, cliente o vehículo", "In the shop": "En el taller",
    "Tap a vehicle to start your checklist.": "Toca un vehículo para empezar tu lista.",
    "Tap a vehicle to open its QC checklists.": "Toca un vehículo para abrir sus listas de QC.",
    "No open vehicles match that search.": "Ningún vehículo abierto coincide con la búsqueda.",
    "No vehicles are marked onsite right now. Search by RO above.": "No hay vehículos marcados en el taller ahora. Busca por RO arriba.",
    // Vehicle
    "Vehicle": "Vehículo", "Back": "Atrás", "Stage": "Etapa", "Due": "Entrega", "Techs": "Técnicos",
    "Photos": "Fotos", "Snap & attach": "Toma y adjunta", "Parts": "Partes", "Loading…": "Cargando…",
    "Other departments · tap to view or help out": "Otros departamentos · toca para ver o ayudar",
    "Pick a checklist": "Elige una lista", "Not started": "Sin empezar", "Done": "Listo",
    "Open rework": "Retrabajos abiertos", "Unassigned": "Sin asignar", "No due date": "Sin fecha",
    "Mark rework done": "Marcar retrabajo terminado", "Rework marked done": "Retrabajo marcado como terminado",
    // Parts
    "None on file": "Ninguna registrada", "Not available": "No disponible", "Parts cart": "Carrito de partes",
    "Your account can't view parts.": "Tu cuenta no puede ver partes.", "No parts on file for this RO.": "No hay partes registradas para este RO.",
    "📍 Here, not put away yet · ask parts": "📍 Ya llegó, sin guardar · pregunta a partes",
    "Need to Order": "Por pedir", "Ordered": "Pedida", "Backordered": "En espera (backorder)", "Partial": "Parcial",
    "Received": "Recibida", "Mirror Matched": "Comparada", "Wrong Part": "Parte equivocada", "Return Needed": "Hay que devolver",
    "Returned": "Devuelta", "Credit Pending": "Crédito pendiente", "Complete": "Completa", "Late": "Atrasada",
    // Checklist
    "Checklist": "Lista", "Notes": "Notas", "Anything the next department should know": "Algo que el siguiente departamento deba saber",
    "Sign & finish": "Firmar y terminar", "Sign & finish 🎉": "Firmar y terminar 🎉",
    "Everything's checked. Sign it off.": "Todo está marcado. Fírmalo.",
    "Saving…": "Guardando…", "Saved ✓": "Guardado ✓", "Not saved, retrying": "No se guardó, reintentando",
    "Anything need rework?": "¿Algo necesita retrabajo?", "No, all good": "No, todo bien", "Yes, needs rework": "Sí, necesita retrabajo",
    "What needs fixing": "Qué hay que arreglar", "Assign to": "Asignar a", "Name": "Nombre",
    "Your signature": "Tu firma", "Clear signature": "Borrar firma", "Submit QC": "Enviar QC", "Submitting…": "Enviando…",
    "Sign in the box to finish.": "Firma en el cuadro para terminar.", "Say what needs rework.": "Escribe qué necesita retrabajo.",
    "QC complete": "QC completo", "Sent for rework": "Enviado a retrabajo", "QC saved": "QC guardado",
    "Back to vehicle": "Volver al vehículo", "All vehicles": "Todos los vehículos",
    // Photos
    "Caption (optional)": "Descripción (opcional)", "e.g. Left rear quarter panel": "ej. Panel trasero izquierdo",
    "Take a photo": "Tomar una foto", "Choose a file": "Elegir un archivo", "On this vehicle": "En este vehículo",
    "Nothing attached yet.": "Nada adjunto todavía.", "Uploading…": "Subiendo…", "Photo added ✓": "Foto agregada ✓",
    // Alerts
    "Mark read": "Marcar leído", "You're all caught up.": "Estás al día.", "Turn on phone alerts": "Activar alertas en el teléfono",
    // Staff hub
    "Request time off": "Pedir días libres", "Sick, vacation and more": "Enfermedad, vacaciones y más",
    "My requests": "Mis solicitudes", "Status of your requests": "Estado de tus solicitudes",
    "Messages from the office": "Mensajes de la oficina", "Company info": "Información de la empresa",
    "Hours, contacts, policies": "Horario, contactos, reglas", "User manual": "Manual de uso",
    "How to use ShopControl and this app": "Cómo usar ShopControl y esta app (en inglés)",
    "Absence request": "Solicitud de ausencia", "Absence Request": "Solicitud de ausencia", "Type of absence": "Tipo de ausencia",
    "Sick": "Enfermedad", "Vacation": "Vacaciones", "Bereavement": "Luto (fallecimiento)", "Time off without pay": "Días sin goce de sueldo",
    "Military": "Servicio militar", "Jury duty": "Servicio de jurado", "Maternity/Paternity": "Maternidad/Paternidad", "Other": "Otro",
    "Reason for absence": "Motivo de la ausencia", "Write in your reason": "Escribe tu motivo", "When": "Cuándo",
    "First day": "Primer día", "Last day": "Último día", "Partial day (same day, set times)": "Parte del día (mismo día, con horario)",
    "From": "De", "To": "Para", "Notes (optional)": "Notas (opcional)", "Anything the office should know": "Algo que la oficina deba saber",
    "Submit request": "Enviar solicitud", "Sending…": "Enviando…", "Request sent to the office ✓": "Solicitud enviada a la oficina ✓",
    "Choose the type of absence.": "Elige el tipo de ausencia.", "Write in the reason for your absence.": "Escribe el motivo de tu ausencia.",
    "Choose your dates.": "Elige tus fechas.", "The last day can't be before the first day.": "El último día no puede ser antes del primero.",
    "Waiting for approval": "Esperando aprobación", "Pending": "Pendiente", "Approved": "Aprobada", "Denied": "Negada", "Cancelled": "Cancelada",
    "Cancel request": "Cancelar solicitud", "Request cancelled": "Solicitud cancelada", "No requests yet.": "Todavía no hay solicitudes.",
    "New message": "Mensaje nuevo", "Message": "Mensaje", "Reply": "Responder", "Subject": "Asunto", "Send": "Enviar",
    "No messages yet.": "Todavía no hay mensajes.", "Write a message.": "Escribe un mensaje.", "Choose who it's for.": "Elige para quién es.",
    "Choose…": "Elegir…", "Office & admins": "Oficina y administradores", "Everyone": "Todos", "Department": "Departamento", "Person": "Persona",
    "Nothing here yet. The office will add shop info soon.": "Nada todavía. La oficina agregará información pronto.",
    // Departments and production stages
    "Check-In": "Recepción", "Body": "Carrocería", "Paint": "Pintura", "Reassy": "Rearmado", "Final QC": "QC final",
    "Tear Down": "Desarmado", "Repair Plan": "Plan de reparación", "Waiting Approval": "Esperando aprobación",
    "Waiting on Supplement": "Esperando suplemento", "Waiting on Parts": "Esperando partes", "Prep": "Preparación",
    "On Hold": "En pausa", "Assembly": "Armado", "Sublet": "Subcontrato", "Detail": "Detallado", "QC": "QC",
    "Ready for Delivery": "Listo para entregar", "Scheduled": "Programado", "On the Road": "En camino", "No Show": "No llegó",
    "Delivered": "Entregado", "Total Loss": "Pérdida total",
  };

  // Checklist items and departments carry their own Spanish (see ../qcChecklists.js).
  if (typeof QcChecklists !== "undefined") {
    for (const d of QcChecklists.departments) {
      if (d.es) ES[d.id] = d.es;
      for (const i of d.items) {
        if (i.es) ES[i.label] = i.es;
        if (i.input && i.input.es) ES[i.input.label] = i.input.es;
      }
    }
  }

  const word = (s) => ES[s] || s;
  const qcOf = (dept) => (dept === "Final QC" ? "QC final" : `QC de ${word(dept)}`);
  const count = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;

  // Phrases with numbers or names in them: [pattern, Spanish builder].
  const PATTERNS = [
    [/^(Morning|Hey|Evening), (.+)$/, (m) => `${{ Morning: "Buenos días", Hey: "Hola", Evening: "Buenas tardes" }[m[1]]}, ${m[2] === "there" ? "compañero" : m[2]}`],
    [/^(\d+) match(es)?$/, (m) => count(m[1], "resultado", "resultados")],
    [/^In the shop · (\d+)$/, (m) => `En el taller · ${m[1]}`],
    [/^Done · signed by (.+)$/, (m) => `Listo · firmado por ${m[1]}`],
    [/^(\d+) of (\d+) checked · keep going$/, (m) => `${m[1]} de ${m[2]} marcados · sigue así`],
    [/^(\d+) of (\d+) checked · all done$/, (m) => `${m[1]} de ${m[2]} marcados · todo listo`],
    [/^(\d+) of (\d+) checked$/, (m) => `${m[1]} de ${m[2]} marcados`],
    [/^(\d+)\/(\d+) checked$/, (m) => `${m[1]}/${m[2]} marcados`],
    [/^(\d+) items · tap to start$/, (m) => `${m[1]} puntos · toca para empezar`],
    [/^(.+) QC done!$/, (m) => `¡${qcOf(m[1])} terminado!`],
    [/^(.+) QC · RO (.*)$/, (m) => `${qcOf(m[1])} · RO ${m[2]}`],
    [/^(Check-In|Body|Paint|Reassy|Final QC) QC$/, (m) => qcOf(m[1])],
    [/^RO (.*) · (\d+)\/(\d+) checked · signed by (.*)$/, (m) => `RO ${m[1]} · ${m[2]}/${m[3]} marcados · firmado por ${m[4]}`],
    [/^(.+) · from (.+)$/, (m) => `${m[1]} · de ${word(m[2])}`],
    [/^Due (\S+)$/, (m) => `Vence ${m[1]}`],
    [/^(\d+) need attention$/, (m) => `${m[1]} necesitan atención`],
    [/^(\d+)\/(\d+) here$/, (m) => `${m[1]}/${m[2]} aquí`],
    [/^Cart (\S+(?: \+ \S+)*) · (.+)$/, (m) => `Carrito ${m[1]} · ${translate(m[2])}`],
    [/^Shelf (\S+)$/, (m) => `Repisa ${m[1]}`],
    [/^Top$/, () => "Arriba"],
    [/^Parts · RO (.*)$/, (m) => `Partes · RO ${m[1]}`],
    [/^Photos · RO (.*)$/, (m) => `Fotos · RO ${m[1]}`],
    [/^(\d+) attached$/, (m) => count(m[1], "adjunta", "adjuntas")],
    [/^(\d+) unread$/, (m) => `${m[1]} sin leer`],
    [/^(\d+) waiting for approval$/, (m) => `${m[1]} esperando aprobación`],
    [/^Other: (.*)$/, (m) => `Otro: ${m[1]}`],
    [/^(Approved|Denied|Cancelled) by (.+)$/, (m) => `${word(m[1])} por ${m[2]}`],
    [/^Reply to (.+)$/, (m) => `Responder a ${m[1]}`],
    [/^From (.+?)( · to .+)? · (.+)$/, (m) => `De ${m[1]}${m[2] ? " · para " + ({ everyone: "todos", office: "la oficina" }[m[2].slice(6)] || m[2].slice(6)) : ""} · ${m[3]}`],
    [/^Sent to (\d+) (person|people) ✓$/, (m) => `Enviado a ${count(m[1], "persona", "personas")} ✓`],
  ];

  function translate(text) {
    if (ES[text]) return ES[text];
    // A leading pin or check mark stays; the words after it get translated.
    const lead = text.match(/^(📍 |✓ )(.+)$/);
    if (lead) { const rest = translate(lead[2]); return rest === lead[2] ? text : lead[1] + rest; }
    for (const [re, fn] of PATTERNS) {
      const m = text.match(re);
      if (m) return fn(m);
    }
    return text;
  }

  // ------------------------------------------------------------ Applying to the page
  const ATTRS = ["placeholder", "aria-label", "label"];
  const textState = new WeakMap(); // text node -> { orig, out }
  const attrState = new WeakMap(); // element -> { [attr]: { orig, out } }

  // Text inside a text box is what someone typed, so it's never touched; a text box's
  // placeholder is still translated.
  const skip = (el) => !el || el.closest("script, style, textarea, [translate='no']");
  const skipAttrs = (el) => !el || el.closest("script, style, [translate='no']");

  function doText(node) {
    const cur = node.nodeValue;
    let st = textState.get(node);
    if (!st || st.out !== cur) { st = { orig: cur, out: cur }; textState.set(node, st); }
    const trimmed = st.orig.trim();
    let out = st.orig;
    if (lang === "es" && trimmed) {
      const t = translate(trimmed);
      if (t !== trimmed) out = st.orig.replace(trimmed, t);
    }
    st.out = out;
    if (cur !== out) node.nodeValue = out;
  }

  function doAttrs(el) {
    let st = attrState.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      st = st || {};
      if (!st[a] || st[a].out !== cur) st[a] = { orig: cur, out: cur };
      const out = lang === "es" ? translate(st[a].orig.trim()) : st[a].orig;
      st[a].out = out;
      if (cur !== out) el.setAttribute(a, out);
    }
    if (st) attrState.set(el, st);
  }

  function walk(root) {
    if (root.nodeType === 3) { if (!skip(root.parentElement)) doText(root); return; }
    if (root.nodeType !== 1 || skipAttrs(root)) return;
    doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) { if (!skip(n.parentElement)) doText(n); }
      else if (!skipAttrs(n)) doAttrs(n);
    }
  }

  let observer = null;
  function watch() {
    observer = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "characterData") { if (!skip(m.target.parentElement)) doText(m.target); }
        else if (m.type === "attributes") { if (!skipAttrs(m.target)) doAttrs(m.target); }
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function refreshButtons() {
    document.documentElement.lang = lang;
    // Each button names the language you'd switch TO, in that language.
    document.querySelectorAll("[data-lang-toggle]").forEach((b) => {
      b.setAttribute("translate", "no");
      b.textContent = lang === "es" ? "English" : "Español";
      b.setAttribute("aria-label", lang === "es" ? "Switch to English" : "Cambiar a español");
    });
  }

  function set(next) {
    lang = next === "es" ? "es" : "en";
    try { localStorage.setItem(KEY, lang); } catch (_) {}
    walk(document.body);
    refreshButtons();
  }

  function start() {
    walk(document.body);
    watch();
    refreshButtons();
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-lang-toggle]")) set(lang === "es" ? "en" : "es");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  return {
    get lang() { return lang; },
    locale: () => (lang === "es" ? "es-MX" : "en-US"),
    t: (s) => (lang === "es" ? translate(s) : s),
    set,
    translate,
  };
})();
