import * as fs from 'node:fs';
import * as path from 'node:path';

/** Outcome of {@link ensureExecutable}. */
export type ExecBitResult = 'ok' | 'chmodded' | 'missing' | 'skipped';

/**
 * Resolve the `notif` binary the extension should run.
 *
 * @param extRoot   The extension's install folder (`context.extensionPath`).
 * @param setting   Value of `notify.notifPath` — wins when non-blank.
 * @param platform  `process.platform` ; win32 gets the `.exe` suffix.
 * @returns         The override as given, else `<extRoot>/bin/notif[.exe]`.
 */
export function resolveNotifPath(extRoot: string, setting: string | undefined, platform: NodeJS.Platform): string {
  const override = setting?.trim();
  if (override) {
    return override;
  }
  return path.join(extRoot, 'bin', platform === 'win32' ? 'notif.exe' : 'notif');
}

/**
 * Make sure the owner exec bit is set on `file`. vsce stores mode 755 and the
 * macOS install keeps it, so this is a defensive check : chmod only if missing.
 *
 * @returns  `skipped` on win32, `missing` when the file does not exist,
 *           `ok` when already executable, `chmodded` after adding the bits.
 */
export async function ensureExecutable(file: string, platform: NodeJS.Platform): Promise<ExecBitResult> {
  if (platform === 'win32') {
    return 'skipped';
  }
  let mode: number;
  try {
    mode = (await fs.promises.stat(file)).mode;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'missing';
    }
    throw err;
  }
  if (mode & 0o100) {
    return 'ok';
  }
  await fs.promises.chmod(file, (mode & 0o777) | 0o111);
  return 'chmodded';
}
