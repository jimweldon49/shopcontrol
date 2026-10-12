const fs = require("fs");

// When a JPEG was taken, from its EXIF DateTimeOriginal (or DateTime). Cameras write the
// local time with no time zone, so it's read as shop time. Returns a Date or null.
function exifTakenAt(file) {
  let buf;
  try {
    const fd = fs.openSync(file, "r");
    buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    buf = buf.subarray(0, n);
  } catch (_) { return null; }
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1], size = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.toString("ascii", i + 4, i + 10) === "Exif\0\0") return fromTiff(buf.subarray(i + 10, i + 2 + size));
    if (marker === 0xda) return null;
    i += 2 + size;
  }
  return null;
}

function fromTiff(t) {
  if (t.length < 8) return null;
  const le = t.toString("ascii", 0, 2) === "II";
  const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const tags = (ifd) => {
    const out = {};
    if (ifd + 2 > t.length) return out;
    const count = u16(ifd);
    for (let k = 0; k < count; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > t.length) break;
      out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), value: e + 8 };
    }
    return out;
  };
  const ascii = (tag) => {
    if (!tag || tag.type !== 2) return null;
    const off = tag.count > 4 ? u32(tag.value) : tag.value;
    return off + tag.count <= t.length ? t.toString("ascii", off, off + tag.count - 1) : null;
  };
  const ifd0 = tags(u32(4));
  const exif = ifd0[0x8769] ? tags(u32(ifd0[0x8769].value)) : {};
  const text = ascii(exif[0x9003]) || ascii(exif[0x9004]) || ascii(ifd0[0x0132]);
  const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(text || "");
  return m ? shopLocalToDate(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]) : null;
}

// A wall-clock time in the shop's time zone -> Date.
function shopLocalToDate(y, mo, d, h, mi, s) {
  const tz = process.env.BUSINESS_TIMEZONE || "America/Los_Angeles";
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(guess).map((x) => [x.type, Number(x.value)]));
  const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

// The time to record as "taken": the photo's own date, else the time the phone gave the
// file (sent by the app), if either is believable (not in the future, not years old).
function takenAt(file, clientValue, now = new Date()) {
  const ok = (d) => d && !isNaN(d) && d <= new Date(now.getTime() + 5 * 60 * 1000) && d >= new Date(now.getTime() - 5 * 365 * 864e5);
  const exif = exifTakenAt(file);
  if (ok(exif)) return exif;
  const client = clientValue ? new Date(Number(clientValue) || clientValue) : null;
  return ok(client) ? client : null;
}

module.exports = { exifTakenAt, takenAt, shopLocalToDate };
