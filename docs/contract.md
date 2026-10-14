# Notify file contract

The Notify extension and the `notify-queue` skill talk through four JSONL
files under the project's `.devcontainer/tmp/`. This document is the
contract: one JSON Schema per file under [`../schemas/`](../schemas/), one
section per file below with its events, their effect on the consumer and
one example line each.

The examples are the test fixtures. `npm test` extracts every fenced block
tagged `json contract=<file>` from this page and validates it against the
matching schema, so an example that drifts from its schema fails the build.

## Versioning

- Every schema is `<file>.v1.schema.json`. A line carries the contract
  version in its `v` field. Today `v` is always `1` when present.
- **A line without `v` is today's format and is read as-is.** Every
  consumer must accept both. This keeps compatibility with the running hook
  and with every queue file already on disk.
- Of the four writers, only the `notify-queue` hook writes `v` today, and
  only on `hello`. The other events and the other three files are written
  without `v`; their schemas describe the current shape and accept `v: 1`.
- A change that an old consumer cannot ignore (a field removed, a type
  changed, a required field added) bumps `v` and adds a `v2` schema next to
  `v1`. Adding an optional field does not bump `v`.
- Every object is closed: a property not listed for its event is a
  validation error. A consumer that meets one logs the line and skips it.

| File | Path | Writer | Reader | Schema |
|---|---|---|---|---|
| queue | `.devcontainer/tmp/notify/<sid>.jsonl` | `notify-queue` hook (`hook.js`, `tail-cancel.js`) | the daemon today, the extension from session 4 | [queue.v1](../schemas/queue.v1.schema.json) |
| inbound | `.devcontainer/tmp/logs/claude-code-vscode-ext-inbound.jsonl` | patched Claude Code extension (`user-action-observer.py`) | the daemon's `inbound-watch.js` today | [inbound.v1](../schemas/inbound.v1.schema.json) |
| actions | `.devcontainer/tmp/logs/notif-actions.jsonl` | `notif` (`--on-action <label>:file:<path>`) | the daemon's `notify-app.js` today | [actions.v1](../schemas/actions.v1.schema.json) |
| outbound | `.devcontainer/tmp/logs/claude-code-vscode-ext-outbound.jsonl` | the notification consumer (daemon today) | patched Claude Code extension (`outbound-action-injector.py`) | [outbound.v1](../schemas/outbound.v1.schema.json) |

`inbound`, `outbound` and `pending-perms` are wiped at container start by
the sandbox image (`post-start.d/10-wipe-claude-ext-jsonl.sh`). The queue
is not; the consumer prunes it by age.

Timestamps (`ts`) are ISO-8601 UTC as written by JavaScript's
`Date#toISOString()` (`2026-10-14T08:12:33.120Z`). `notif` writes the same
shape from Rust.

## queue — `<sid>.jsonl`

One file per Claude Code session, named after the session id. The hook
appends one line per hook event, always with `ts`, `sid`, `event`. Every
notification event also carries the envelope written by `hook.js`:
`sender` (`"default"`), `notif_id` (`<event>-<sid8>-<epoch ms>`, the id the
banner is sent with so it can be removed later), and when known
`session_name`, `launchUrl` (the `vscode://vscode-remote/...` URL that
focuses the container window) and `focused` (host window focus at the last
permission cycle). Lines older than v0.2 of the hook and `tool_cancelled`
lines lack the envelope; that is why every envelope field is optional.

### `hello`

Written at `SessionStart` (every source: startup, resume, clear, compact).
It is the only event that requires `v`, and the only one without the
envelope. Effect: the consumer marks the producer *active* for this session;
a producer whose hooks are registered but that never said `hello` is
*installed, silent*. `producer_version` is the devcontainer-sandbox image
version read from `/etc/devcontainer-base-version`, or `"unknown"`.

```json contract=queue
{"v":1,"ts":"2026-10-14T08:12:33.120Z","sid":"11111111-2222-3333-4444-555555555555","event":"hello","producer":"notify-queue","producer_version":"1.10.0","agent":"claude-code"}
```

### `stop`

Claude finished its turn. `last_message_excerpt` (≤ 200 chars) is the
`**Recap**` line of the last assistant message when there is one, else its
first usable line. Effect: arm a 30 s timer, then notify unless cancelled.

```json contract=queue
{"ts":"2026-10-14T08:14:02.451Z","sid":"11111111-2222-3333-4444-555555555555","event":"stop","sender":"default","notif_id":"stop-11111111-1760429642451","session_name":"notify-contract","launchUrl":"vscode://vscode-remote/dev-container%2B7b22686f737450617468223a222f55736572732f6b6576696e2f6465762f6465762d636f6e7461696e65722d746f6f6c73227d/workspace","focused":true,"last_message_excerpt":"Schémas écrits, tests verts — commit proposé"}
```

### `notification`

Claude Code's `Notification` hook. The consumer flattens the event into
`notification_type`: `idle_prompt` (notify now), `permission_prompt`
(30 s timer; dropped when a richer `permission_request` is already
pending), `elicitation_dialog` (30 s timer). Any other value is logged as
unmapped and skipped. `message` is Claude Code's text, ≤ 200 chars.

```json contract=queue
{"ts":"2026-10-14T08:15:10.003Z","sid":"11111111-2222-3333-4444-555555555555","event":"notification","sender":"default","notif_id":"notification-11111111-1760429710003","session_name":"notify-contract","launchUrl":"vscode://vscode-remote/dev-container%2B7b22686f737450617468223a222f55736572732f6b6576696e2f6465762f6465762d636f6e7461696e65722d746f6f6c73227d/workspace","focused":false,"notification_type":"idle_prompt","message":"Claude is waiting for your input"}
```

### `permission_request`

Claude Code's `PermissionRequest` hook. `tool_name` and `tool_input` are
passed through verbatim; rendering is the consumer's job. `tool_use_id` is
the VS Code extension's permission request id, read from `pending-perms`;
when present the consumer may offer an **Allow** button, whose click comes
back through `actions` and is answered through `outbound` with this id as
`requestId`. Effect: arm a 30 s timer; a later `tool_finished`,
`tool_cancelled` or `user_replied` for the same `sid` cancels it.

```json contract=queue
{"ts":"2026-10-14T08:16:40.777Z","sid":"11111111-2222-3333-4444-555555555555","event":"permission_request","sender":"default","notif_id":"permission_request-11111111-1760429800777","session_name":"notify-contract","launchUrl":"vscode://vscode-remote/dev-container%2B7b22686f737450617468223a222f55736572732f6b6576696e2f6465762f6465762d636f6e7461696e65722d746f6f6c73227d/workspace","focused":true,"tool_use_id":"3f9c2a1b7e8d4c6a9b0f1e2d3c4b5a69","tool_name":"Bash","tool_input":{"command":"npm test","description":"Run the test suite"}}
```

### `user_replied`

Claude Code's `UserPromptSubmit` hook: the user is back. Effect: cancel
every pending timer for this `sid` and remove its banners. No `focused`
field is ever written on this event.

```json contract=queue
{"ts":"2026-10-14T08:17:05.210Z","sid":"11111111-2222-3333-4444-555555555555","event":"user_replied","sender":"default","notif_id":"user_replied-11111111-1760429825210","session_name":"notify-contract","launchUrl":"vscode://vscode-remote/dev-container%2B7b22686f737450617468223a222f55736572732f6b6576696e2f6465762f6465762d636f6e7461696e65722d746f6f6c73227d/workspace"}
```

### `tool_started` / `tool_finished`

`PreToolUse` / `PostToolUse`. `tool_started` has no effect (it only tells a
consumer the session is alive). `tool_finished` cancels a pending
permission timer for this `sid`, because the tool ran, so the permission
was granted in the editor.

```json contract=queue
{"ts":"2026-10-14T08:16:41.900Z","sid":"11111111-2222-3333-4444-555555555555","event":"tool_started","sender":"default","notif_id":"tool_started-11111111-1760429801900","session_name":"notify-contract","launchUrl":"vscode://vscode-remote/dev-container%2B7b22686f737450617468223a222f55736572732f6b6576696e2f6465762f6465762d636f6e7461696e65722d746f6f6c73227d/workspace","focused":true}
```

```json contract=queue
{"ts":"2026-10-14T08:16:43.118Z","sid":"11111111-2222-3333-4444-555555555555","event":"tool_finished","sender":"default","notif_id":"tool_finished-11111111-1760429803118","session_name":"notify-contract","launchUrl":"vscode://vscode-remote/dev-container%2B7b22686f737450617468223a222f55736572732f6b6576696e2f6465762f6465762d636f6e7461696e65722d746f6f6c73227d/workspace","focused":true}
```

### `tool_cancelled`

Written by `tail-cancel.js`, spawned on `permission_request`, when the
transcript shows the user rejected the tool use (Claude Code fires no
`PostToolUse` on Cancel). Carries only `ts`, `sid`, `event`. Effect: same
as `tool_finished`.

```json contract=queue
{"ts":"2026-10-14T08:16:52.004Z","sid":"11111111-2222-3333-4444-555555555555","event":"tool_cancelled"}
```

## inbound — `claude-code-vscode-ext-inbound.jsonl`

Every message the Claude Code webview sends to its extension, recorded by
the `user-action-observer` patch as `{ts, source, sessionId, channelId, pid,
type, payload}`. `payload` is the message verbatim, so its shape is
Claude Code's, not ours; the schema only fixes the record around it.
`sessionId` is `null` when no session can be attributed. Known `type`
values: `io_message`, `response`, `request`, `launch_claude`,
`interrupt_claude`, `close_channel`, `cancel_request`; a consumer ignores
the ones it does not handle.

Effect on the consumer (what the daemon does today):

- `response` with `payload.response.type = "tool_permission_response"`:
  the user answered the permission prompt in the editor. Cancel the
  pending permission timer for `sessionId`.
- `interrupt_claude`, and `io_message` whose `payload.message.type` is
  `"user"`: the user is active. Cancel everything pending for `sessionId`.
- `launch_claude` with `payload.resume`: a session was resumed. Cancel
  everything pending for the resumed id.

```json contract=inbound
{"ts":"2026-10-14T08:16:48.330Z","source":"user-action","sessionId":"11111111-2222-3333-4444-555555555555","channelId":"0452un6tkli6","pid":41213,"type":"response","payload":{"type":"response","requestId":"0452un6tkli6","response":{"type":"tool_permission_response","result":{"behavior":"allow","updatedInput":{"command":"npm test"},"updatedPermissions":[]}}}}
```

```json contract=inbound
{"ts":"2026-10-14T08:17:05.100Z","source":"user-action","sessionId":"11111111-2222-3333-4444-555555555555","channelId":"ch-7f3a","pid":null,"type":"io_message","payload":{"type":"io_message","channelId":"ch-7f3a","message":{"type":"user","message":{"role":"user","content":"go"}}}}
```

## actions — `notif-actions.jsonl`

Written by the `notif` binary when the user interacts with a banner that
was sent with `--on-action <label>:file:<path>`. The record is notif's
`CallbackPayload`: the banner's `notif_id` (our queue `notif_id`), the
`event` (`click`, `dismiss`, `timeout` or `action:<label>`), the sender,
the title and body shown, and a timestamp. Effect: on `action:Allow` the
consumer looks up the `permission_request` it sent that banner for and
writes an `outbound` line; every other event is ignored.

```json contract=actions
{"notif_id":"permission_request-11111111-1760429800777","event":"action:Allow","sender":"claude-code","title":"Claude Code — notify-contract","body":"Bash : npm test","ts":"2026-10-14T08:16:47.902Z"}
```

```json contract=actions
{"notif_id":"stop-11111111-1760429642451","event":"click","sender":"claude-code","title":"Claude Code — notify-contract","body":"Schémas écrits, tests verts — commit proposé","ts":"2026-10-14T08:14:40.015Z"}
```

## outbound — `claude-code-vscode-ext-outbound.jsonl`

A command for the patched Claude Code extension, which polls the file and
replays each line as a simulated click on the matching permission prompt.
One command exists: `tool_permission_response`. `sessionId` is the queue
`sid`, `requestId` the queue `tool_use_id`. `behavior` is `allow` or
`deny`; `updatedInput` (default `{}`) is the tool input to run with, and
the writer passes the queue line's `tool_input` through; `updatedPermissions`
(default `[]`) is always empty today; `message` is read only on `deny`
(default `"denied"`).

```json contract=outbound
{"cmd":"tool_permission_response","sessionId":"11111111-2222-3333-4444-555555555555","requestId":"3f9c2a1b7e8d4c6a9b0f1e2d3c4b5a69","behavior":"allow","updatedInput":{"command":"npm test","description":"Run the test suite"},"updatedPermissions":[]}
```

```json contract=outbound
{"cmd":"tool_permission_response","sessionId":"11111111-2222-3333-4444-555555555555","requestId":"3f9c2a1b7e8d4c6a9b0f1e2d3c4b5a69","behavior":"deny","message":"denied from the notification"}
```
