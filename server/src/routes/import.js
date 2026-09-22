const express = require("express");
const multer = require("multer");
const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { logActivity } = require("../activityLogger");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 50 } });

function readUIntLE(buf, offset, length) {
  let value = 0;
  for (let i = 0; i < length; i++) value += buf[offset + i] << (8 * i);
  return value;
}

function parseDbf(buffer) {
  if (!buffer || buffer.length < 64) throw new Error("File is too small to be a valid EMS/DBF file.");

  const numRecords = readUIntLE(buffer, 4, 4);
  const headerLength = readUIntLE(buffer, 8, 2);
  const recordLength = readUIntLE(buffer, 10, 2);

  if (!headerLength || !recordLength || headerLength >= buffer.length) {
    throw new Error("Could not read EMS/DBF header.");
  }

  const fields = [];
  let offset = 32;
  while (offset + 32 <= buffer.length && buffer[offset] !== 0x0d) {
    const desc = buffer.subarray(offset, offset + 32);
    const name = desc.subarray(0, 11).toString("latin1").replace(/\0.*$/, "").trim();
    const type = String.fromCharCode(desc[11]);
    const length = desc[16];
    const decimals = desc[17];
    if (name) fields.push({ name, type, length, decimals });
    offset += 32;
  }

  const records = [];
  let pos = headerLength;
  for (let r = 0; r < numRecords; r++) {
    const rowBuffer = buffer.subarray(pos, pos + recordLength);
    if (rowBuffer.length < recordLength) break;
    pos += recordLength;
    if (rowBuffer[0] === 0x2a) continue;

    const row = {};
    let cursor = 1;
    for (const field of fields) {
      const raw = rowBuffer.subarray(cursor, cursor + field.length);
      const text = raw.toString("latin1").trim();

      let value = text;
      if (field.type === "D" && /^\d{8}$/.test(text)) {
        value = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
      } else if ((field.type === "N" || field.type === "F") && text !== "") {
        const parsed = Number(text);
        value = Number.isNaN(parsed) ? text : parsed;
      }

      row[field.name] = value;
      cursor += field.length;
    }
    records.push(row);
  }

  return { fields, records, numRecords, headerLength, recordLength };
}

function normalizeDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
}

function firstValue(row, names) {
  if (!row) return "";
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "") {
      return String(row[name]).trim();
    }
  }
  return "";
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

function fullYear(twoOrFour) {
  const s = String(twoOrFour || "").trim();
  if (/^\d{4}$/.test(s)) return s;
  if (/^\d{2}$/.test(s)) return Number(s) >= 80 ? `19${s}` : `20${s}`;
  return s;
}

function makeName(fn, ln, fallback) {
  const full = [fn, ln].filter(Boolean).join(" ").trim();
  return full || fallback || "";
}

function mapMake(code, desc) {
  if (desc) return desc;
  const c = String(code || "").toUpperCase();
  const map = {
    HOND: "Honda", TOYT: "Toyota", CHEV: "Chevrolet", GMC: "GMC", FORD: "Ford",
    NISS: "Nissan", DODG: "Dodge", RAM: "Ram", JEEP: "Jeep", BMW: "BMW",
    MERZ: "Mercedes-Benz", BENZ: "Mercedes-Benz", AUDI: "Audi", TESL: "Tesla",
    HYUN: "Hyundai", KIA: "Kia", SUBA: "Subaru", MAZD: "Mazda", VOLK: "Volkswagen",
    ACUR: "Acura", LEXS: "Lexus", INFI: "Infiniti", CADI: "Cadillac", BUIC: "Buick",
  };
  return map[c] || code || "";
}

function buildPackage(files) {
  const parsed = {};
  const parseErrors = [];

  for (const file of files) {
    const original = file.originalname || "upload";
    const ext = original.includes(".") ? original.split(".").pop().toLowerCase() : original.toLowerCase();
    try {
      parsed[ext] = parseDbf(file.buffer);
    } catch (err) {
      parseErrors.push(`${original}: ${err.message}`);
    }
  }

  return { parsed, parseErrors };
}

function getFirst(parsed, ext) {
  return parsed[ext]?.records?.[0] || {};
}

function buildCustomerName(ad1, ad2) {
  const owner = makeName(firstValue(ad1, ["OWNR_FN", "INSD_FN"]), firstValue(ad1, ["OWNR_LN", "INSD_LN"]));
  if (owner) return owner;

  // Commercial/fleet jobs (e.g. "Ceres Unified") have no owner first/last name in CCC,
  // only a company name. Without this they fell through to the estimator contact and
  // showed up under a staff member's name instead of the customer's.
  const company = firstValue(ad1, ["OWNR_CO_NM", "INSD_CO_NM"]);
  if (company) return company;

  const insured = makeName(firstValue(ad1, ["INSD_FN"]), firstValue(ad1, ["INSD_LN"]));
  if (insured) return insured;

  const claimantCompany = firstValue(ad2, ["CLMT_CO_NM"]);
  if (claimantCompany) return claimantCompany;

  const claimant = makeName(firstValue(ad2, ["CLMT_FN"]), firstValue(ad2, ["CLMT_LN"]));
  if (claimant) return claimant;

  const estimatorContact = makeName(firstValue(ad2, ["EST_CT_FN"]), firstValue(ad2, ["EST_CT_LN"]));
  return estimatorContact || "CCC Import";
}

function buildVehicle(veh) {
  const year = fullYear(firstValue(veh, ["V_MODEL_YR", "VEH_YEAR", "VEH_YR", "YEAR"]));
  const make = mapMake(firstValue(veh, ["V_MAKECODE", "VEH_MAKE", "MAKE"]), firstValue(veh, ["V_MAKEDESC"]));
  const model = firstValue(veh, ["V_MODEL", "VEH_MODEL", "MODEL"]);
  const vin = firstValue(veh, ["V_VIN", "VIN", "VEH_VIN"]);
  const color = firstValue(veh, ["V_COLOR"]);
  const plate = firstValue(veh, ["PLATE_NO"]);

  const base = [year, make, model].filter(Boolean).join(" ").trim();
  const extras = [];
  if (vin) extras.push(`VIN ${vin}`);
  if (color) extras.push(color);
  if (plate) extras.push(`Plate ${plate}`);
  if (base && extras.length) return `${base} / ${extras.join(" / ")}`;
  return base || (vin ? `VIN ${vin}` : "Vehicle from CCC");
}

function buildRoNumber(env, ad1, ad2) {
  return firstValue(env, ["RO_ID"]) ||
    firstValue(ad2, ["EST_FILENO"]) ||
    firstValue(env, ["ESTFILE_ID"]) ||
    firstValue(ad1, ["CLM_NO", "ASGN_NO"]) ||
    `CCC-${Date.now()}`;
}

// env.RO_ID is often blank on the initial estimate (before the shop's RO number
// is entered into CCC) and only gets populated on a later supplement. env.ESTFILE_ID
// is CCC's own package/file id and stays constant across the estimate and every
// supplement for the same job, so it's used to keep re-imports matched to the same
// Daily GO List record even after the "real" RO number appears. See migrations/011.
function buildEstFileId(env) {
  return firstValue(env, ["ESTFILE_ID"]) || null;
}

function buildSummaryNotes({ env, ad1, ad2, veh, ttl, stl, lin }) {
  const notes = [];

  const claim = firstValue(ad1, ["CLM_NO"]);
  const insurance = firstValue(ad1, ["INS_CO_NM"]);
  const policy = firstValue(ad1, ["POLICY_NO"]);
  const deductible = firstValue(ad1, ["DED_AMT"]);
  const lossDate = normalizeDate(firstValue(ad1, ["LOSS_DATE"]));
  const suppNo = firstValue(env, ["SUPP_NO"]);
  const transType = firstValue(env, ["TRANS_TYPE"]);
  const createDate = normalizeDate(firstValue(env, ["CREATE_DT"]));
  const estimator = firstValue(ad2, ["RF_ESTIMTR", "EST_CT_LN", "EST_CT_FN"]);
  const roIn = normalizeDate(firstValue(ad2, ["RO_IN_DATE"]));
  const mileage = firstValue(veh, ["V_MILEAGE"]);
  const paint = [firstValue(veh, ["V_COLOR"]), firstValue(veh, ["PAINT_CD1"])].filter(Boolean).join(" / ");

  notes.push("Imported from CCC EMS file set.");
  if (insurance) notes.push(`Insurance: ${insurance}.`);
  if (claim) notes.push(`Claim #: ${claim}.`);
  if (policy) notes.push(`Policy #: ${policy}.`);
  if (deductible) notes.push(`Deductible: $${money(deductible)}.`);
  if (lossDate) notes.push(`Loss date: ${lossDate}.`);
  if (suppNo) notes.push(`Supplement: ${suppNo}.`);
  if (transType) notes.push(`CCC transaction type: ${transType}.`);
  if (createDate) notes.push(`CCC created date: ${createDate}.`);
  if (estimator) notes.push(`Estimator: ${estimator}.`);
  if (roIn) notes.push(`RO in date: ${roIn}.`);
  if (mileage) notes.push(`Mileage: ${mileage}.`);
  if (paint) notes.push(`Color / paint code: ${paint}.`);

  if (ttl) {
    if (ttl.G_TTL_AMT) notes.push(`Gross total: $${money(ttl.G_TTL_AMT)}.`);
    if (ttl.N_TTL_AMT) notes.push(`Net total: $${money(ttl.N_TTL_AMT)}.`);
    if (ttl.SUPP_AMT) notes.push(`Supplement amount: $${money(ttl.SUPP_AMT)}.`);
    if (ttl.G_TAX) notes.push(`Tax: $${money(ttl.G_TAX)}.`);
  }

  if (Array.isArray(stl) && stl.length) {
    const labor = stl.find(r => r.TTL_TYPE === "LA" || r.TTL_TYPECD === "LAT");
    if (labor?.TTL_HRS) notes.push(`Labor hours: ${labor.TTL_HRS}.`);
  }

  if (Array.isArray(lin) && lin.length) {
    notes.push(`Estimate lines imported/found: ${lin.length}.`);
  }

  return notes.join(" ");
}

function buildDailyFromPackage(parsed) {
  const env = getFirst(parsed, "env");
  const ad1 = getFirst(parsed, "ad1");
  const ad2 = getFirst(parsed, "ad2");
  const veh = getFirst(parsed, "veh");
  const ttl = getFirst(parsed, "ttl");
  const stl = parsed.stl?.records || [];
  const lin = parsed.lin?.records || [];

  const targetDate = normalizeDate(firstValue(ad2, ["TAR_DATE", "TARGET_DATE", "PROMISE_DATE"]));
  const estimator = firstValue(ad2, ["RF_ESTIMTR", "EST_CT_LN", "EST_CT_FN"]);
  const locationText = `${firstValue(ad2, ["LOC_NM", "RF_CO_NM"])} ${firstValue(ad2, ["LOC_CITY", "RF_CITY"])}`;
  const location = /modesto/i.test(locationText) ? "Modesto" : "Ceres";
  const suppNo = firstValue(env, ["SUPP_NO"]);
  const transType = firstValue(env, ["TRANS_TYPE"]);
  const grossTotal = ttl ? firstValue(ttl, ["G_TTL_AMT"]) : "";
  const roAmount = grossTotal !== "" && grossTotal !== undefined && Number.isFinite(Number(grossTotal))
    ? Number(grossTotal)
    : null;

  return {
    ro_number: buildRoNumber(env, ad1, ad2),
    ccc_estfile_id: buildEstFileId(env),
    customer_name: buildCustomerName(ad1, ad2),
    vehicle: buildVehicle(veh),
    location,
    current_stage: "Check-In",
    priority: targetDate ? "Normal" : "Normal",
    assigned_to: estimator || "",
    department_responsible: "Estimator",
    hold_up_reason: suppNo ? "Supplement" : "None",
    target_delivery_date: targetDate,
    actual_delivered_date: null,
    customer_updated_today: "No",
    estimate_needed: "Yes",
    estimate_completed: transType ? "Yes" : "No",
    supplement_needed: suppNo ? "Yes" : "No",
    supplement_submitted: suppNo ? "Yes" : "No",
    supplement_approved: "No",
    supplement_completed: "No",
    needs_management_help: "No",
    todays_goal: "Review imported CCC EMS file set, confirm estimate/supplement status, and update vehicle stage.",
    management_issue: "",
    end_of_day_status: "",
    end_of_day_notes: buildSummaryNotes({ env, ad1, ad2, veh, ttl, stl, lin }),
    delivered_at: null,
    ro_amount: roAmount,
    onsite: false,
    estimator: estimator || "",
  };
}

function shouldImportPartLine(line) {
  if (!line) return false;
  const partNo = firstValue(line, ["OEM_PARTNO", "ALT_PARTNO"]);
  const price = Number(firstValue(line, ["ACT_PRICE", "DB_PRICE"]));
  const qty = Number(firstValue(line, ["PART_QTY"]));
  const partType = firstValue(line, ["PART_TYPE"]);
  if (partNo && (qty > 0 || price > 0)) return true;
  if (partType && /^PA|PN|LKQ|OEM/i.test(partType) && price > 0) return true;
  return false;
}

function mapPartLine(line, daily) {
  const partNo = firstValue(line, ["OEM_PARTNO", "ALT_PARTNO"]);
  const desc = firstValue(line, ["LINE_DESC"]);
  const price = firstValue(line, ["ACT_PRICE", "DB_PRICE"]);
  const qty = firstValue(line, ["PART_QTY"]);
  const vendorId = firstValue(line, ["ALT_CO_ID"]);
  const partType = firstValue(line, ["PART_TYPE"]);
  const lineNo = firstValue(line, ["LINE_NO"]);
  const notes = [
    "Imported from CCC EMS line file.",
    lineNo ? `Line ${lineNo}.` : "",
    price ? `Price: $${money(price)}.` : "",
    qty ? `Qty: ${qty}.` : "",
    partNo ? `Part #: ${partNo}.` : "",
  ].filter(Boolean).join(" ");

  return {
    parts_ro_number: daily.ro_number,
    parts_customer_name: daily.customer_name,
    parts_vehicle: daily.vehicle,
    part_description: [desc, partNo ? `#${partNo}` : ""].filter(Boolean).join(" "),
    part_type: partType || "CCC",
    part_vendor: vendorId || "",
    part_status: "Need to Order",
    part_priority: "Normal",
    part_ordered_date: null,
    part_eta: null,
    part_received_date: null,
    part_mirror_matched: "No",
    part_return_needed: "No",
    part_credit_needed: "No",
    part_assigned_to: "",
    part_last_follow_up: null,
    part_notes: notes,
    part_cost: price && Number.isFinite(Number(price)) ? Number(price) : null,
    part_qty: qty && Number.isFinite(Number(qty)) && Number(qty) > 0 ? Number(qty) : 1,
  };
}

async function findExistingDaily(mapped) {
  // Match on CCC's own package/file id first: it stays constant across the initial
  // estimate and every later supplement, even after the shop's real RO number
  // (env.RO_ID) shows up for the first time and changes what buildRoNumber() returns.
  // Falling back to ro_number alone would treat that as a brand-new job. Excludes
  // already-merged duplicates and orders deterministically so repeat imports always
  // land on the same row (a plain `LIMIT 1` with no ORDER BY previously picked an
  // arbitrary row whenever more than one shared the same ro_number).
  if (mapped.ccc_estfile_id) {
    const byEstFile = await pool.query(
      "SELECT * FROM daily_go_list WHERE ccc_estfile_id = $1 ORDER BY created_at ASC LIMIT 1",
      [mapped.ccc_estfile_id]
    );
    // An estimate card that was merged into its real job still holds the (unique)
    // ccc_estfile_id, so follow merged_into to the surviving job. Skipping merged rows
    // here used to fall through to an INSERT that collided with idx_daily_ccc_estfile_id.
    let row = byEstFile.rows[0];
    for (let hops = 0; row && row.merged_into && hops < 10; hops++) {
      row = (await pool.query("SELECT * FROM daily_go_list WHERE id = $1", [row.merged_into])).rows[0];
    }
    if (row && !row.merged_into) return row;
  }

  const byRoNumber = await pool.query(
    "SELECT * FROM daily_go_list WHERE ro_number = $1 AND merged_into IS NULL ORDER BY created_at ASC LIMIT 1",
    [mapped.ro_number]
  );
  return byRoNumber.rows[0] || null;
}

async function upsertDailyFromImport(req, mapped, { hasRealRo = true, createIfMissing = true } = {}) {
  const before = await findExistingDaily(mapped);
  const userName = req.user.fullName || req.user.username;

  if (before) {
    // Repeat CCC imports update estimate data without moving production cards or clearing delivery state.
    const importedFields=['ro_number','ccc_estfile_id','customer_name','vehicle','ro_amount','estimator','end_of_day_notes'];
    const skip = new Set();
    // With RO_ID blank, ro_number is only a stand-in (the CCC file id) and must not
    // replace a real RO number already on the job.
    if (!hasRealRo && before.ro_number) skip.add('ro_number');
    // Never move an RO onto this job when a different job already has it
    // (migrations/014 would reject the whole update and fail the import).
    const incomingRo = String(mapped.ro_number || "").trim();
    if (!skip.has('ro_number') && incomingRo && incomingRo !== String(before.ro_number || "").trim()) {
      const taken = await pool.query(
        "SELECT id, customer_name FROM daily_go_list WHERE id <> $1 AND merged_into IS NULL AND btrim(ro_number) = $2 LIMIT 1",
        [before.id, incomingRo]
      );
      if (taken.rows[0]) {
        skip.add('ro_number');
        console.warn(`EMS import: RO ${incomingRo} from CCC is already on another job (${taken.rows[0].customer_name}); kept ${before.ro_number} on ${before.id}.`);
      }
    }
    // Keep the job's own estfile id; never take one another (merged) row still holds.
    if (before.ccc_estfile_id) skip.add('ccc_estfile_id');
    else if (mapped.ccc_estfile_id) {
      const holder = await pool.query("SELECT id FROM daily_go_list WHERE ccc_estfile_id = $1 LIMIT 1", [mapped.ccc_estfile_id]);
      if (holder.rows[0]) skip.add('ccc_estfile_id');
    }
    const cols = Object.keys(mapped).filter(k => importedFields.includes(k) && !skip.has(k) && mapped[k] !== undefined && (k!=='ro_amount'||mapped[k]!==null));
    const values = cols.map(k => mapped[k] === "" ? null : mapped[k]);
    const setClauses = cols.map((c, i) => `${c} = $${i + 1}`);
    setClauses.push(`updated_at = now()`);
    setClauses.push(`updated_by = $${cols.length + 1}`);
    const params = [...values, userName, before.id];

    const normalizeAmount = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
    if (cols.includes("ro_amount") && normalizeAmount(before.ro_amount) !== normalizeAmount(mapped.ro_amount)) {
      setClauses.push("cycle_24h_reminder_sent_at = NULL", "cycle_past_due_sent_at = NULL");
    }

    const result = await pool.query(
      `UPDATE daily_go_list SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );

    // When the real RO number replaces CCC's stand-in file id, move the job's parts
    // with it. Otherwise they stay filed under the old id, and the new-parts check
    // below (keyed on RO) re-creates every one of them as "Need to Order".
    const oldRo = String(before.ro_number || "").trim();
    const newRo = String(result.rows[0].ro_number || "").trim();
    if (oldRo && newRo && oldRo !== newRo) {
      const moved = await pool.query(
        `UPDATE parts SET parts_ro_number = $1, updated_at = now(), updated_by = $3
         WHERE btrim(parts_ro_number) = $2
           AND NOT EXISTS (SELECT 1 FROM parts x WHERE btrim(x.parts_ro_number) = $1 AND x.part_description = parts.part_description)`,
        [newRo, oldRo, userName]
      );
      if (moved.rowCount) {
        await logActivity({ req, resource: "parts", action: "update", after: { from: oldRo, to: newRo, count: moved.rowCount }, summary: `Moved ${moved.rowCount} parts from ${oldRo} to RO ${newRo} after CCC assigned the RO number` });
      }
    }

    await logActivity({ req, resource: "daily", recordId: result.rows[0].id, action: "update", before, after: result.rows[0], summary: "Updated Daily GO List from CCC EMS import" });
    return { action: "updated", row: result.rows[0] };
  }

  if (!createIfMissing) return { action: "skipped", row: null };

  const cols = Object.keys(mapped);
  const values = cols.map(k => mapped[k] === "" ? null : mapped[k]);
  const allCols = ["created_by", "updated_by", ...cols];
  const allValues = [userName, userName, ...values];
  const placeholders = allValues.map((_, i) => `$${i + 1}`).join(", ");

  const result = await pool.query(
    `INSERT INTO daily_go_list (${allCols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
    allValues
  );

  await logActivity({ req, resource: "daily", recordId: result.rows[0].id, action: "create", after: result.rows[0], summary: "Created Daily GO List from CCC EMS import" });
  return { action: "created", row: result.rows[0] };
}

async function createPartsFromImport(req, daily, linRows) {
  const userName = req.user.fullName || req.user.username;
  const partRows = (linRows || []).filter(shouldImportPartLine).slice(0, 250);
  const created = [];

  for (const line of partRows) {
    const mapped = mapPartLine(line, daily);
    const exists = await pool.query(
      `SELECT id FROM parts
       WHERE parts_ro_number = $1 AND part_description = $2
       LIMIT 1`,
      [mapped.parts_ro_number, mapped.part_description]
    );
    if (exists.rows[0]) continue;

    const cols = Object.keys(mapped);
    const values = cols.map(k => mapped[k] === "" ? null : mapped[k]);
    const allCols = ["created_by", "updated_by", ...cols];
    const allValues = [userName, userName, ...values];
    const placeholders = allValues.map((_, i) => `$${i + 1}`).join(", ");

    const result = await pool.query(
      `INSERT INTO parts (${allCols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      allValues
    );
    created.push(result.rows[0]);
  }

  if (created.length) {
    await logActivity({ req, resource: "parts", action: "create", after: { count: created.length, ro_number: daily.ro_number }, summary: `Created ${created.length} parts from CCC EMS import` });
  }

  return created;
}

async function importEmsFiles(files, userOverride) {
  if (!files || !files.length) throw new Error("No EMS files supplied.");

  const reqLike = {
    user: userOverride || {
      id: null,
      username: "ems-auto-import",
      fullName: "EMS Auto Import",
      role: "system",
      canDelete: false,
    },
  };

  const { parsed, parseErrors } = buildPackage(files);
  const daily = buildDailyFromPackage(parsed);
  const hasRealRo = !!firstValue(getFirst(parsed, "env"), ["RO_ID"]);
  // CCC fills AD2.DATE_OUT only once the vehicle has actually left. CCC re-exports a
  // closed RO whenever anything on it changes (a payment, insurance info), and those
  // exports must not resurrect the job or re-add every part as "Need to Order".
  const vehicleOutDate = normalizeDate(firstValue(getFirst(parsed, "ad2"), ["DATE_OUT"]));
  const savedDaily = await upsertDailyFromImport(reqLike, daily, { hasRealRo, createIfMissing: !vehicleOutDate });

  if (savedDaily.action === "skipped") {
    return {
      success: true,
      imported: 0,
      dailyAction: "skipped",
      partsCreated: 0,
      filesRead: Object.keys(parsed),
      parseErrors,
      result: { ro_number: daily.ro_number, customer_name: daily.customer_name, vehicle: daily.vehicle, vehicle_out_date: vehicleOutDate },
      note: `Skipped: CCC shows this vehicle already out on ${vehicleOutDate} and no matching job exists in Shop Control, so this closed RO was not re-created.`,
    };
  }

  const partRows = vehicleOutDate ? [] : (parsed.lin?.records || []);
  const createdParts = await createPartsFromImport(reqLike, savedDaily.row, partRows);

  return {
    success: true,
    imported: 1,
    dailyAction: savedDaily.action,
    partsCreated: createdParts.length,
    filesRead: Object.keys(parsed),
    parseErrors,
    result: {
      id: savedDaily.row.id,
      ro_number: savedDaily.row.ro_number,
      customer_name: savedDaily.row.customer_name,
      vehicle: savedDaily.row.vehicle,
      target_delivery_date: savedDaily.row.target_delivery_date,
      insurance: firstValue(getFirst(parsed, "ad1"), ["INS_CO_NM"]),
      claim_number: firstValue(getFirst(parsed, "ad1"), ["CLM_NO"]),
      gross_total: firstValue(getFirst(parsed, "ttl"), ["G_TTL_AMT"]),
      supplement_amount: firstValue(getFirst(parsed, "ttl"), ["SUPP_AMT"]),
    },
    fields: Object.fromEntries(Object.entries(parsed).map(([ext, file]) => [ext, file.fields.map(f => f.name)])),
    note: "CCC EMS file set import completed. Daily GO List was created/updated; parts lines were created when part number and price/quantity were present.",
  };
}

router.post("/ems", requireAuth, requirePermission("daily", "create"), upload.array("files", 50), async (req, res) => {
  try {
    const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);
    const summary = await importEmsFiles(files, req.user);
    res.json(summary);
  } catch (err) {
    console.error("EMS import error:", err);
    res.status(500).json({ error: err.message || "Failed to import CCC EMS files." });
  }
});

// Backward compatibility with the old single-file form field name.
router.post("/ems-single", requireAuth, requirePermission("daily", "create"), upload.single("file"), async (req, res) => {
  try {
    const files = req.file ? [req.file] : [];
    const summary = await importEmsFiles(files, req.user);
    res.json(summary);
  } catch (err) {
    console.error("EMS single import error:", err);
    res.status(500).json({ error: err.message || "Failed to import CCC EMS file." });
  }
});

module.exports = { router, importEmsFiles };
