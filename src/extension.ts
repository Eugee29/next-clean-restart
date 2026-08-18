import * as vscode from 'vscode';
import { ExtensionConfig, ExecutionMode, NextProjectInfo } from './types';
import { findAllNextProjects, resolveTargetProject } from './detector';
import { executeCleanRestart, focusDevTerminal, getActiveOrRunningTerminalName } from './cleanRestart';
import { StatusBarController } from './statusBar';
import { NextCleanRestartTreeDataProvider } from './sidebarProvider';

let statusBarController: StatusBarController | null = null;
let sidebarProvider: NextCleanRestartTreeDataProvider | null = null;
let detectedProjectsCache: NextProjectInfo[] = [];

/**
 * Retrieves the current extension configuration from VS Code settings.
 */
function getExtensionConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('nextCleanRestart');

  return {
    devCommand: config.get<string>('devCommand', 'auto'),
    showConfirmation: config.get<boolean>('showConfirmation', false),
    terminalName: config.get<string>('terminalName', 'auto'),
    showStatusBarItem: config.get<boolean>('showStatusBarItem', true),
    cacheDirectory: config.get<string>('cacheDirectory', '.next'),
    retryAttempts: config.get<number>('retryAttempts', 5),
    retryDelayMs: config.get<number>('retryDelayMs', 300),
    focusTerminalOnStart: config.get<boolean>('focusTerminalOnStart', false),
    reuseTerminal: config.get<boolean>('reuseTerminal', true),
  };
}

/**
 * Scans the workspace for Next.js projects and updates the status bar, sidebar, and context keys.
 */
async function refreshWorkspaceProjects(): Promise<NextProjectInfo[]> {
  const config = getExtensionConfig();
  const projects = await findAllNextProjects(config.cacheDirectory);
  detectedProjectsCache = projects;

  const isNextProject = projects.length > 0;
  await vscode.commands.executeCommand('setContext', 'nextCleanRestart:isNextProject', isNextProject);

  if (statusBarController) {
    statusBarController.update(projects, config.showStatusBarItem);
  }

  if (sidebarProvider) {
    sidebarProvider.update(projects, config);
  }

  return projects;
}

/**
 * Handles command execution for clean & restart, clean only, or restart only.
 */
async function handleAction(mode: ExecutionMode, specificProject?: NextProjectInfo): Promise<void> {
  const config = getExtensionConfig();

  let targetProject: NextProjectInfo | null | undefined = specificProject;

  if (!targetProject) {
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

    targetProject = await resolveTargetProject(projects, activeUri);
  }

  if (!targetProject) {
    // User cancelled quick pick or no project selected
    return;
  }

  await executeCleanRestart(targetProject, config, mode);

  // Refresh sidebar to update cache status indicator
  if (sidebarProvider) {
    sidebarProvider.update(detectedProjectsCache, config);
  }
}

/**
 * Activates the extension.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const initialConfig = getExtensionConfig();

  // Initialize status bar
  statusBarController = new StatusBarController();
  context.subscriptions.push(statusBarController);

  // Initialize sidebar TreeDataProvider
  sidebarProvider = new NextCleanRestartTreeDataProvider(initialConfig);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('nextCleanRestart.mainView', sidebarProvider)
  );

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

  context.subscriptions.push(
    vscode.commands.registerCommand('nextCleanRestart.cleanRestartProject', (project: NextProjectInfo) =>
      handleAction('cleanAndRestart', project)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('nextCleanRestart.cleanOnlyProject', (project: NextProjectInfo) =>
      handleAction('cleanOnly', project)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('nextCleanRestart.focusTerminal', () => {
      const config = getExtensionConfig();
      const focused = focusDevTerminal(config.terminalName);
      if (!focused) {
        vscode.window.showInformationMessage(
          `No running terminal found (${getActiveOrRunningTerminalName(config.terminalName)}).`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('nextCleanRestart.configureKeybinding', () => {
      vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'nextCleanRestart');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('nextCleanRestart.selectActiveTerminal', async () => {
      const currentConfig = getExtensionConfig();
      const openTerminals = vscode.window.terminals;

      const items: Array<{ label: string; description?: string; detail?: string; value: string }> = [
        {
          label: '$(sparkle) Auto-detect active terminal',
          description: currentConfig.terminalName === 'auto' ? '(Current)' : undefined,
          detail: 'Automatically target the currently focused or active terminal window',
          value: 'auto',
        },
      ];

      // Add currently open terminals
      for (const t of openTerminals) {
        const isCurrentActive = vscode.window.activeTerminal === t;
        items.push({
          label: `$(terminal) ${t.name}`,
          description: isCurrentActive ? '(Active)' : undefined,
          detail: `Target this specific open terminal`,
          value: t.name,
        });
      }

      items.push({
        label: '$(edit) Custom terminal name...',
        detail: 'Specify a custom terminal name string',
        value: '__CUSTOM__',
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select target terminal strategy for Next.js Clean Restart',
        title: 'Target Terminal Selection',
      });

      if (!selected) {
        return;
      }

      const config = vscode.workspace.getConfiguration('nextCleanRestart');

      if (selected.value === '__CUSTOM__') {
        const customName = await vscode.window.showInputBox({
          prompt: 'Enter custom terminal name to target',
          value: currentConfig.terminalName === 'auto' ? 'Next.js Dev Server' : currentConfig.terminalName,
        });

        if (customName !== undefined && customName.trim() !== '') {
          await config.update('terminalName', customName.trim(), vscode.ConfigurationTarget.Global);
          await refreshWorkspaceProjects();
        }
      } else {
        await config.update('terminalName', selected.value, vscode.ConfigurationTarget.Global);
        await refreshWorkspaceProjects();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('nextCleanRestart.refreshSidebar', () => {
      refreshWorkspaceProjects();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'nextCleanRestart.toggleSetting',
      async (settingKey: string, newValue: boolean) => {
        const config = vscode.workspace.getConfiguration('nextCleanRestart');
        await config.update(settingKey, newValue, vscode.ConfigurationTarget.Global);
        await refreshWorkspaceProjects();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'nextCleanRestart.editSetting',
      async (settingKey: string, prompt: string, currentValue: string, isNumeric = false) => {
        const input = await vscode.window.showInputBox({
          prompt: `Edit ${prompt}`,
          value: currentValue,
          validateInput: (val) => {
            if (isNumeric) {
              const num = Number(val);
              if (isNaN(num) || num < 0) {
                return 'Please enter a valid positive number';
              }
            }
            return null;
          },
        });

        if (input !== undefined) {
          const config = vscode.workspace.getConfiguration('nextCleanRestart');
          const valueToSave = isNumeric ? Number(input) : input;
          await config.update(settingKey, valueToSave, vscode.ConfigurationTarget.Global);
          await refreshWorkspaceProjects();
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('nextCleanRestart.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'nextCleanRestart');
    })
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

  // Terminal state listeners to update sidebar terminal name in real time
  const triggerTerminalRefresh = () => {
    if (sidebarProvider) {
      const config = getExtensionConfig();
      sidebarProvider.update(detectedProjectsCache, config);
    }
  };

  context.subscriptions.push(vscode.window.onDidChangeActiveTerminal(triggerTerminalRefresh));
  context.subscriptions.push(vscode.window.onDidOpenTerminal(triggerTerminalRefresh));
  context.subscriptions.push(vscode.window.onDidCloseTerminal(triggerTerminalRefresh));

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
  sidebarProvider = null;
}
