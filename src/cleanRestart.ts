import * as vscode from 'vscode';
import * as fs from 'fs';
import { NextProjectInfo, ExtensionConfig, ExecutionMode, CleanRestartResult } from './types';
import { resolveDevCommand } from './detector';

/**
 * Delays execution by the specified milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves the target dev server terminal based on configuration and active terminals.
 * If terminalName is 'auto', it prioritizes the currently active terminal or any Next.js dev terminal.
 */
export function resolveTargetTerminal(terminalNameSetting: string): vscode.Terminal | undefined {
  const terminals = vscode.window.terminals;
  if (terminals.length === 0) {
    return undefined;
  }

  const isAuto = !terminalNameSetting || terminalNameSetting.trim() === '' || terminalNameSetting.toLowerCase() === 'auto';

  if (!isAuto) {
    // Exact match for custom configured terminal name
    const exactMatch = terminals.find(
      (t) => t.name.toLowerCase() === terminalNameSetting.trim().toLowerCase()
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  // Auto-detection logic:
  // 1. Check if active terminal is available
  if (vscode.window.activeTerminal) {
    return vscode.window.activeTerminal;
  }

  // 2. Check for terminal with Next.js related name
  const nextTerminal = terminals.find((t) => {
    const name = t.name.toLowerCase();
    return name.includes('next') || name.includes('dev') || name.includes('server');
  });
  if (nextTerminal) {
    return nextTerminal;
  }

  // 3. Fallback to the most recent terminal
  return terminals[terminals.length - 1];
}

/**
 * Returns a human-readable description of the resolved target terminal for UI display.
 */
export function getActiveOrRunningTerminalName(terminalNameSetting: string): string {
  const isAuto = !terminalNameSetting || terminalNameSetting.trim() === '' || terminalNameSetting.toLowerCase() === 'auto';
  const targetTerminal = resolveTargetTerminal(terminalNameSetting);

  if (isAuto) {
    if (targetTerminal) {
      return `auto (Active: ${targetTerminal.name})`;
    }
    return 'auto (No active terminal)';
  }

  if (targetTerminal) {
    return `${terminalNameSetting} (Open)`;
  }
  return `${terminalNameSetting} (Not running)`;
}

/**
 * Focuses the existing dev terminal if available.
 */
export function focusDevTerminal(terminalNameSetting: string): boolean {
  const terminal = resolveTargetTerminal(terminalNameSetting);
  if (terminal) {
    terminal.show(false);
    return true;
  }
  return false;
}

/**
 * Stops any running process in the target dev server terminal.
 * If reuseTerminal is true, it interrupts the process via SIGINT without destroying the terminal.
 */
export async function stopDevServer(
  terminalNameSetting: string,
  reuseTerminal = true
): Promise<vscode.Terminal | undefined> {
  const targetTerminal = resolveTargetTerminal(terminalNameSetting);

  if (!targetTerminal) {
    return undefined;
  }

  try {
    // Send SIGINT / Ctrl+C
    targetTerminal.sendText('\x03', false);
    await delay(300);
    // Respond to Windows batch termination prompts if any
    targetTerminal.sendText('y', true);
    await delay(300);

    if (!reuseTerminal) {
      targetTerminal.dispose();
      await delay(400);
      return undefined;
    }
  } catch {
    // If error occurs, continue
  }

  // Grace period for OS to release file locks on Windows
  await delay(500);

  return targetTerminal;
}

/**
 * Recursively deletes the .next build cache directory with retry logic for file locks.
 */
export async function deleteNextCache(
  cacheUri: vscode.Uri,
  retryAttempts = 5,
  retryDelayMs = 300,
  progressCallback?: (message: string) => void
): Promise<boolean> {
  const cachePath = cacheUri.fsPath;

  if (!fs.existsSync(cachePath)) {
    return true; // Already clean
  }

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < retryAttempts) {
    attempt++;
    try {
      if (progressCallback && attempt > 1) {
        progressCallback(`Retrying cache deletion (attempt ${attempt}/${retryAttempts})...`);
      }

      // Try VS Code workspace file system API first
      try {
        await vscode.workspace.fs.delete(cacheUri, { recursive: true, useTrash: false });
      } catch {
        // Fallback to Node.js fs.promises.rm with force
        await fs.promises.rm(cachePath, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      }

      // Verify deletion succeeded
      if (!fs.existsSync(cachePath)) {
        return true;
      }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Wait before next retry
      await delay(retryDelayMs);
    }
  }

  if (fs.existsSync(cachePath)) {
    const errorMsg = lastError?.message || 'File lock or permission issue';
    throw new Error(
      `Failed to delete '${cachePath}' after ${retryAttempts} attempts. ` +
      `Ensure no background processes, antivirus, or file locks are holding the directory. (${errorMsg})`
    );
  }

  return true;
}

/**
 * Starts or restarts a Next.js development server in an integrated terminal.
 * Reuses the existing target terminal if available and reuseTerminal is true.
 */
export async function startDevServer(
  project: NextProjectInfo,
  terminalNameSetting: string,
  devCommand: string,
  focusTerminal = false,
  reuseTerminal = true
): Promise<vscode.Terminal> {
  let terminal: vscode.Terminal | undefined;

  if (reuseTerminal) {
    terminal = resolveTargetTerminal(terminalNameSetting);
  }

  if (terminal) {
    // Reuse the existing running terminal
    terminal.show(!focusTerminal);
    await delay(250);
    terminal.sendText(devCommand, true);
  } else {
    // Create a new dedicated terminal in the project directory
    const isAuto = !terminalNameSetting || terminalNameSetting.toLowerCase() === 'auto';
    const newName = isAuto ? 'Next.js Dev Server' : terminalNameSetting;

    terminal = vscode.window.createTerminal({
      name: newName,
      cwd: project.uri.fsPath,
      message: `Next.js Dev Server: ${devCommand}`,
    });

    terminal.show(!focusTerminal);
    await delay(300);
    terminal.sendText(devCommand, true);
  }

  return terminal;
}

/**
 * Executes the complete Clean & Restart workflow with progress reporting and error handling.
 */
export async function executeCleanRestart(
  project: NextProjectInfo,
  config: ExtensionConfig,
  mode: ExecutionMode = 'cleanAndRestart'
): Promise<CleanRestartResult> {
  // Step 0: Confirmation if enabled
  if (config.showConfirmation) {
    const actionLabel =
      mode === 'cleanAndRestart'
        ? 'Clean & Restart'
        : mode === 'cleanOnly'
        ? 'Clean Cache'
        : 'Restart Server';

    const selection = await vscode.window.showWarningMessage(
      `Next.js Clean Restart: Are you sure you want to ${actionLabel.toLowerCase()} for project "${project.name}"?`,
      { modal: true },
      actionLabel
    );

    if (selection !== actionLabel) {
      return {
        success: false,
        project,
        deletedCache: false,
        restartedServer: false,
        error: 'Operation cancelled by user.',
      };
    }
  }

  const devCommand = resolveDevCommand(project, config.devCommand);

  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Next.js [${project.name}]`,
      cancellable: false,
    },
    async (progress) => {
      let deletedCache = false;
      let restartedServer = false;

      try {
        // Step 1 & 2: Stop running server
        if (mode === 'cleanAndRestart' || mode === 'cleanOnly' || mode === 'restartOnly') {
          progress.report({ message: 'Stopping running Next.js dev server...' });
          await stopDevServer(config.terminalName, config.reuseTerminal);
        }

        // Step 3: Delete cache directory
        if (mode === 'cleanAndRestart' || mode === 'cleanOnly') {
          progress.report({ message: 'Deleting .next cache directory...' });
          deletedCache = await deleteNextCache(
            project.cacheUri,
            config.retryAttempts,
            config.retryDelayMs,
            (retryMsg) => progress.report({ message: retryMsg })
          );
        }

        // Step 4: Restart dev server
        if (mode === 'cleanAndRestart' || mode === 'restartOnly') {
          progress.report({ message: `Starting dev server (${devCommand})...` });
          const terminal = await startDevServer(
            project,
            config.terminalName,
            devCommand,
            config.focusTerminalOnStart,
            config.reuseTerminal
          );
          restartedServer = true;

          // Step 5: Notification Toast
          const viewTerminalBtn = 'View Terminal';
          if (mode === 'cleanAndRestart') {
            vscode.window
              .showInformationMessage(
                `Next.js cache cleared and dev server restarted for "${project.name}".`,
                viewTerminalBtn
              )
              .then((item) => {
                if (item === viewTerminalBtn) {
                  terminal.show(false);
                }
              });
          } else if (mode === 'restartOnly') {
            vscode.window
              .showInformationMessage(
                `Next.js dev server restarted for "${project.name}".`,
                viewTerminalBtn
              )
              .then((item) => {
                if (item === viewTerminalBtn) {
                  terminal.show(false);
                }
              });
          }
        } else if (mode === 'cleanOnly') {
          vscode.window.showInformationMessage(
            `Next.js cache (.next) successfully deleted for "${project.name}".`
          );
        }

        return {
          success: true,
          project,
          devCommand,
          deletedCache,
          restartedServer,
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Next.js Clean Restart error: ${errorMsg}`);
        return {
          success: false,
          project,
          devCommand,
          deletedCache,
          restartedServer,
          error: errorMsg,
        };
      }
    }
  );
}
