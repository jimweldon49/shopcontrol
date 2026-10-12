const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { exifTakenAt, takenAt } = require('../src/photoDate');
const model = require('../../client/shared.js');

// A tiny JPEG whose EXIF says it was taken 2026:10:12 13:04:05 (shop time).
function jpegWithExif(when) {
  const le16 = (n) => Buffer.from([n & 255, n >> 8]), le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const date = Buffer.from(when + '\0', 'ascii'); // 20 bytes
  // TIFF: header(8) + IFD0 with 1 entry (ExifIFD pointer) + Exif IFD with 1 entry (DateTimeOriginal) + the string.
  const ifd0 = 8, exifIfd = ifd0 + 2 + 12 + 4, str = exifIfd + 2 + 12 + 4;
  const tiff = Buffer.concat([Buffer.from('II*\0'), le32(ifd0),
    le16(1), le16(0x8769), le16(4), le32(1), le32(exifIfd), le32(0),
    le16(1), le16(0x9003), le16(2), le32(date.length), le32(str), le32(0), date]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(app1.length + 2) >> 8, (app1.length + 2) & 255]), app1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
}

test("a photo's taken time comes from its own date, read as shop time, else the phone's file time", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-'));
  const file = path.join(dir, 'a.jpg');
  fs.writeFileSync(file, jpegWithExif('2026:10:12 13:04:05'));
  assert.equal(exifTakenAt(file).toISOString(), '2026-10-12T20:04:05.000Z'); // 1:04 PM PDT
  const now = new Date('2026-10-13T00:00:00Z');
  assert.equal(takenAt(file, String(Date.parse('2026-10-01T00:00:00Z')), now).toISOString(), '2026-10-12T20:04:05.000Z', 'photo date wins');
  const plain = path.join(dir, 'b.png'); fs.writeFileSync(plain, Buffer.from('not a jpeg'));
  assert.equal(takenAt(plain, String(Date.parse('2026-10-12T18:00:00Z')), now).toISOString(), '2026-10-12T18:00:00.000Z', 'falls back to the phone time');
  assert.equal(takenAt(plain, String(Date.parse('2027-01-01T00:00:00Z')), now), null, 'not in the future');
  assert.equal(takenAt(plain, '', now), null);
  fs.rmSync(dir, { recursive: true });
});

test('parts search finds words and part numbers typed without dashes', () => {
  const p = { part_description: 'Bumper cover #52119-0R938', part_vendor: 'Toyota of Modesto', part_notes: '' };
  assert.equal(model.partMatches(p, 'bumper'), true);
  assert.equal(model.partMatches(p, '52119-0R938'), true);
  assert.equal(model.partMatches(p, '521190r938'), true);
  assert.equal(model.partMatches(p, 'modesto'), true);
  assert.equal(model.partMatches(p, 'headlamp'), false);
  assert.equal(model.partMatches({ partDescription: 'Headlamp #81150' }, '81150'), true, 'desktop field names');
  assert.equal(model.partMatches(p, ''), true);
});

test('received parts only need a mirror match once the car is on site on the Production Board', () => {
  const ctx = vm.createContext({ console, Date, ShopModel: model, store: { get: () => [] } });
  const src = fs.readFileSync(path.join(__dirname, '../../client/app.js'), 'utf8');
  const grab = (name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n}\n', src.indexOf(`function ${name}(`)) + 2);
  vm.runInContext(['dailyRecordForPartsRow', 'partNeedsMirror'].map(grab).join('\n'), ctx);
  const jobs = [
    { roNumber: '30001', onsite: true, currentStage: 'Body' },
    { roNumber: '30002', onsite: false, currentStage: 'On the Road' },
    { roNumber: 'EST-9', onsite: false, currentStage: 'Check-In' },
  ];
  const part = (ro, extra = {}) => ({ partsRoNumber: ro, partStatus: 'Received', partMirrorMatched: 'No', ...extra });
  assert.equal(ctx.partNeedsMirror(part('30001'), jobs), true, 'on site');
  assert.equal(ctx.partNeedsMirror(part('30002'), jobs), false, 'on the road');
  assert.equal(ctx.partNeedsMirror(part('EST-9'), jobs), false, 'opportunity');
  assert.equal(ctx.partNeedsMirror(part('39999'), jobs), false, 'no job found');
  assert.equal(ctx.partNeedsMirror(part('30001', { partMirrorMatched: 'Yes' }), jobs), false, 'already matched');
  assert.equal(ctx.partNeedsMirror(part('30001', { partStatus: 'Ordered' }), jobs), false, 'not received');
});
