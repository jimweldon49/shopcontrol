// Concept Autobody department QC checklists. Shared by the mobile app, the desktop
// QC tab and the server (for validation), so the wording lives in one place.
// Item ids are stored with each QC record: never rename or reuse an id, only add new
// ones (old records keep pointing at the ids they were saved with).
// `es` is the Spanish wording shown in the employee app when a tech switches to Spanish;
// records only store ids, so reports always show the English `label`.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QcChecklists = api;
})(typeof self !== "undefined" ? self : this, function () {
  const departments = [
    {
      // Whoever checks the vehicle in often does its final QC too, so Check-In comes with Final QC.
      id: "Check-In", es: "Recepción", color: "#38bdf8", icon: "clipboard", alsoDoes: ["Final QC"],
      items: [
        { id: "auth_signed", label: "Authorizations signed", es: "Autorizaciones firmadas" },
        { id: "deductible_aware", label: "Customer aware of deductible", es: "Cliente enterado del deducible" },
        { id: "marked_onsite", label: "Vehicle marked on site: CCC1 + Event", es: "Vehículo marcado en sitio: CCC1 + Evento" },
        { id: "card_created", label: "Shop Control card created / windshield tagged", es: "Tarjeta de Shop Control creada / parabrisas etiquetado" },
        { id: "estimate_qr_hung", label: "Estimate and QR hung in vehicle", es: "Estimado y QR colgados en el vehículo" },
        { id: "mapped_green_red", label: "Vehicle mapped green and red", es: "Vehículo marcado en verde y rojo" },
        { id: "mapped_photos", label: "Mapped exterior and interior photos", es: "Fotos marcadas del exterior e interior" },
        { id: "prescan_window", label: "Vehicle pre-scanned / window check", es: "Pre-escaneo del vehículo / revisión de ventanas" },
        { id: "key_box", label: "Key box attached and key tagged", es: "Caja de llaves puesta y llave etiquetada" },
        { id: "lights_mil_fuel", label: "Failed lights, MILs, fuel noted", es: "Luces fundidas, luces de falla (MIL) y combustible anotados" },
        { id: "ac_cold", label: "A/C cold", es: "A/C enfriando", input: { label: "Center vent temp", es: "Temp. de la ventila central", suffix: "°F", type: "number" } },
      ],
    },
    {
      // Body techs reassemble the cars they work on, so Body always comes with Reassy.
      id: "Body", es: "Carrocería", color: "#f97316", icon: "hammer", alsoDoes: ["Reassy"],
      items: [
        { id: "tech_slot", label: "Shop Control tech slot assigned", es: "Técnico asignado en Shop Control" },
        { id: "estimate_reviewed", label: "Estimate reviewed", es: "Estimado revisado" },
        { id: "procedures", label: "Procedures on-hand", es: "Procedimientos a la mano" },
        { id: "supplement_addl", label: "Supplement for add'l work / parts / chemicals", es: "Suplemento por trabajo / partes / materiales adicionales" },
        { id: "prefit", label: "Parts pre-fit before paint", es: "Partes pre-ajustadas antes de pintura" },
        { id: "bodywork_photos", label: "Body work checked / in-process photos", es: "Trabajo de carrocería revisado / fotos del proceso" },
        { id: "battery_protected", label: "Battery non-drained / protected", es: "Batería sin descargar / protegida" },
        { id: "parts_inventoried", label: "Parts inventoried", es: "Partes inventariadas" },
        { id: "openings_covered", label: "Openings covered / wrapped", es: "Aberturas cubiertas / envueltas" },
        { id: "cart_organized", label: "Parts cart organized and stored", es: "Carrito de partes organizado y guardado" },
      ],
    },
    {
      id: "Paint", es: "Pintura", color: "#a855f7", icon: "spray",
      items: [
        { id: "painter_slot", label: "Shop Control painter slot assigned", es: "Pintor asignado en Shop Control" },
        { id: "bodywork_ok", label: "Body work performed to satisfaction", es: "Trabajo de carrocería hecho a satisfacción" },
        { id: "estimate_reviewed", label: "Estimate reviewed", es: "Estimado revisado" },
        { id: "paintables_onhand", label: "All paintable parts on-hand", es: "Todas las partes a pintar a la mano" },
        { id: "sprayout_photo", label: "Spray-out / let-down panel photo", es: "Foto de la muestra de color (spray-out / let-down)" },
        { id: "supplement_panels", label: "Supplement given for added panels", es: "Suplemento entregado por paneles adicionales" },
        { id: "booth_photos", label: "In-booth prepped photos", es: "Fotos en la cabina ya preparado" },
        { id: "color_approved", label: "Final color approved", es: "Color final aprobado" },
        { id: "runs_nibs", label: "Runs / nibs checked and removed", es: "Chorreados / basuritas revisados y quitados" },
        { id: "unmasked", label: "Properly and fully unmasked", es: "Desenmascarado completo y correcto" },
      ],
    },
    {
      id: "Reassy", es: "Rearmado", color: "#22c55e", icon: "wrench",
      items: [
        { id: "tech_slot", label: "Shop Control tech slot assigned", es: "Técnico asignado en Shop Control" },
        { id: "color_ok", label: "Color acceptable before build", es: "Color aceptable antes de armar" },
        { id: "estimate_items", label: "All estimate items performed", es: "Todos los puntos del estimado realizados" },
        { id: "battery_ok", label: "Battery in good starting condition", es: "Batería en buena condición para arrancar" },
        { id: "no_mils", label: "No dash MILs present after build", es: "Sin luces de falla en el tablero después de armar" },
        { id: "test_drive", label: "Test drive performed (noise / suspension)", es: "Prueba de manejo hecha (ruidos / suspensión)" },
        { id: "moved_to_final", label: "Shop Control moved to final sublet / detail", es: "Shop Control movido a subcontrato final / detallado" },
        { id: "gates_sensors", label: "Auto-gate, sliders, kick sensors work", es: "Compuerta automática, puertas corredizas y sensores de pie funcionan" },
        { id: "lights_sensors", label: "Final light and sensor check", es: "Revisión final de luces y sensores" },
        { id: "cart_cleared", label: "Parts cart cleared, large parts tossed, cores returned", es: "Carrito vaciado, partes grandes tiradas, cores devueltos" },
      ],
    },
    {
      id: "Final QC", es: "QC final", color: "#eab308", icon: "shield",
      items: [
        { id: "mils_cleared", label: "Dash MILs cleared", es: "Luces de falla del tablero borradas" },
        { id: "battery_fuel", label: "Battery / fuel sufficient", es: "Batería / combustible suficiente" },
        { id: "jambs_clean", label: "Jambs and fuel pocket clean", es: "Marcos de puertas y tapa de gasolina limpios" },
        { id: "estimate_lines", label: "All estimate lines performed", es: "Todas las líneas del estimado realizadas" },
        { id: "sublets_done", label: "All sublets completed", es: "Todos los subcontratos terminados" },
        { id: "courtesy_items", label: "Courtesy items performed", es: "Servicios de cortesía realizados" },
        { id: "tech_video", label: "Tech video recorded", es: "Video del técnico grabado" },
        { id: "post_scan", label: "Final light / mirror check and post scan done", es: "Revisión final de luces / espejos y post-escaneo hecho" },
        { id: "final_photos", label: "Final QC photos taken incl. interior / trunk", es: "Fotos de QC final tomadas, incl. interior / cajuela" },
        { id: "final_bill", label: "Final paperwork and final bill prepped", es: "Papeleo final y factura final preparados" },
        { id: "no_swirls", label: "No swirl marks / compound on vehicle", es: "Sin marcas de pulido / compuesto en el vehículo" },
        { id: "care_tag", label: "Paint care tag hung / keychain attached", es: "Etiqueta de cuidado de pintura colgada / llavero puesto" },
        { id: "customer_notified", label: "Customer notified", es: "Cliente notificado" },
        { id: "video_sent", label: "Tech video sent to customer", es: "Video del técnico enviado al cliente" },
      ],
    },
  ];

  const names = departments.map(d => d.id);
  const byId = Object.fromEntries(departments.map(d => [d.id, d]));

  // Every checklist a person does: their main department, what that department always
  // comes with (Body -> Reassy, Check-In -> Final QC), then any extras set on their account.
  function departmentsFor(main, extras) {
    const list = [main, ...((byId[main] && byId[main].alsoDoes) || []), ...(extras || [])];
    return list.filter((d, i) => d && byId[d] && list.indexOf(d) === i);
  }

  // Progress for a saved checklist: { done, total, complete }.
  function progress(departmentId, checklist) {
    const dept = byId[departmentId];
    if (!dept) return { done: 0, total: 0, complete: false };
    const items = (checklist && checklist.items) || {};
    const done = dept.items.filter(i => items[i.id] && items[i.id].done).length;
    return { done, total: dept.items.length, complete: done === dept.items.length };
  }

  // Server-side shape check for a saved checklist.
  function validateChecklist(departmentId, checklist) {
    const dept = byId[departmentId];
    if (!dept) throw Error("Choose a valid QC department.");
    if (checklist === undefined || checklist === null) return;
    if (typeof checklist !== "object" || Array.isArray(checklist)) throw Error("Invalid QC checklist.");
    const items = checklist.items || {};
    if (typeof items !== "object" || Array.isArray(items)) throw Error("Invalid QC checklist.");
    const ids = new Set(dept.items.map(i => i.id));
    for (const [id, v] of Object.entries(items)) {
      if (!ids.has(id)) throw Error(`Unknown ${dept.id} checklist item.`);
      if (!v || typeof v !== "object" || typeof v.done !== "boolean") throw Error("Invalid QC checklist item.");
      if (v.value !== undefined && v.value !== null && String(v.value).length > 40) throw Error("Checklist value is too long.");
    }
    if (checklist.notes !== undefined && (typeof checklist.notes !== "string" || checklist.notes.length > 4000)) throw Error("QC notes are too long.");
  }

  return { departments, names, byId, progress, validateChecklist, departmentsFor };
});
