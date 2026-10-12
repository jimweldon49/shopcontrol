const { pool } = require("./db");
const { sendTaskEmail, smtpConfigured } = require("./mailer");
const { loadBoard, techsByDepartment, shopDate } = require("./routes/techBoard");

// End of the shop day (5:00 PM Pacific, Monday to Friday): every hot car on the Tech Board
// that isn't finished gets an email to the techs on it (everyone in the department for
// "Any Tech") and to office staff, managers, admins and owners. Once a day; unfinished cars
// stay on the board and roll over to the next day on their own.
const SEND_AT = { hour: 17, minute: 0 };
const WEEKDAYS = [1, 2, 3, 4, 5];
const OFFICE_ROLES = ["owner", "admin", "manager", "office"];
const TZ = () => process.env.BUSINESS_TIMEZONE || "America/Los_Angeles";

function shopClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ(), weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(now).map((p) => [p.type, p.value]));
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const isSendTime = (now = new Date()) => { const c = shopClock(now); return WEEKDAYS.includes(c.day) && c.minutes >= SEND_AT.hour * 60 + SEND_AT.minute; };

// Unfinished hot cars, each with the departments still open and who's on them.
function unfinishedHot(board) {
  return board.jobs.filter((j) => j.hot && !j.done).map((j) => ({ ...j, open: j.departments.filter((d) => !d.done) }));
}

// email -> the cars that person hears about. Techs get the cars they're on; office gets all.
function recipientsFor(cars, techs, users) {
  const byId = new Map(users.map((u) => [u.id, u]));
  const out = new Map();
  const add = (u, car) => {
    if (!u || !u.email) return;
    if (!out.has(u.email)) out.set(u.email, { name: u.full_name, cars: [] });
    const list = out.get(u.email).cars;
    if (!list.includes(car)) list.push(car);
  };
  for (const car of cars) {
    for (const d of car.open) {
      const ids = d.anyTech ? (techs[d.department] || []).map((t) => t.id) : [];
      for (const id of [...ids, ...d.users.map((u) => u.id)]) add(byId.get(id), car);
    }
    for (const u of users) if (OFFICE_ROLES.includes(String(u.role || "").toLowerCase())) add(u, car);
  }
  return out;
}

function carLines(car) {
  const who = (d) => [...(d.anyTech ? [d.department === "Paint" ? "Any Painter" : "Any Tech"] : []), ...d.users.map((u) => u.name)].join(", ");
  return [
    `RO ${car.roNumber} · ${String(car.vehicle || "").split(" / ")[0]} · ${car.customerName || ""}`,
    ...car.open.map((d) => `   ${d.department}: ${who(d)} (${d.progress.done} of ${d.progress.total} checked${d.signedBy.length ? `, signed by ${d.signedBy.join(", ")} with items left` : ""})`),
    car.daysOver > 0 ? `   On the board since ${car.addedOn} (${car.daysOver} day${car.daysOver === 1 ? "" : "s"})` : "",
  ].filter(Boolean);
}

async function checkHotCarAlerts(now = new Date()) {
  if (!isSendTime(now) || !smtpConfigured()) return { sent: 0 };
  const day = shopDate(now);
  if ((await pool.query("SELECT 1 FROM tech_board_alert_days WHERE day = $1", [day])).rows.length) return { sent: 0 };
  const board = await loadBoard();
  const cars = unfinishedHot(board);
  if (!cars.length) {
    await pool.query("INSERT INTO tech_board_alert_days(day, cars, recipients) VALUES($1, 0, 0) ON CONFLICT DO NOTHING", [day]);
    return { sent: 0 };
  }
  const [techs, users] = await Promise.all([techsByDepartment(), pool.query(
    "SELECT id, full_name, email, role FROM users WHERE active = true AND receives_notifications = true AND email IS NOT NULL AND email <> ''").then((r) => r.rows)]);
  const recipients = recipientsFor(cars, techs, users);
  // Claim the day first so two servers or a restart can't send it twice.
  const claimed = (await pool.query(
    "INSERT INTO tech_board_alert_days(day, cars, recipients) VALUES($1, $2, $3) ON CONFLICT DO NOTHING RETURNING day", [day, cars.length, recipients.size])).rows.length;
  if (!claimed) return { sent: 0 };
  let sent = 0;
  for (const [email, r] of recipients) {
    const n = r.cars.length;
    const subject = `HOT car${n === 1 ? "" : "s"} not finished today: ${r.cars.map((c) => `RO ${c.roNumber}`).join(", ")}`;
    try {
      const result = await sendTaskEmail({
        to: email, subject, title: `${n} hot car${n === 1 ? " isn't" : "s aren't"} finished`,
        bodyLines: [
          `${n === 1 ? "This hot car is" : "These hot cars are"} still open on the Tech Board at the end of the day. ${n === 1 ? "It rolls" : "They roll"} over to tomorrow and stay${n === 1 ? "s" : ""} at the top of the list until the department QC is fully checked and signed.`,
          "",
          ...r.cars.flatMap((c) => [...carLines(c), ""]),
          "Open ShopControl → Tech Board, or Next up in the Employee App.",
        ],
      });
      if (result.sent) sent++;
    } catch (e) { console.error("Hot car email failed:", e.message); }
  }
  console.log(`Tech Board: ${cars.length} unfinished hot car(s), emailed ${sent} of ${recipients.size} people.`);
  return { sent, cars: cars.length };
}

function startTechBoardAlerts() {
  if (String(process.env.TECH_BOARD_ALERTS_ENABLED || "true").toLowerCase() === "false") {
    console.log("Tech Board hot car alerts disabled.");
    return;
  }
  const run = () => checkHotCarAlerts().catch((e) => console.error("Tech Board alert check failed:", e.message));
  setInterval(run, 5 * 60 * 1000);
  setTimeout(run, 30 * 1000);
  console.log("Tech Board hot car alerts enabled: weekdays at 5:00 PM.");
}

module.exports = { startTechBoardAlerts, checkHotCarAlerts, isSendTime, unfinishedHot, recipientsFor, carLines };
