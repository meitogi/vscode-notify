# Notify

A VS Code UI extension (runs on the host) that shows desktop notifications for
Claude Code sessions running in a Dev Container. It replaces the host-side
Node notify daemon.

**Status : beta scaffold.** For now the extension only resolves its bundled
`notif` binary and checks that it can execute. It sends no notifications yet.

## Layout

- `src/` — extension sources ; `test/` — `node:test` unit tests.
- `bin/notif` (`bin/notif.exe` on Windows) — the [notif](https://github.com/meitogi/notifier)
  binary. It is fetched at packaging time and never committed. The
  `notify.notifPath` setting overrides it, for testing a hand-built binary.
- `scripts/fetch-notif.sh` — downloads and checksums the released `notif`
  for one VSIX target. The list of asset names lives in this script.
- `.github/workflows/` — `ci.yml` (build + test on push), `release.yml`
  (tag `v*` → one VSIX per platform → draft GitHub Release).

## Develop

```sh
npm install
npm test
cp /path/to/notif bin/notif
npx vsce package --target darwin-arm64
```
