const { Pool, types } = require("pg");

// By default node-postgres parses DATE columns into JS Date objects in the
// server's local timezone, which then shifts by a day once serialized back
// out. The client only ever wants plain "YYYY-MM-DD" strings for <input type="date">
// fields, so keep DATE values as the raw string Postgres returns.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  // A background/idle client errored - log it but don't crash the whole server
  console.error("Unexpected error on idle Postgres client", err);
});

module.exports = { pool };
