// contract.test.ts — the file contract (schemas/*.v1.schema.json) against
// the doc's examples, the legacy fixtures, and the real files when present.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';

const ROOT = path.resolve(__dirname, '..', '..');
const KINDS = ['queue', 'inbound', 'actions', 'outbound'] as const;
type Kind = (typeof KINDS)[number];

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validators = {} as Record<Kind, ValidateFunction>;
for (const kind of KINDS) {
  const file = path.join(ROOT, 'schemas', `${kind}.v1.schema.json`);
  validators[kind] = ajv.compile(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function errorsOf(v: ValidateFunction): string {
  return (v.errors ?? [])
    .filter((e) => e.keyword !== 'oneOf')
    .map((e) => `${e.instancePath || '/'} ${e.message}`)
    .join('; ');
}

function assertValid(kind: Kind, line: unknown, where: string): void {
  const v = validators[kind];
  assert.ok(v(line), `${where}: ${errorsOf(v)}\n${JSON.stringify(line)}`);
}

function assertInvalid(kind: Kind, line: unknown, errorPath: string, why: string): void {
  const v = validators[kind];
  assert.equal(v(line), false, `${why}: expected invalid\n${JSON.stringify(line)}`);
  const paths = (v.errors ?? []).map((e) => e.instancePath);
  assert.ok(paths.includes(errorPath), `${why}: expected an error at "${errorPath}", got ${JSON.stringify(paths)}`);
}

/** The line is invalid and one error names `prop` as a property the event does not allow. */
function assertUnevaluated(kind: Kind, line: unknown, prop: string, why: string): void {
  const v = validators[kind];
  assert.equal(v(line), false, `${why}: expected invalid\n${JSON.stringify(line)}`);
  const extra = (v.errors ?? []).filter((e) => e.keyword === 'unevaluatedProperties').map((e) => e.params.unevaluatedProperty);
  assert.ok(extra.includes(prop), `${why}: expected "${prop}" reported as not allowed, got ${JSON.stringify(extra)}`);
}

/** The line is invalid and one error names `field` as the missing required property. */
function assertMissing(kind: Kind, line: unknown, field: string, why: string): void {
  const v = validators[kind];
  assert.equal(v(line), false, `${why}: expected invalid\n${JSON.stringify(line)}`);
  const missing = (v.errors ?? []).filter((e) => e.keyword === 'required').map((e) => e.params.missingProperty);
  assert.ok(missing.includes(field), `${why}: expected "${field}" reported missing, got ${JSON.stringify(missing)}`);
}

/** Every non-empty line of a JSONL file, parsed. */
function readJsonl(file: string): unknown[] {
  const out: unknown[] = [];
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    if (raw.trim()) out.push(JSON.parse(raw));
  }
  return out;
}

function validateFile(kind: Kind, file: string): number {
  const lines = readJsonl(file);
  for (let i = 0; i < lines.length; i++) assertValid(kind, lines[i], `${file}:${i + 1}`);
  return lines.length;
}

// ---------------------------------------------------------------------------
// The doc's examples are the fixture: ```json contract=<kind> blocks.

const doc = fs.readFileSync(path.join(ROOT, 'docs', 'contract.md'), 'utf8');
const examples: Record<Kind, Record<string, unknown>[]> = { queue: [], inbound: [], actions: [], outbound: [] };
for (const m of doc.matchAll(/```json contract=(\w+)\n([\s\S]*?)```/g)) {
  const kind = m[1] as Kind;
  assert.ok(KINDS.includes(kind), `unknown contract tag "${m[1]}" in docs/contract.md`);
  examples[kind].push(JSON.parse(m[2]));
}

test('every doc example validates against its schema', () => {
  for (const kind of KINDS) {
    assert.ok(examples[kind].length >= 1, `no example tagged contract=${kind}`);
    examples[kind].forEach((ex, i) => assertValid(kind, ex, `docs/contract.md ${kind} example ${i + 1}`));
  }
});

test('the queue examples cover every event of the schema', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'queue.v1.schema.json'), 'utf8'));
  const events: string[] = schema.properties.event.enum;
  const seen = examples.queue.map((ex) => ex.event);
  for (const e of events) assert.ok(seen.includes(e), `no queue example for event "${e}"`);
});

test('the hello example carries the agreed payload', () => {
  const hello = examples.queue.find((ex) => ex.event === 'hello');
  assert.ok(hello, 'hello example missing');
  assert.equal(hello.v, 1);
  assert.equal(hello.producer, 'notify-queue');
  assert.equal(hello.agent, 'claude-code');
  assert.match(String(hello.producer_version), /^\d+\.\d+\.\d+$/);
  assert.match(String(hello.sid), /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(hello).sort(), ['agent', 'event', 'producer', 'producer_version', 'sid', 'ts', 'v']);
});

test('the permission examples chain queue → actions → outbound by id', () => {
  const perm = examples.queue.find((ex) => ex.event === 'permission_request');
  const allow = examples.actions.find((ex) => ex.event === 'action:Allow');
  const out = examples.outbound.find((ex) => ex.behavior === 'allow');
  assert.ok(perm && allow && out);
  assert.equal(allow.notif_id, perm.notif_id, 'actions.notif_id is the queue notif_id');
  assert.equal(out.requestId, perm.tool_use_id, 'outbound.requestId is the queue tool_use_id');
  assert.equal(out.sessionId, perm.sid, 'outbound.sessionId is the queue sid');
  assert.deepEqual(out.updatedInput, perm.tool_input, 'outbound.updatedInput is the queue tool_input');
});

// ---------------------------------------------------------------------------
// Negative cases: one missing required field and one wrong `v` per schema,
// plus the closed-world and per-event rules of the queue.

const TS = '2026-10-14T08:00:00.000Z';
const SID = '11111111-2222-3333-4444-555555555555';
const HELLO = { v: 1, ts: TS, sid: SID, event: 'hello', producer: 'notify-queue', producer_version: '1.10.0', agent: 'claude-code' };
const INBOUND = { ts: TS, source: 'user-action', sessionId: SID, channelId: 'c1', pid: null, type: 'io_message', payload: {} };
const ACTION = { notif_id: 'stop-11111111-1760000000000', event: 'click', sender: 'claude-code', title: 't', body: 'b', ts: TS };
const OUTBOUND = { cmd: 'tool_permission_response', sessionId: SID, requestId: 'r1', behavior: 'allow' };

test('each schema rejects a missing required field', () => {
  const { sid: _s, ...noSid } = { ts: TS, sid: SID, event: 'user_replied' };
  assertMissing('queue', noSid, 'sid', 'queue without sid');
  const { source: _src, ...noSource } = INBOUND;
  assertMissing('inbound', noSource, 'source', 'inbound without source');
  const { notif_id: _n, ...noId } = ACTION;
  assertMissing('actions', noId, 'notif_id', 'actions without notif_id');
  const { behavior: _b, ...noBehavior } = OUTBOUND;
  assertMissing('outbound', noBehavior, 'behavior', 'outbound without behavior');
});

test('each schema rejects a wrong v', () => {
  assertInvalid('queue', { ...HELLO, v: 2 }, '/v', 'queue v=2');
  assertInvalid('inbound', { ...INBOUND, v: 2 }, '/v', 'inbound v=2');
  assertInvalid('actions', { ...ACTION, v: 2 }, '/v', 'actions v=2');
  assertInvalid('outbound', { ...OUTBOUND, v: 2 }, '/v', 'outbound v=2');
  assertInvalid('queue', { ...HELLO, v: '1' }, '/v', 'queue v as a string');
});

test('each schema accepts v: 1 on an otherwise unchanged line', () => {
  assertValid('inbound', { ...INBOUND, v: 1 }, 'inbound v=1');
  assertValid('actions', { ...ACTION, v: 1 }, 'actions v=1');
  assertValid('outbound', { ...OUTBOUND, v: 1 }, 'outbound v=1');
  assertValid('queue', { v: 1, ts: TS, sid: SID, event: 'user_replied' }, 'queue v=1');
});

test('the queue schema enforces the per-event rules', () => {
  const { v: _v, ...helloNoV } = HELLO;
  assertMissing('queue', helloNoV, 'v', 'hello without v');
  assertUnevaluated('queue', { ...HELLO, sender: 'default' }, 'sender', 'hello with the notification envelope');
  assertMissing('queue', { ts: TS, sid: SID, event: 'stop' }, 'last_message_excerpt', 'stop without last_message_excerpt');
  assertMissing('queue', { ts: TS, sid: SID, event: 'notification', notification_type: 'idle_prompt' }, 'message', 'notification without message');
  assertMissing('queue', { ts: TS, sid: SID, event: 'permission_request' }, 'tool_name', 'permission_request without tool_name');
  assertUnevaluated('queue', { ts: TS, sid: SID, event: 'stop', last_message_excerpt: 'x', tool_name: 'Bash' }, 'tool_name', 'tool_name on a stop');
  assertUnevaluated('queue', { ts: TS, sid: SID, event: 'user_replied', extra: 1 }, 'extra', 'unknown property');
  assertInvalid('queue', { ts: TS, sid: SID, event: 'bye' }, '/event', 'unknown event');
  assertInvalid('queue', { ts: 'yesterday', sid: SID, event: 'user_replied' }, '/ts', 'non-ISO ts');
  assertInvalid('queue', { ts: TS, sid: SID, event: 'permission_request', tool_name: 'Bash', tool_input: 'ls' }, '/tool_input', 'tool_input as a string');
});

test('the outbound schema restricts behavior and cmd', () => {
  assertInvalid('outbound', { ...OUTBOUND, behavior: 'maybe' }, '/behavior', 'unknown behavior');
  assertInvalid('outbound', { ...OUTBOUND, cmd: 'other' }, '/cmd', 'unknown cmd');
  assertValid('outbound', { ...OUTBOUND, behavior: 'deny', message: 'no' }, 'deny with message');
});

test('the actions schema restricts the event shape', () => {
  assertInvalid('actions', { ...ACTION, event: 'tap' }, '/event', 'unknown callback event');
  assertValid('actions', { ...ACTION, event: 'action:Allow' }, 'action:<label>');
  assertValid('actions', { ...ACTION, event: 'timeout' }, 'timeout');
});

// ---------------------------------------------------------------------------
// Legacy fixtures (synthetic, copied from the daemon's test suite): lines
// without `sender` / `notif_id`, written before hook v0.2.

test('legacy fixtures validate (lines without sender / notif_id)', () => {
  const dir = path.join(ROOT, 'test', 'fixtures', 'legacy');
  let files = 0;
  let lines = 0;
  for (const sub of fs.readdirSync(dir)) {
    for (const f of fs.readdirSync(path.join(dir, sub))) {
      files++;
      lines += validateFile('queue', path.join(dir, sub, f));
    }
  }
  assert.equal(files, 22, 'fixture file count');
  assert.equal(lines, 22, 'fixture line count');
});

// ---------------------------------------------------------------------------
// Real files: only when the dev-container paths exist (CI has none).

const REAL_QUEUE_DIR = '/workspace/.devcontainer/tmp/notify';
const REAL_LOGS_DIR = '/workspace/.devcontainer/tmp/logs';
const DAEMON_SESSIONS = '/workspace/packages/devcontainer-cli/notify/tests/fixtures/sessions';

function nonEmpty(file: string): boolean {
  try { return fs.statSync(file).size > 0; } catch { return false; }
}

test('real queue files validate', { skip: !fs.existsSync(REAL_QUEUE_DIR) && 'no live queue dir' }, () => {
  let lines = 0;
  let files = 0;
  for (const f of fs.readdirSync(REAL_QUEUE_DIR)) {
    if (!f.endsWith('.jsonl')) continue;
    files++;
    lines += validateFile('queue', path.join(REAL_QUEUE_DIR, f));
  }
  assert.ok(files > 0 && lines > 0, `expected lines, got ${lines} in ${files} files`);
});

const REAL_LOGS: [Kind, string][] = [
  ['inbound', 'claude-code-vscode-ext-inbound.jsonl'],
  ['actions', 'notif-actions.jsonl'],
  ['outbound', 'claude-code-vscode-ext-outbound.jsonl'],
];
for (const [kind, name] of REAL_LOGS) {
  const file = path.join(REAL_LOGS_DIR, name);
  test(`real ${kind} file validates`, { skip: !nonEmpty(file) && `${name} absent or empty` }, () => {
    assert.ok(validateFile(kind, file) > 0);
  });
}

test('daemon session fixtures validate (queue + inbound)', { skip: !fs.existsSync(DAEMON_SESSIONS) && 'daemon fixtures not reachable' }, () => {
  let lines = 0;
  for (const s of fs.readdirSync(DAEMON_SESSIONS)) {
    lines += validateFile('queue', path.join(DAEMON_SESSIONS, s, 'queue.jsonl'));
    lines += validateFile('inbound', path.join(DAEMON_SESSIONS, s, 'inbound.jsonl'));
  }
  assert.ok(lines > 0);
});
