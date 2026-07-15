const express = require("express");
const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { logActivity } = require("../activityLogger");
const { sendAssignmentEmail } = require("../taskEmails");

const RESOURCES = {
  daily: {
    table: "daily_go_list",
    columns: [
      "ro_number", "customer_name", "vehicle", "location", "current_stage", "priority",
      "assigned_to", "department_responsible", "hold_up_reason", "target_delivery_date",
      "actual_delivered_date", "customer_updated_today", "estimate_needed", "estimate_completed",
      "supplement_needed", "supplement_submitted", "supplement_approved", "supplement_completed",
      "needs_management_help", "todays_goal", "management_issue", "end_of_day_status",
      "end_of_day_notes", "delivered_at",
    ],
    orderBy: "created_at DESC",
  },
  tasks: {
    table: "tasks",
    columns: [
      "task_name", "task_assigned_to", "task_assigned_by", "task_due_date", "task_priority",
      "task_status", "task_waiting_on", "task_management_notified", "task_notes", "completed_date",
      "task_assigned_email_sent_at", "task_reminder_1h_sent_at", "task_reminder_3h_sent_at",
    ],
    orderBy: "created_at DESC",
  },
  parts: {
    table: "parts",
    columns: [
      "parts_ro_number", "parts_customer_name", "parts_vehicle", "part_description", "part_type",
      "part_vendor", "part_status", "part_priority", "part_ordered_date", "part_eta",
      "part_received_date", "part_mirror_matched", "part_return_needed", "part_credit_needed",
      "part_assigned_to", "part_last_follow_up", "part_notes",
    ],
    orderBy: "created_at DESC",
  },
  qc: {
    table: "qc_records",
    columns: [
      "qc_ro_number", "qc_customer_name", "qc_vehicle", "qc_date", "qc_performed_by",
      "qc_final_status", "qc_body_work", "qc_paint_quality", "qc_color_match", "qc_panel_alignment",
      "qc_electrical", "qc_calibration", "qc_interior", "qc_exterior", "qc_warning_lights",
      "qc_test_drive_needed", "qc_test_drive_completed", "qc_customer_items", "qc_rework_needed",
      "qc_rework_assigned_to", "qc_rework_due_date", "qc_customer_called", "qc_issues", "qc_delivery_notes",
    ],
    orderBy: "created_at DESC",
  },
  booth: {
    table: "booth_inspections",
    columns: [
      "booth_date", "booth_painter", "intake_filters", "exhaust_filters", "rear_filters",
      "filters_changed", "picture_sent", "helper_assisted", "management_verified", "booth_notes",
    ],
    orderBy: "booth_date DESC, created_at DESC",
  },
  facility: {
    table: "facility_checklist",
    columns: [
      "facility_week", "facility_area", "facility_item", "facility_status",
      "facility_completed_by", "facility_verified", "facility_notes",
    ],
    orderBy: "created_at DESC",
  },
};

function cleanValue(value) {
  return value === "" ? null : value;
}

function buildRouterFor(resourceKey, config) {
  const router = express.Router();
  const { table, columns, orderBy } = config;

  router.get("/", requireAuth, requirePermission(resourceKey, "list"), async (req, res) => {
    try {
      const result = await pool.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
      res.json(result.rows);
    } catch (err) {
      console.error(`List ${resourceKey} error:`, err);
      res.status(500).json({ error: `Failed to load ${resourceKey} records.` });
    }
  });

  router.post("/", requireAuth, requirePermission(resourceKey, "create"), async (req, res) => {
    try {
      const body = req.body || {};
      const cols = columns.filter((c) => Object.prototype.hasOwnProperty.call(body, c));
      const values = cols.map((c) => cleanValue(body[c]));

      const allCols = ["created_by", "updated_by", ...cols];
      const allValues = [req.user.fullName || req.user.username, req.user.fullName || req.user.username, ...values];
      const placeholders = allValues.map((_, i) => `$${i + 1}`).join(", ");

      const result = await pool.query(
        `INSERT INTO ${table} (${allCols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
        allValues
      );

      await logActivity({
        req,
        resource: resourceKey,
        recordId: result.rows[0].id,
        action: "create",
        after: result.rows[0],
        summary: `Created ${resourceKey} record`,
      });

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(`Create ${resourceKey} error:`, err);
      res.status(500).json({ error: `Failed to save ${resourceKey} record.` });
    }
  });

  router.put("/:id", requireAuth, requirePermission(resourceKey, "update"), async (req, res) => {
    try {
      const beforeResult = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      const before = beforeResult.rows[0];
      if (!before) {
        return res.status(404).json({ error: "Record not found." });
      }

      const body = req.body || {};
      const cols = columns.filter((c) => Object.prototype.hasOwnProperty.call(body, c));
      const values = cols.map((c) => cleanValue(body[c]));

      const setClauses = cols.map((c, i) => `${c} = $${i + 1}`);
      setClauses.push(`updated_at = now()`);
      setClauses.push(`updated_by = $${cols.length + 1}`);
      const params = [...values, req.user.fullName || req.user.username, req.params.id];

      const result = await pool.query(
        `UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
        params
      );

      await logActivity({
        req,
        resource: resourceKey,
        recordId: result.rows[0].id,
        action: "update",
        before,
        after: result.rows[0],
        summary: `Updated ${resourceKey} record`,
      });

      if (resourceKey === "tasks") {
        const assignedChanged = (before.task_assigned_to || "") !== (result.rows[0].task_assigned_to || "");
        const needsAssignmentEmail = result.rows[0].task_assigned_to && (assignedChanged || !result.rows[0].task_assigned_email_sent_at);
        if (needsAssignmentEmail) {
          const reason = assignedChanged ? "reassigned" : "assigned";
          sendAssignmentEmail(result.rows[0], reason).catch((emailErr) => {
            console.error("Task assignment email failed:", emailErr.message);
          });
        }
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error(`Update ${resourceKey} error:`, err);
      res.status(500).json({ error: `Failed to update ${resourceKey} record.` });
    }
  });

  router.delete("/:id", requireAuth, requirePermission(resourceKey, "delete"), async (req, res) => {
    try {
      const beforeResult = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      const before = beforeResult.rows[0];
      if (!before) {
        return res.status(404).json({ error: "Record not found." });
      }

      const result = await pool.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [req.params.id]);

      await logActivity({
        req,
        resource: resourceKey,
        recordId: result.rows[0].id,
        action: "delete",
        before,
        summary: `Deleted ${resourceKey} record`,
      });

      res.json({ deleted: true, id: result.rows[0].id });
    } catch (err) {
      console.error(`Delete ${resourceKey} error:`, err);
      res.status(500).json({ error: `Failed to delete ${resourceKey} record.` });
    }
  });

  return router;
}

function mountRecordRoutes(app) {
  Object.entries(RESOURCES).forEach(([key, config]) => {
    app.use(`/api/${key}`, buildRouterFor(key, config));
  });
}

module.exports = { mountRecordRoutes, RESOURCES };
