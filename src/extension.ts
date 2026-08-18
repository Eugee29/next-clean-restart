import * as vscode from 'vscode';
import { ExtensionConfig, ExecutionMode } from './types';
import { findAllNextProjects, resolveTargetProject } from './detector';
import { executeCleanRestart } from './cleanRestart';
import { StatusBarController } from './statusBar';

let statusBarController: StatusBarController | null = null;
let detectedProjectsCache: import('./types').NextProjectInfo[] = [];

/**
 * Retrieves the current extension configuration from VS Code settings.
 */
function getExtensionConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('nextCleanRestart');

  return {
    devCommand: config.get<string>('devCommand', 'auto'),
    showConfirmation: config.get<boolean>('showConfirmation', false),
    terminalName: config.get<string>('terminalName', 'Next.js Dev Server'),
    showStatusBarItem: config.get<boolean>('showStatusBarItem', true),
    cacheDirectory: config.get<string>('cacheDirectory', '.next'),
    retryAttempts: config.get<number>('retryAttempts', 5),
    retryDelayMs: config.get<number>('retryDelayMs', 300),
    focusTerminalOnStart: config.get<boolean>('focusTerminalOnStart', false),
  };
}

/**
 * Scans the workspace for Next.js projects and updates the status bar and context keys.
 */
async function refreshWorkspaceProjects(): Promise<import('./types').NextProjectInfo[]> {
  const config = getExtensionConfig();
  const projects = await findAllNextProjects(config.cacheDirectory);
  detectedProjectsCache = projects;

  const isNextProject = projects.length > 0;
  await vscode.commands.executeCommand('setContext', 'nextCleanRestart:isNextProject', isNextProject);

  if (statusBarController) {
    statusBarController.update(projects, config.showStatusBarItem);
  }

  return projects;
}

/**
 * Handles command execution for clean & restart, clean only, or restart only.
 */
async function handleAction(mode: ExecutionMode): Promise<void> {
  const config = getExtensionConfig();

  // If cache is empty, refresh first
  let projects = detectedProjectsCache;
  if (projects.length === 0) {
    projects = await refreshWorkspaceProjects();
  }

  if (projects.length === 0) {
    vscode.window.showWarningMessage(
      'Next.js Clean Restart: No Next.js project detected in the current workspace.'
    );
    return;
  }

  const activeEditor = vscode.window.activeTextEditor;
  const activeUri = activeEditor ? activeEditor.document.uri : undefined;

  const targetProject = await resolveTargetProject(projects, activeUri);
  if (!targetProject) {
    // User cancelled quick pick or no project selected
    return;
  }

  await executeCleanRestart(targetProject, config, mode);
}

/**
 * Activates the extension.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  statusBarController = new StatusBarController();
  context.subscriptions.push(statusBarController);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('nextCleanRestart.cleanRestart', () =>
      handleAction('cleanAndRestart')
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('nextCleanRestart.cleanOnly', () =>
      handleAction('cleanOnly')
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('nextCleanRestart.restartOnly', () =>
      handleAction('restartOnly')
    )
  );

  // Configuration change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('nextCleanRestart')) {
        refreshWorkspaceProjects();
      }
    })
  );

  // Workspace folder change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      refreshWorkspaceProjects();
    })
  );

  // File watcher for next.config.* and package.json to auto-detect Next.js additions
  try {
    const watcher = vscode.workspace.createFileSystemWatcher(
      '**/{package.json,next.config.js,next.config.mjs,next.config.ts,next.config.cjs}'
    );

    let debounceTimer: NodeJS.Timeout | undefined;
    const triggerDebouncedRefresh = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        refreshWorkspaceProjects();
      }, 800);
    };

    watcher.onDidCreate(triggerDebouncedRefresh);
    watcher.onDidDelete(triggerDebouncedRefresh);
    watcher.onDidChange(triggerDebouncedRefresh);

    context.subscriptions.push(watcher);
  } catch {
    // Ignore watcher errors in restricted environments
  }

  // Initial project scan
  await refreshWorkspaceProjects();
}

/**
 * Deactivates the extension.
 */
export function deactivate(): void {
  if (statusBarController) {
    statusBarController.dispose();
    statusBarController = null;
  }
}
