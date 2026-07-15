const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { logActivity } = require("../activityLogger");

const router = express.Router();

const uploadRoot = process.env.UPLOAD_DIR || path.join(__dirname, "..", "..", "uploads");
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadRoot),
  filename: (req, file, cb) => {
    const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeOriginal}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_UPLOAD_BYTES || "10485760", 10) },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only images and PDFs are allowed."));
    }
    cb(null, true);
  },
});

router.get("/", requireAuth, requirePermission("uploads", "list"), async (req, res) => {
  try {
    const { resource, recordId } = req.query;
    const params = [];
    const where = [];
    if (resource) {
      params.push(resource);
      where.push(`resource = $${params.length}`);
    }
    if (recordId) {
      params.push(recordId);
      where.push(`record_id = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT id, resource, record_id, original_name, mime_type, size_bytes, file_url, note, uploaded_by, created_at
       FROM attachments
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY created_at DESC
       LIMIT 500`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error("List uploads error:", err);
    res.status(500).json({ error: "Failed to load uploads." });
  }
});

router.post("/:resource/:recordId", requireAuth, requirePermission("uploads", "upload"), upload.single("file"), async (req, res) => {
  try {
    const { resource, recordId } = req.params;
    const note = req.body.note || "";
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const fileUrl = `/uploads/${req.file.filename}`;
    const result = await pool.query(
      `INSERT INTO attachments
       (resource, record_id, original_name, stored_name, mime_type, size_bytes, file_url, note, uploaded_by, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        resource,
        recordId,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        fileUrl,
        note,
        req.user.fullName || req.user.username,
        req.user.id || null,
      ]
    );

    await logActivity({
      req,
      resource,
      recordId,
      action: "upload",
      after: result.rows[0],
      summary: `Uploaded ${req.file.originalname}`,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message || "Upload failed." });
  }
});

module.exports = router;
