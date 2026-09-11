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

function ad1File() {
  return { originalname: 'job.ad1', buffer: buildDbf([{ name: 'CLM_NO', type: 'C', length: 10 }], [{ CLM_NO: '' }]) };
}

const calls = [];
const rows = [];
const pool = {
  query: async (sql, args = []) => {
    calls.push({ sql, args });
    if (sql.startsWith('SELECT * FROM daily_go_list WHERE ccc_estfile_id')) {
      const [estId] = args;
      const matches = rows.filter(r => r.ccc_estfile_id === estId && !r.merged_into).sort((a, b) => a.created_at - b.created_at);
      return { rows: matches.slice(0, 1) };
    }
    if (sql.startsWith('SELECT * FROM daily_go_list WHERE ro_number')) {
      const [ro] = args;
      const matches = rows.filter(r => r.ro_number === ro && !r.merged_into).sort((a, b) => a.created_at - b.created_at);
      return { rows: matches.slice(0, 1) };
    }
    if (sql.startsWith('UPDATE daily_go_list SET')) {
      const id = args.at(-1);
      const row = rows.find(r => r.id === id);
      // cols are whatever import.js decided to set; just merge every mapped-looking arg back by re-reading the SET clause order isn't needed for this test's assertions.
      Object.assign(row, { _updated: true });
      return { rows: [row] };
    }
    if (sql.startsWith('INSERT INTO daily_go_list')) {
      const id = `row-${rows.length + 1}`;
      const row = { id, created_at: rows.length, merged_into: null, ro_amount: null };
      rows.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith('SELECT id FROM parts')) return { rows: [] };
    if (sql.startsWith('INSERT INTO parts')) return { rows: [{ id: 'part-1' }] };
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
