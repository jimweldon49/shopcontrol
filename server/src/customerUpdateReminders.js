const { pool } = require("./db");

// Flips "Customer Updated" back to No once the next customer update is due (see
// migrations/018 for the schedule), so the car reappears under Customer Updates
// Needed. Later this is where automated texts / calls would hook in.
async function processCustomerUpdateReminders() {
  const result = await pool.query(
    `UPDATE daily_go_list SET customer_updated_today = 'No', updated_at = now(), updated_by = 'Customer Update Schedule'
     WHERE onsite AND merged_into IS NULL AND customer_updated_today = 'Yes'
       AND customer_update_due_at(onsite_at, customer_updated_at, ro_amount, board_flags) <= now()
     RETURNING ro_number`
  );
  if (result.rowCount) console.log(`Customer update due for RO ${result.rows.map(r => r.ro_number).join(", ")}`);
  return result.rowCount;
}

function startCustomerUpdateReminders() {
  if (String(process.env.CUSTOMER_UPDATE_REMINDERS_ENABLED || "true").toLowerCase() === "false") {
    console.log("Customer update reminders disabled.");
    return;
  }
  const intervalMs = Number(process.env.CUSTOMER_UPDATE_SCAN_MS || 600000);
  const run = () => processCustomerUpdateReminders().catch(err => console.error("Customer update reminders:", err.message));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  console.log(`Customer update reminders enabled. Interval: ${intervalMs}ms`);
}

module.exports = { startCustomerUpdateReminders, processCustomerUpdateReminders };
