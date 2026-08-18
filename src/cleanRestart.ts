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
 * Finds any existing Next.js terminal matching the terminalName.
 */
export function findDevTerminal(terminalName: string): vscode.Terminal | undefined {
  return vscode.window.terminals.find((t) => t.name === terminalName);
}

/**
 * Focuses the existing dev terminal if open.
 */
export function focusDevTerminal(terminalName: string): boolean {
  const terminal = findDevTerminal(terminalName);
  if (terminal) {
    terminal.show(false);
    return true;
  }
  return false;
}

/**
 * Stops any existing Next.js terminal matching the terminalName.
 * If reuseTerminal is true, it interrupts the process via SIGINT without destroying the terminal.
 */
export async function stopDevServer(
  terminalName: string,
  reuseTerminal = true
): Promise<vscode.Terminal | undefined> {
  const matchingTerminals = vscode.window.terminals.filter((t) => t.name === terminalName);

  if (matchingTerminals.length === 0) {
    return undefined;
  }

  const primaryTerminal = matchingTerminals[0];

  for (const terminal of matchingTerminals) {
    try {
      // Send SIGINT / Ctrl+C
      terminal.sendText('\x03', false);
      await delay(300);
      // On Windows PowerShell/cmd, sending a newline or 'Y' responds to batch prompts if needed
      terminal.sendText('y', true);
      await delay(300);

      if (!reuseTerminal) {
        terminal.dispose();
      }
    } catch {
      // If error occurs, continue
    }
  }

  // Grace period for OS to release file locks on Windows
  await delay(500);

  return reuseTerminal ? primaryTerminal : undefined;
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
 * Reuses the existing terminal if available and reuseTerminal is true.
 */
export async function startDevServer(
  project: NextProjectInfo,
  terminalName: string,
  devCommand: string,
  focusTerminal = false,
  reuseTerminal = true
): Promise<vscode.Terminal> {
  let terminal: vscode.Terminal | undefined;

  if (reuseTerminal) {
    terminal = findDevTerminal(terminalName);
  }

  if (terminal) {
    // Reuse the existing running terminal
    terminal.show(!focusTerminal);
    await delay(250);
    terminal.sendText(devCommand, true);
  } else {
    // Create a new dedicated terminal in the project directory
    terminal = vscode.window.createTerminal({
      name: terminalName,
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
