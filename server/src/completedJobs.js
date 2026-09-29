// Delivered and total-loss jobs are the shop's record of the repair, so only an admin or
// owner can delete them (or the parts on them). Everyone else gets a message instead.
const COMPLETED_STAGES = ["Delivered", "Total Loss"];
const ADMIN_ROLES = ["admin", "owner"];

// Returns an error message when the delete should be blocked, otherwise null.
async function completedJobGuard(db, user, resource, rows) {
  if (ADMIN_ROLES.includes(String((user && user.role) || "").toLowerCase())) return null;
  if (resource === "daily") {
    return rows.some((r) => r && COMPLETED_STAGES.includes(r.current_stage))
      ? "Completed jobs are kept for the shop's records. Ask an admin if this one really needs to be deleted."
      : null;
  }
  if (resource === "parts") {
    const ros = [...new Set(rows.map((r) => String((r && r.parts_ro_number) || "").trim()).filter(Boolean))];
    if (!ros.length) return null;
    const hit = (await db.query(
      `SELECT 1 FROM daily_go_list
       WHERE current_stage = ANY($1) AND merged_into IS NULL
         AND (btrim(ro_number) = ANY($2) OR btrim(coalesce(ccc_estfile_id, '')) = ANY($2))
       LIMIT 1`, [COMPLETED_STAGES, ros])).rows.length;
    return hit ? "These parts belong to a completed job and are kept for the shop's records. Ask an admin if they really need to be deleted." : null;
  }
  return null;
}

module.exports = { COMPLETED_STAGES, completedJobGuard };
