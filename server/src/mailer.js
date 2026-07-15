const nodemailer = require("nodemailer");

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function makeTransport() {
  if (!smtpConfigured()) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendPasswordResetEmail({ to, name, resetUrl, expiresMinutes }) {
  const transport = makeTransport();
  if (!transport) {
    console.warn("SMTP is not configured. Password reset link:", resetUrl);
    return { sent: false, reason: "smtp_not_configured", resetUrl };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = "Concept Shop Control password reset";

  const text = `Hello ${name || ""},

A password reset was requested for your Concept Shop Control account.

Reset your password using this link:
${resetUrl}

This link expires in ${expiresMinutes} minutes.

If you did not request this, ignore this email.`;

  const html = `
    <p>Hello ${name || ""},</p>
    <p>A password reset was requested for your <strong>Concept Shop Control</strong> account.</p>
    <p><a href="${resetUrl}">Reset your password</a></p>
    <p>This link expires in ${expiresMinutes} minutes.</p>
    <p>If you did not request this, ignore this email.</p>
  `;

  await transport.sendMail({ from, to, subject, text, html });
  return { sent: true };
}


async function sendTaskEmail({ to, cc, subject, title, bodyLines }) {
  const transport = makeTransport();
  if (!transport) {
    console.warn("SMTP is not configured. Task email not sent:", { to, cc, subject, bodyLines });
    return { sent: false, reason: "smtp_not_configured" };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const text = `${title}

${(bodyLines || []).join("\n")}`;

  const html = `
    <h2>${title}</h2>
    <ul>
      ${(bodyLines || []).map(line => `<li>${String(line || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</li>`).join("")}
    </ul>
  `;

  await transport.sendMail({
    from,
    to,
    cc: cc || undefined,
    subject,
    text,
    html,
  });

  return { sent: true };
}

module.exports = { sendPasswordResetEmail, sendTaskEmail, smtpConfigured };

