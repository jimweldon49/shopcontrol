// Concept Autobody department QC checklists. Shared by the mobile app, the desktop
// QC tab and the server (for validation), so the wording lives in one place.
// Item ids are stored with each QC record: never rename or reuse an id, only add new
// ones (old records keep pointing at the ids they were saved with).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QcChecklists = api;
})(typeof self !== "undefined" ? self : this, function () {
  const departments = [
    {
      id: "Check-In", color: "#38bdf8", icon: "clipboard",
      items: [
        { id: "auth_signed", label: "Authorizations signed" },
        { id: "deductible_aware", label: "Customer aware of deductible" },
        { id: "marked_onsite", label: "Vehicle marked on site: CCC1 + Event" },
        { id: "card_created", label: "Shop Control card created / windshield tagged" },
        { id: "estimate_qr_hung", label: "Estimate and QR hung in vehicle" },
        { id: "mapped_green_red", label: "Vehicle mapped green and red" },
        { id: "mapped_photos", label: "Mapped exterior and interior photos" },
        { id: "prescan_window", label: "Vehicle pre-scanned / window check" },
        { id: "key_box", label: "Key box attached and key tagged" },
        { id: "lights_mil_fuel", label: "Failed lights, MILs, fuel noted" },
        { id: "ac_cold", label: "A/C cold", input: { label: "Center vent temp", suffix: "°F", type: "number" } },
      ],
    },
    {
      id: "Body", color: "#f97316", icon: "hammer",
      items: [
        { id: "tech_slot", label: "Shop Control tech slot assigned" },
        { id: "estimate_reviewed", label: "Estimate reviewed" },
        { id: "procedures", label: "Procedures on-hand" },
        { id: "supplement_addl", label: "Supplement for add'l work / parts / chemicals" },
        { id: "prefit", label: "Parts pre-fit before paint" },
        { id: "bodywork_photos", label: "Body work checked / in-process photos" },
        { id: "battery_protected", label: "Battery non-drained / protected" },
        { id: "parts_inventoried", label: "Parts inventoried" },
        { id: "openings_covered", label: "Openings covered / wrapped" },
        { id: "cart_organized", label: "Parts cart organized and stored" },
      ],
    },
    {
      id: "Paint", color: "#a855f7", icon: "spray",
      items: [
        { id: "painter_slot", label: "Shop Control painter slot assigned" },
        { id: "bodywork_ok", label: "Body work performed to satisfaction" },
        { id: "estimate_reviewed", label: "Estimate reviewed" },
        { id: "paintables_onhand", label: "All paintable parts on-hand" },
        { id: "sprayout_photo", label: "Spray-out / let-down panel photo" },
        { id: "supplement_panels", label: "Supplement given for added panels" },
        { id: "booth_photos", label: "In-booth prepped photos" },
        { id: "color_approved", label: "Final color approved" },
        { id: "runs_nibs", label: "Runs / nibs checked and removed" },
        { id: "unmasked", label: "Properly and fully unmasked" },
      ],
    },
    {
      id: "Reassy", color: "#22c55e", icon: "wrench",
      items: [
        { id: "tech_slot", label: "Shop Control tech slot assigned" },
        { id: "color_ok", label: "Color acceptable before build" },
        { id: "estimate_items", label: "All estimate items performed" },
        { id: "battery_ok", label: "Battery in good starting condition" },
        { id: "no_mils", label: "No dash MILs present after build" },
        { id: "test_drive", label: "Test drive performed (noise / suspension)" },
        { id: "moved_to_final", label: "Shop Control moved to final sublet / detail" },
        { id: "gates_sensors", label: "Auto-gate, sliders, kick sensors work" },
        { id: "lights_sensors", label: "Final light and sensor check" },
        { id: "cart_cleared", label: "Parts cart cleared, large parts tossed, cores returned" },
      ],
    },
    {
      id: "Final QC", color: "#eab308", icon: "shield",
      items: [
        { id: "mils_cleared", label: "Dash MILs cleared" },
        { id: "battery_fuel", label: "Battery / fuel sufficient" },
        { id: "jambs_clean", label: "Jambs and fuel pocket clean" },
        { id: "estimate_lines", label: "All estimate lines performed" },
        { id: "sublets_done", label: "All sublets completed" },
        { id: "courtesy_items", label: "Courtesy items performed" },
        { id: "tech_video", label: "Tech video recorded" },
        { id: "post_scan", label: "Final light / mirror check and post scan done" },
        { id: "final_photos", label: "Final QC photos taken incl. interior / trunk" },
        { id: "final_bill", label: "Final paperwork and final bill prepped" },
        { id: "no_swirls", label: "No swirl marks / compound on vehicle" },
        { id: "care_tag", label: "Paint care tag hung / keychain attached" },
        { id: "customer_notified", label: "Customer notified" },
        { id: "video_sent", label: "Tech video sent to customer" },
      ],
    },
  ];

  const names = departments.map(d => d.id);
  const byId = Object.fromEntries(departments.map(d => [d.id, d]));

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

  return { departments, names, byId, progress, validateChecklist };
});
