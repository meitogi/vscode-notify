import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/**
 * Lazily create (and return) the shared "Notify" `OutputChannel`.
 *
 * @returns  The singleton channel. Re-creates after `dispose()`.
 */
export function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Notify');
  }
  return channel;
}

/**
 * Log an info-level line to the OutputChannel.
 *
 * @param msg  Message body. Prefixed with `[info]`.
 */
export function info(msg: string): void {
  getChannel().appendLine(`[info] ${msg}`);
}

/**
 * Log an error-level line and append the error's message + stack when given.
 *
 * @param msg  Human-readable summary. Prefixed with `[error]`.
 * @param err  Optional cause — `Error` instances render `message` then `stack`.
 */
export function error(msg: string, err?: unknown): void {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : err ? String(err) : '';
  getChannel().appendLine(`[error] ${msg}${detail ? `\n${detail}` : ''}`);
}

/** Dispose the OutputChannel singleton. */
export function dispose(): void {
  channel?.dispose();
  channel = undefined;
}
