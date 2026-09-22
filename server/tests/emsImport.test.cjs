const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');

// Minimal DBF/DBase III writer matching what parseDbf() in ../src/routes/import.js reads:
// header numRecords @4 (u32le), headerLength @8 (u16le), recordLength @10 (u16le),
// field descriptors from offset 32 (11-byte name, type @11, length @16), terminated by 0x0d,
// each record = 1 deletion-flag byte + each field's text padded/truncated to its length.
function buildDbf(fields, rows) {
  const recordLength = 1 + fields.reduce((sum, f) => sum + f.length, 0);
  const headerLength = 32 + fields.length * 32 + 1;
  const buf = Buffer.alloc(headerLength + rows.length * recordLength);
  buf.writeUInt32LE(rows.length, 4);
  buf.writeUInt16LE(headerLength, 8);
  buf.writeUInt16LE(recordLength, 10);
  fields.forEach((f, i) => {
    const off = 32 + i * 32;
    buf.write(f.name.slice(0, 10), off, 'latin1');
    buf.writeUInt8(f.type.charCodeAt(0), off + 11);
    buf.writeUInt8(f.length, off + 16);
  });
  buf.writeUInt8(0x0d, 32 + fields.length * 32);
  rows.forEach((row, r) => {
    let pos = headerLength + r * recordLength;
    buf.writeUInt8(0x20, pos); // not deleted
    pos += 1;
    for (const f of fields) {
      const text = String(row[f.name] ?? '').slice(0, f.length).padEnd(f.length, ' ');
      buf.write(text, pos, 'latin1');
      pos += f.length;
    }
  });
  return buf;
}

function envFile(row) {
  return { originalname: 'job.env', buffer: buildDbf([
    { name: 'RO_ID', type: 'C', length: 10 },
    { name: 'ESTFILE_ID', type: 'C', length: 10 },
    { name: 'SUPP_NO', type: 'C', length: 5 },
    { name: 'TRANS_TYPE', type: 'C', length: 1 },
  ], [row]) };
}

function ad1File(row = { CLM_NO: '' }) {
  return { originalname: 'job.ad1', buffer: buildDbf([
    { name: 'CLM_NO', type: 'C', length: 10 },
    { name: 'OWNR_FN', type: 'C', length: 20 },
    { name: 'OWNR_LN', type: 'C', length: 20 },
    { name: 'OWNR_CO_NM', type: 'C', length: 30 },
  ], [row]) };
}

function ad2File(row) {
  return { originalname: 'job.ad2', buffer: buildDbf([
    { name: 'EST_CT_FN', type: 'C', length: 20 },
    { name: 'EST_CT_LN', type: 'C', length: 20 },
    { name: 'DATE_OUT', type: 'D', length: 8 },
  ], [row]) };
}

function linFile() {
  return { originalname: 'job.lin', buffer: buildDbf([
    { name: 'LINE_DESC', type: 'C', length: 20 },
    { name: 'OEM_PARTNO', type: 'C', length: 12 },
    { name: 'PART_QTY', type: 'N', length: 3 },
    { name: 'ACT_PRICE', type: 'N', length: 8 },
  ], [{ LINE_DESC: 'Bumper cover', OEM_PARTNO: 'ABC-1', PART_QTY: 1, ACT_PRICE: 250 }]) };
}

const calls = [];
const rows = [];
let partsInserted = 0;
const pool = {
  query: async (sql, args = []) => {
    calls.push({ sql, args });
    if (sql.startsWith('SELECT * FROM daily_go_list WHERE ccc_estfile_id')) {
      const [estId] = args;
      const matches = rows.filter(r => r.ccc_estfile_id === estId).sort((a, b) => a.created_at - b.created_at);
      return { rows: matches.slice(0, 1).map(r => ({ ...r })) };
    }
    if (sql.startsWith('SELECT id FROM daily_go_list WHERE ccc_estfile_id')) {
      return { rows: rows.filter(r => r.ccc_estfile_id === args[0]).slice(0, 1) };
    }
    if (sql.startsWith('SELECT * FROM daily_go_list WHERE id')) {
      return { rows: rows.filter(r => r.id === args[0]).map(r => ({ ...r })) };
    }
    if (sql.startsWith('SELECT * FROM daily_go_list WHERE ro_number')) {
      const [ro] = args;
      const matches = rows.filter(r => r.ro_number === ro && !r.merged_into).sort((a, b) => a.created_at - b.created_at);
      return { rows: matches.slice(0, 1).map(r => ({ ...r })) };
    }
    if (sql.startsWith('UPDATE daily_go_list SET')) {
      const id = args.at(-1);
      const row = rows.find(r => r.id === id);
      // Apply each "col = $n" assignment so tests can see exactly what the import wrote.
      for (const [, col, n] of sql.matchAll(/(\w+) = \$(\d+)/g)) {
        if (col !== 'updated_by' && col !== 'id') row[col] = args[Number(n) - 1];
      }
      return { rows: [row] };
    }
    if (sql.startsWith('INSERT INTO daily_go_list')) {
      const id = `row-${rows.length + 1}`;
      const row = { id, created_at: rows.length, merged_into: null, ro_amount: null };
      rows.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith('SELECT id FROM parts')) return { rows: [] };
    if (sql.startsWith('INSERT INTO parts')) { partsInserted++; return { rows: [{ id: 'part-1' }] }; }
    if (sql.startsWith('INSERT INTO activity_log')) return { rows: [] };
    return { rows: [] };
  },
};

function Router() {
  return { routes: [], middleware: [], use() {}, get() {}, post() {}, put() {}, delete() {} };
}
function multerStub() {
  const noop = (req, res, next) => next();
  const factory = () => ({ single: () => noop, array: () => noop });
  factory.memoryStorage = () => ({});
  return factory;
}

const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (/(^|\/)db$/.test(name)) return { pool };
  if (name.endsWith('/activityLogger')) return { logActivity: async () => {} };
  if (name === 'express') return { Router };
  if (name === 'multer') return multerStub();
  if (name === 'jsonwebtoken') return { verify: () => ({ id: 'user-1' }) };
  return load.call(this, name, parent, ...rest);
};
const { importEmsFiles } = require('../src/routes/import');
Module._load = load;

const user = { id: 'u1', username: 'test', fullName: 'Test', role: 'system', canDelete: false };

test('a supplement import with a newly-populated RO_ID updates the original job instead of creating a duplicate', async () => {
  rows.length = 0; calls.length = 0;

  // First import: CCC hasn't got the real RO number yet, RO_ID is blank.
  const first = await importEmsFiles([
    envFile({ RO_ID: '', ESTFILE_ID: 'abc123', SUPP_NO: '', TRANS_TYPE: 'E' }),
    ad1File(),
  ], user);
  assert.equal(first.dailyAction, 'created');
  assert.equal(rows.length, 1);
  rows[0].ro_number = 'abc123';
  rows[0].ccc_estfile_id = 'abc123';

  // Supplement import: same CCC package (ESTFILE_ID unchanged), but RO_ID is now populated.
  const second = await importEmsFiles([
    envFile({ RO_ID: '99999', ESTFILE_ID: 'abc123', SUPP_NO: 'S01', TRANS_TYPE: 'S' }),
    ad1File(),
  ], user);

  assert.equal(rows.length, 1, 'no duplicate Daily GO List row should be created for the same CCC package');
  assert.equal(second.dailyAction, 'updated');
  assert.equal(second.result.id, first.result.id);
});

test('a commercial owner with only a company name is used as the customer, not the estimator contact', async () => {
  rows.length = 0; calls.length = 0;
  const result = await importEmsFiles([
    envFile({ RO_ID: '17779', ESTFILE_ID: 'bus9', SUPP_NO: '', TRANS_TYPE: 'E' }),
    ad1File({ CLM_NO: '', OWNR_FN: '', OWNR_LN: '', OWNR_CO_NM: 'Ceres Unified' }),
    ad2File({ EST_CT_FN: 'Vinny', EST_CT_LN: 'Gutierrez', DATE_OUT: '' }),
  ], user);
  assert.equal(result.dailyAction, 'created');
  const insert = calls.find(c => c.sql.startsWith('INSERT INTO daily_go_list'));
  assert.ok(insert.args.includes('Ceres Unified'));
  assert.ok(!insert.args.includes('Vinny Gutierrez'));
});

test('a closed RO (vehicle already out in CCC) with no job in Shop Control is not re-created and adds no parts', async () => {
  rows.length = 0; calls.length = 0; partsInserted = 0;
  const result = await importEmsFiles([
    envFile({ RO_ID: '17801', ESTFILE_ID: 'ff39ad19', SUPP_NO: 'S03', TRANS_TYPE: 'S' }),
    ad1File(),
    ad2File({ DATE_OUT: '20260727' }),
    linFile(),
  ], user);
  assert.equal(result.dailyAction, 'skipped');
  assert.equal(rows.length, 0);
  assert.equal(partsInserted, 0);
});

test('a closed RO that still has its job is updated but does not get new "Need to Order" parts', async () => {
  rows.length = 0; calls.length = 0; partsInserted = 0;
  rows.push({ id: 'job-1', created_at: 0, merged_into: null, ro_number: '17801', ccc_estfile_id: 'ff39ad19', ro_amount: null });
  const result = await importEmsFiles([
    envFile({ RO_ID: '17801', ESTFILE_ID: 'ff39ad19', SUPP_NO: 'S03', TRANS_TYPE: 'S' }),
    ad1File(),
    ad2File({ DATE_OUT: '20260727' }),
    linFile(),
  ], user);
  assert.equal(result.dailyAction, 'updated');
  assert.equal(partsInserted, 0);
});

test('an open job still gets its parts', async () => {
  rows.length = 0; calls.length = 0; partsInserted = 0;
  const result = await importEmsFiles([
    envFile({ RO_ID: '17990', ESTFILE_ID: 'open1', SUPP_NO: '', TRANS_TYPE: 'E' }),
    ad1File(),
    ad2File({ DATE_OUT: '' }),
    linFile(),
  ], user);
  assert.equal(result.dailyAction, 'created');
  assert.equal(partsInserted, 1);
});

test('a supplement for an estimate card that was merged into its real job updates that job instead of crashing', async () => {
  rows.length = 0; calls.length = 0;
  rows.push({ id: 'real', created_at: 0, merged_into: null, ro_number: '17949', ccc_estfile_id: null, ro_amount: null });
  rows.push({ id: 'estimate', created_at: 1, merged_into: 'real', ro_number: 'a7bdade9', ccc_estfile_id: 'a7bdade9', ro_amount: null });
  const result = await importEmsFiles([
    envFile({ RO_ID: '', ESTFILE_ID: 'a7bdade9', SUPP_NO: 'S01', TRANS_TYPE: 'S' }),
    ad1File(),
  ], user);
  assert.equal(result.dailyAction, 'updated');
  assert.equal(result.result.id, 'real');
  assert.equal(rows.length, 2, 'no new row inserted');
  assert.equal(rows[0].ro_number, '17949', 'the real RO number is not replaced by the CCC file id');
  assert.equal(rows[0].ccc_estfile_id, null, 'the estfile id still held by the merged card is not copied (unique index)');
});

test('when CCC assigns the real RO number, the job\'s parts move from the CCC file id to the RO', async () => {
  rows.length = 0; calls.length = 0;
  rows.push({ id: 'job-1', created_at: 0, merged_into: null, ro_number: 'af0c82ed', ccc_estfile_id: 'af0c82ed', ro_amount: null });
  await importEmsFiles([
    envFile({ RO_ID: '17990', ESTFILE_ID: 'af0c82ed', SUPP_NO: 'S01', TRANS_TYPE: 'S' }),
    ad1File(),
  ], user);
  const move = calls.find(c => c.sql.startsWith('UPDATE parts SET parts_ro_number'));
  assert.ok(move, 'parts are moved to the new RO');
  assert.deepEqual(move.args.slice(0, 2), ['17990', 'af0c82ed']);
  const moveIdx = calls.indexOf(move), dedupeIdx = calls.findIndex(c => c.sql.startsWith('SELECT id FROM parts'));
  assert.ok(dedupeIdx === -1 || moveIdx < dedupeIdx, 'parts are moved before the new-parts duplicate check runs');
});
