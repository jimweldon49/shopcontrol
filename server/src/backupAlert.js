// Emails active admins and owners when an automatic backup fails (scripts/backup.sh).
//   node src/backupAlert.js "<subject>" "<what went wrong>"
require("dotenv").config();
const { pool } = require("./db");
const { sendTaskEmail, smtpConfigured } = require("./mailer");

async function main() {
  const [subject, detail] = process.argv.slice(2);
  if (!smtpConfigured()) return console.error("Backup alert not sent: email isn't set up.");
  const to = (await pool.query(
    "SELECT email FROM users WHERE active = true AND role IN ('admin','owner') AND email IS NOT NULL AND email <> ''")).rows.map((r) => r.email);
  if (!to.length) return console.error("Backup alert not sent: no admin or owner has an email address.");
  await sendTaskEmail({
    to: to.join(", "), subject, title: subject,
    bodyLines: [detail, "The details are in ~/backups/auto/backup.log on the ShopControl server.", "Until this is fixed, recent work isn't backed up."],
  });
  console.log(`Backup alert sent to ${to.length} admin(s).`);
}
main().catch((e) => console.error("Backup alert failed:", e.message)).finally(() => pool.end());
