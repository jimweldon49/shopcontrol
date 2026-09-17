const express = require("express");
const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { logActivity } = require("../activityLogger");

const router = express.Router();
router.use(requireAuth);

const ONSITE_EXCLUDED_STATUSES = ["Complete", "Returned", "Credit Pending"];

function fail(res, e) {
  console.error("Inventory locations request:", e.message);
  return res.status(e.status || 400).json({ error: e.message });
}

function validateLocation(b) {
  if (!["cart", "storage"].includes(b.kind)) throw Error("Choose a location type.");
  if (!b.name?.trim()) throw Error("A name is required.");
  if (!b.zone?.trim()) throw Error("A floor-plan zone is required.");
  if (b.kind === "cart") {
    const shelfCount = Number(b.shelf_count);
    if (!Number.isInteger(shelfCount) || shelfCount < 1 || shelfCount > 20) throw Error("Number of shelves must be between 1 and 20.");
  }
}

async function onsitePartsFor(locationId) {
  return (await pool.query(
    `SELECT id, parts_ro_number, part_shelf FROM parts
     WHERE part_location=$1 AND part_status NOT IN ('${ONSITE_EXCLUDED_STATUSES.join("','")}')`,
    [locationId]
  )).rows;
}

router.get("/", requirePermission("parts", "list"), async (req, res) => {
  try {
    res.json((await pool.query("SELECT * FROM inventory_locations ORDER BY zone, name")).rows);
  } catch (e) { fail(res, e); }
});

router.post("/", requirePermission("parts", "create"), async (req, res) => {
  try {
    validateLocation(req.body);
    const ros = req.body.kind === "cart" ? [...new Set((req.body.ros || []).map(s => String(s).trim()).filter(Boolean))] : [];
    if (ros.length > 1 && req.body.confirm_same_car !== true) {
      throw Error("Confirm the linked ROs belong to the same car.");
    }
    const dupe = await pool.query("SELECT 1 FROM inventory_locations WHERE lower(name)=lower($1)", [req.body.name.trim()]);
    if (dupe.rows.length) throw Error("A cart or location with that name already exists.");

    const who = req.user.fullName || req.user.username;
    const result = await pool.query(
      `INSERT INTO inventory_locations(kind, name, zone, shelf_count, has_top, ros, created_by, updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
      [req.body.kind, req.body.name.trim(), req.body.zone.trim(), req.body.kind === "cart" ? Number(req.body.shelf_count) : null, !!req.body.has_top, ros, who]
    );
    const row = result.rows[0];
    await logActivity({ req, resource: "inventoryLocations", recordId: row.id, action: "create", after: row, summary: `Added ${row.kind} "${row.name}"` });
    res.status(201).json(row);
  } catch (e) { fail(res, e); }
});

router.put("/:id", requirePermission("parts", "update"), async (req, res) => {
  try {
    validateLocation(req.body);
    const before = (await pool.query("SELECT * FROM inventory_locations WHERE id=$1", [req.params.id])).rows[0];
    if (!before) return res.status(404).json({ error: "Location not found." });

    const ros = req.body.kind === "cart" ? [...new Set((req.body.ros || []).map(s => String(s).trim()).filter(Boolean))] : [];
    if (ros.length > 1 && req.body.confirm_same_car !== true) {
      throw Error("Confirm the linked ROs belong to the same car.");
    }
    const dupe = await pool.query("SELECT 1 FROM inventory_locations WHERE lower(name)=lower($1) AND id<>$2", [req.body.name.trim(), req.params.id]);
    if (dupe.rows.length) throw Error("A cart or location with that name already exists.");

    const shelfCount = req.body.kind === "cart" ? Number(req.body.shelf_count) : null;
    const hasTop = !!req.body.has_top;
    const existingParts = await onsitePartsFor(req.params.id);
    for (const p of existingParts) {
      if (req.body.kind === "cart") {
        if (p.part_shelf === "Top" && !hasTop) throw Error("Move existing parts off the top storage area before removing it.");
        if (p.part_shelf && p.part_shelf !== "Top" && Number(p.part_shelf) > shelfCount) throw Error("Move existing parts off the removed shelves before shrinking this cart.");
        if (ros.length && !ros.includes(p.parts_ro_number)) throw Error("Move existing parts before removing their RO from this cart.");
      } else if (before.kind === "cart") {
        throw Error("Move existing parts off this cart before converting it to a storage location.");
      }
    }

    const who = req.user.fullName || req.user.username;
    const result = await pool.query(
      `UPDATE inventory_locations SET kind=$1, name=$2, zone=$3, shelf_count=$4, has_top=$5, ros=$6, updated_at=now(), updated_by=$7 WHERE id=$8 RETURNING *`,
      [req.body.kind, req.body.name.trim(), req.body.zone.trim(), shelfCount, hasTop, ros, who, req.params.id]
    );
    const row = result.rows[0];
    await logActivity({ req, resource: "inventoryLocations", recordId: row.id, action: "update", before, after: row, summary: `Updated ${row.kind} "${row.name}"` });
    res.json(row);
  } catch (e) { fail(res, e); }
});

router.delete("/:id", requirePermission("parts", "delete"), async (req, res) => {
  try {
    const existingParts = await onsitePartsFor(req.params.id);
    if (existingParts.length) throw Error("Move existing parts out of this location before deleting it.");
    const result = await pool.query("DELETE FROM inventory_locations WHERE id=$1 RETURNING *", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Location not found." });
    await logActivity({ req, resource: "inventoryLocations", recordId: req.params.id, action: "delete", before: result.rows[0], summary: `Removed ${result.rows[0].kind} "${result.rows[0].name}"` });
    res.json({ deleted: true });
  } catch (e) { fail(res, e); }
});

module.exports = router;
