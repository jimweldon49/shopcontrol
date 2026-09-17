// Shared one-car-per-cart enforcement, used by the single-part PUT (records.js), the bulk
// parts move (workspace.js), and available for the inventory locations route. A cart with no
// linked RO yet is auto-claimed by whichever RO is placed on it first; a cart already linked
// to one or more ROs only accepts a part whose RO is in that list. Storage locations (kind !==
// 'cart') have no RO restriction at all.
async function assertCartAssignment(pool, roNumber, locationId) {
  if (!locationId) return;
  const ro = String(roNumber || "").trim();
  if (!ro) throw Error("An RO number is required before placing a part in a cart or location.");

  const location = (await pool.query("SELECT * FROM inventory_locations WHERE id=$1", [locationId])).rows[0];
  if (!location) throw Error("That cart or storage location no longer exists. Refresh and try again.");
  if (location.kind !== "cart") return;

  if (location.ros.length && !location.ros.includes(ro)) {
    throw Error(`${location.name} belongs to another RO. Choose an available cart, or explicitly link this RO in Manage Locations if it is the same car.`);
  }
  if (!location.ros.length) {
    await pool.query("UPDATE inventory_locations SET ros=$1, updated_at=now() WHERE id=$2", [[ro], locationId]);
  }
}

module.exports = { assertCartAssignment };
