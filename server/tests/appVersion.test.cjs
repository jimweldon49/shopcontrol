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

test('app pages stamp local scripts and stylesheets with a version, and the stamp changes with the file', () => {
  const { versionedPage, CLIENT } = require('../src/appVersion');
  const page = path.join(CLIENT, 'mobile', 'index.html');
  const html = versionedPage(page);
  assert.match(html, /<script src="staff\.js\?v=[0-9a-f]{10}"><\/script>/);
  assert.match(html, /<script src="\.\.\/shared\.js\?v=[0-9a-f]{10}"><\/script>/);
  assert.doesNotMatch(html, /manifest\.json\?v=/, 'only .js and .css are stamped');
  const desk = versionedPage(path.join(CLIENT, 'index.html'));
  assert.match(desk, /<link rel="stylesheet" href="styles\.css\?v=[0-9a-f]{10}" \/>/);

  const stamp = html.match(/staff\.js\?v=([0-9a-f]+)/)[1];
  const file = path.join(CLIENT, 'mobile', 'staff.js');
  const { atime, mtime } = fs.statSync(file);
  const realNow = Date.now;
  try {
    fs.utimesSync(file, atime, new Date(mtime.getTime() + 60000));
    Date.now = () => realNow() + 11000;
    assert.notEqual(versionedPage(page).match(/staff\.js\?v=([0-9a-f]+)/)[1], stamp);
  } finally { Date.now = realNow; fs.utimesSync(file, atime, mtime); }
});
