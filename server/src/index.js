require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const activityRoutes = require("./routes/activity");
const uploadRoutes = require("./routes/uploads");
const { router: importRoutes } = require("./routes/import");
const { mountRecordRoutes } = require("./routes/records");
const { startEmsWatcher } = require("./emsWatcher");
const { startTaskReminderScheduler } = require("./taskEmails");
const { startCycleAlertScheduler } = require("./cycleTimeAlerts");
const { startMissedCallScheduler } = require("./missedCallAlerts");
const { startPartsAgingAlerts } = require("./partsAgingAlerts");

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((s) => s.trim()) }));
app.use(express.json({ limit: "4mb" }));
app.use("/uploads", express.static(process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads")));

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/import", importRoutes);
app.use('/api/workspace',require('./routes/workspace'));
app.use('/api/missedCalls', require('./routes/missedCalls'));
app.use('/api/inventoryLocations', require('./routes/inventory'));
app.use('/api/staff', require('./routes/staff'));
mountRecordRoutes(app); // registers /api/daily, /api/tasks, /api/parts, /api/qc, /api/booth, /api/facility

startEmsWatcher();
startTaskReminderScheduler();
startCycleAlertScheduler();
startMissedCallScheduler();
startPartsAgingAlerts();
require('./coreNotifications').startCoreNotifications();
require('./customerUpdateReminders').startCustomerUpdateReminders();
// The web app and employee app share this server and login origin.
// no-cache makes browsers check for a newer copy on every load (a cheap 304 when
// unchanged), so updates show up without anyone having to force-refresh.
app.use(express.static(path.join(__dirname,'..','..','client'),{setHeaders:res=>res.setHeader('Cache-Control','no-cache')}));

// Fallback error handler for anything that slips through
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

const PORT = process.env.PORT || 4000;
const HTTPS_PORT = process.env.HTTPS_PORT || PORT;
const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const SSL_CA_PATH = process.env.SSL_CA_PATH;
const FORCE_HTTPS = String(process.env.FORCE_HTTPS || "false").toLowerCase() === "true";

if (FORCE_HTTPS) {
  app.use((req, res, next) => {
    if (req.secure || req.headers["x-forwarded-proto"] === "https") return next();
    return res.redirect(`https://${req.headers.host}${req.url}`);
  });
}

if (SSL_KEY_PATH && SSL_CERT_PATH && fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
  const httpsOptions = {
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH),
  };
  if (SSL_CA_PATH && fs.existsSync(SSL_CA_PATH)) {
    httpsOptions.ca = fs.readFileSync(SSL_CA_PATH);
  }

  https.createServer(httpsOptions, app).listen(HTTPS_PORT, () => {
    console.log(`Concept Shop Control API listening with HTTPS on port ${HTTPS_PORT}`);
  });

  if (process.env.HTTP_PORT) {
    http.createServer(app).listen(process.env.HTTP_PORT, () => {
      console.log(`Concept Shop Control HTTP listener on port ${process.env.HTTP_PORT}`);
    });
  }
} else {
  app.listen(PORT, process.env.HOST || '0.0.0.0', () => {
    console.log(`Concept Shop Control API listening on port ${PORT}`);
    if (SSL_KEY_PATH || SSL_CERT_PATH) {
      console.warn("SSL_KEY_PATH or SSL_CERT_PATH was set, but the file was not found. Starting HTTP only.");
    }
  });
}
