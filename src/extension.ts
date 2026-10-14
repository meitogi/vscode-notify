import * as vscode from 'vscode';
import { ensureExecutable, resolveNotifPath } from './notifPath';
import * as log from './log';

/**
 * VS Code activation entry point. Resolves the bundled `notif` binary and
 * checks its exec bit in the background — nothing here blocks activation or
 * spawns `notif` (a permission dialog would freeze every UI extension).
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push({ dispose: () => log.dispose() });
  const setting = vscode.workspace.getConfiguration('notify').get<string>('notifPath', '');
  const notifPath = resolveNotifPath(context.extensionPath, setting, process.platform);
  log.info(`activated — notif: ${notifPath}${setting.trim() ? ' (notify.notifPath override)' : ''}`);
  ensureExecutable(notifPath, process.platform).then(
    (result) => log.info(`notif exec bit: ${result}`),
    (err) => log.error('notif exec-bit check failed', err)
  );
}

export function deactivate(): void {
  log.dispose();
}
