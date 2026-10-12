// Every sign-off on a department QC checklist, kept in qc_records.qc_signatures so a
// second person signing doesn't replace the first. Each entry records who signed, when,
// their signature and the items they checked themselves (what they signed for). The
// list is built here on the server from the signed-in user; clients can't write it.
// qc_signature_data / qc_signed_at / qc_performed_by still hold the latest sign-off.
const qcChecklists = require("../../client/qcChecklists");

// Items in the checklist that are checked and were checked by `name`.
function itemsCheckedBy(departmentId, checklist, name) {
  const dept = qcChecklists.byId[departmentId];
  const items = (checklist && checklist.items) || {};
  if (!dept) return [];
  return dept.items.filter((i) => items[i.id] && items[i.id].done && items[i.id].by === name).map((i) => i.id);
}

// The signature list after `user` signs. One entry per person: signing again replaces
// their earlier entry, since the newer one covers everything they've checked so far.
function addSignature(existing, { user, departmentId, checklist, signature, signedAt, status, rework }) {
  const name = user.fullName || user.username || "";
  const entry = {
    by: name,
    userId: user.id || null,
    at: signedAt || new Date().toISOString(),
    signature,
    items: itemsCheckedBy(departmentId, checklist, name),
    status: status || null,
    rework: rework === "Yes",
  };
  const list = Array.isArray(existing) ? existing : [];
  const others = list.filter((s) => (entry.userId && s.userId ? s.userId !== entry.userId : s.by !== name));
  return [...others, entry];
}

module.exports = { addSignature, itemsCheckedBy };
