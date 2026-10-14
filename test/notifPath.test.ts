import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureExecutable, resolveNotifPath } from '../src/notifPath';

const EXT_ROOT = '/Users/alice/.vscode/extensions/local.vscode-notify-0.0.1';

function tempFile(mode: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-notify-'));
  const file = path.join(dir, 'notif');
  fs.writeFileSync(file, '#!/bin/sh\n');
  fs.chmodSync(file, mode);
  return file;
}

test('resolves the bundled binary on darwin', () => {
  assert.equal(resolveNotifPath(EXT_ROOT, '', 'darwin'), `${EXT_ROOT}/bin/notif`);
});

test('resolves notif.exe on win32', () => {
  assert.equal(resolveNotifPath(EXT_ROOT, undefined, 'win32'), path.join(EXT_ROOT, 'bin', 'notif.exe'));
});

test('notify.notifPath override wins', () => {
  assert.equal(resolveNotifPath(EXT_ROOT, '/opt/notif/target/debug/notif', 'darwin'), '/opt/notif/target/debug/notif');
});

test('whitespace-only override falls back to the bundled binary', () => {
  assert.equal(resolveNotifPath(EXT_ROOT, '   ', 'darwin'), `${EXT_ROOT}/bin/notif`);
});

test('adds the exec bit when missing', async () => {
  const file = tempFile(0o644);
  assert.equal(await ensureExecutable(file, 'darwin'), 'chmodded');
  assert.equal(fs.statSync(file).mode & 0o777, 0o755);
});

test('leaves an executable binary untouched', async () => {
  const file = tempFile(0o750);
  assert.equal(await ensureExecutable(file, 'darwin'), 'ok');
  assert.equal(fs.statSync(file).mode & 0o777, 0o750);
});

test('reports a missing binary', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-notify-')), 'notif');
  assert.equal(await ensureExecutable(file, 'darwin'), 'missing');
});

test('skips the check on win32', async () => {
  const file = tempFile(0o644);
  assert.equal(await ensureExecutable(file, 'win32'), 'skipped');
  assert.equal(fs.statSync(file).mode & 0o777, 0o644);
});
