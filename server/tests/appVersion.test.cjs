const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');

test('the employee app version changes when a file in client/mobile changes', async () => {
  const { mobileVersion } = require('../src/appVersion');
  const file = path.join(__dirname, '..', '..', 'client', 'mobile', 'update.js');
  const before = mobileVersion();
  assert.match(before, /^[0-9a-f]{12}$/);
  const { atime, mtime } = fs.statSync(file);
  try {
    fs.utimesSync(file, atime, new Date(mtime.getTime() + 60000));
    const realNow = Date.now;
    Date.now = () => realNow() + 11000; // past the 10 second cache
    try { assert.notEqual(mobileVersion(), before); } finally { Date.now = realNow; }
  } finally { fs.utimesSync(file, atime, mtime); }
});
