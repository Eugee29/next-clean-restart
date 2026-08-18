import * as vscode from 'vscode';
import * as fs from 'fs';
import { NextProjectInfo, ExtensionConfig } from './types';

export enum SidebarItemType {
  Category,
  Action,
  Project,
  ProjectDetail,
  ProjectAction,
  SettingToggle,
  SettingEdit,
  OpenSettings,
  InfoMessage,
}

export interface SidebarItem {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  type: SidebarItemType;
  command?: vscode.Command;
  children?: SidebarItem[];
  contextValue?: string;
  settingKey?: keyof ExtensionConfig;
  settingType?: 'boolean' | 'string' | 'number';
}

export class NextCleanRestartTreeDataProvider implements vscode.TreeDataProvider<SidebarItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SidebarItem | undefined | null | void> =
    new vscode.EventEmitter<SidebarItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SidebarItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private projects: NextProjectInfo[] = [];
  private config: ExtensionConfig;

  constructor(config: ExtensionConfig) {
    this.config = config;
  }

  public update(projects: NextProjectInfo[], config: ExtensionConfig): void {
    this.projects = projects;
    this.config = config;
    this._onDidChangeTreeData.fire();
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: SidebarItem): vscode.TreeItem {
    const collapsibleState =
      element.children && element.children.length > 0
        ? element.type === SidebarItemType.Category
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

    const item = new vscode.TreeItem(element.label, collapsibleState);
    item.id = element.id;
    item.description = element.description;
    item.tooltip = element.tooltip || element.label;
    item.contextValue = element.contextValue;

    if (element.icon) {
      item.iconPath = new vscode.ThemeIcon(element.icon);
    }

    if (element.command) {
      item.command = element.command;
    }

    return item;
  }

  public getChildren(element?: SidebarItem): Thenable<SidebarItem[]> {
    if (!element) {
      return Promise.resolve(this.getRootCategories());
    }
    return Promise.resolve(element.children || []);
  }

  private getRootCategories(): SidebarItem[] {
    return [
      this.getQuickActionsCategory(),
      this.getProjectsCategory(),
      this.getSettingsCategory(),
    ];
  }

  private getQuickActionsCategory(): SidebarItem {
    return {
      id: 'category-quick-actions',
      label: 'Quick Actions',
      type: SidebarItemType.Category,
      icon: 'zap',
      children: [
        {
          id: 'action-clean-restart',
          label: 'Clean & Restart Dev Server',
          description: 'Ctrl+Alt+N',
          tooltip: 'Stop server, purge .next cache directory, and start fresh dev server',
          icon: 'sync',
          type: SidebarItemType.Action,
          command: {
            command: 'nextCleanRestart.cleanRestart',
            title: 'Clean & Restart Dev Server',
          },
        },
        {
          id: 'action-clean-only',
          label: 'Clean .next Cache Only',
          tooltip: 'Stop server and purge .next cache directory without restarting',
          icon: 'trash',
          type: SidebarItemType.Action,
          command: {
            command: 'nextCleanRestart.cleanOnly',
            title: 'Clean .next Cache Only',
          },
        },
        {
          id: 'action-restart-only',
          label: 'Restart Dev Server Only',
          tooltip: 'Restart the dev server without wiping .next cache directory',
          icon: 'refresh',
          type: SidebarItemType.Action,
          command: {
            command: 'nextCleanRestart.restartOnly',
            title: 'Restart Dev Server Only',
          },
        },
        {
          id: 'action-focus-terminal',
          label: 'Focus Dev Terminal',
          description: this.config.terminalName,
          tooltip: 'Bring the running Next.js integrated terminal into focus',
          icon: 'terminal',
          type: SidebarItemType.Action,
          command: {
            command: 'nextCleanRestart.focusTerminal',
            title: 'Focus Dev Terminal',
          },
        },
      ],
    };
  }

  private getProjectsCategory(): SidebarItem {
    const children: SidebarItem[] = [];

    if (this.projects.length === 0) {
      children.push({
        id: 'no-projects-detected',
        label: 'No Next.js project detected',
        description: 'Waiting for workspace scan...',
        tooltip: 'Ensure a package.json or next.config file is present in the workspace.',
        icon: 'info',
        type: SidebarItemType.InfoMessage,
      });
    } else {
      for (const project of this.projects) {
        const cacheExists = fs.existsSync(project.cacheUri.fsPath);
        const cacheLabel = cacheExists ? 'Present' : 'Clean';
        const cacheIcon = cacheExists ? 'folder-active' : 'check';

        const projectChildren: SidebarItem[] = [
          {
            id: `project-${project.name}-pm`,
            label: `Package Manager: ${project.packageManager}`,
            icon: 'package',
            type: SidebarItemType.ProjectDetail,
          },
          {
            id: `project-${project.name}-script`,
            label: `Dev Script: ${project.devScriptName}`,
            icon: 'play',
            type: SidebarItemType.ProjectDetail,
          },
          {
            id: `project-${project.name}-cache`,
            label: `Cache (.next): ${cacheLabel}`,
            icon: cacheIcon,
            type: SidebarItemType.ProjectDetail,
          },
          {
            id: `project-${project.name}-action-restart`,
            label: 'Clean & Restart This Project',
            icon: 'sync',
            type: SidebarItemType.ProjectAction,
            command: {
              command: 'nextCleanRestart.cleanRestartProject',
              title: 'Clean & Restart This Project',
              arguments: [project],
            },
          },
          {
            id: `project-${project.name}-action-clean`,
            label: 'Clean Cache Only',
            icon: 'trash',
            type: SidebarItemType.ProjectAction,
            command: {
              command: 'nextCleanRestart.cleanOnlyProject',
              title: 'Clean Cache Only',
              arguments: [project],
            },
          },
        ];

        children.push({
          id: `project-${project.name}`,
          label: project.name,
          description: project.relativePath !== '.' ? project.relativePath : 'root',
          tooltip: `Path: ${project.uri.fsPath}\nPackage Manager: ${project.packageManager}`,
          icon: 'folder',
          type: SidebarItemType.Project,
          children: projectChildren,
        });
      }
    }

    return {
      id: 'category-projects',
      label: `Detected Projects (${this.projects.length})`,
      type: SidebarItemType.Category,
      icon: 'repo',
      children,
    };
  }

  private getSettingsCategory(): SidebarItem {
    return {
      id: 'category-settings',
      label: 'Configuration & Settings',
      type: SidebarItemType.Category,
      icon: 'settings-gear',
      children: [
        {
          id: 'setting-reuse-terminal',
          label: 'Reuse Running Terminal',
          description: this.config.reuseTerminal ? 'Enabled' : 'Disabled',
          tooltip: 'Click to toggle: Restart within the existing terminal instead of creating a new terminal tab.',
          icon: this.config.reuseTerminal ? 'check' : 'circle-slash',
          type: SidebarItemType.SettingToggle,
          settingKey: 'reuseTerminal',
          settingType: 'boolean',
          command: {
            command: 'nextCleanRestart.toggleSetting',
            title: 'Toggle Reuse Terminal',
            arguments: ['reuseTerminal', !this.config.reuseTerminal],
          },
        },
        {
          id: 'setting-dev-command',
          label: 'Dev Command',
          description: this.config.devCommand,
          tooltip: 'Click to edit: Custom command or "auto" to detect based on package manager.',
          icon: 'terminal',
          type: SidebarItemType.SettingEdit,
          settingKey: 'devCommand',
          settingType: 'string',
          command: {
            command: 'nextCleanRestart.editSetting',
            title: 'Edit Dev Command',
            arguments: ['devCommand', 'Custom Dev Command (or "auto")', this.config.devCommand],
          },
        },
        {
          id: 'setting-show-confirmation',
          label: 'Show Confirmation Prompt',
          description: this.config.showConfirmation ? 'Enabled' : 'Disabled',
          tooltip: 'Click to toggle: Ask for confirmation before clearing cache and restarting.',
          icon: this.config.showConfirmation ? 'check' : 'circle-slash',
          type: SidebarItemType.SettingToggle,
          settingKey: 'showConfirmation',
          settingType: 'boolean',
          command: {
            command: 'nextCleanRestart.toggleSetting',
            title: 'Toggle Confirmation Prompt',
            arguments: ['showConfirmation', !this.config.showConfirmation],
          },
        },
        {
          id: 'setting-terminal-name',
          label: 'Terminal Name',
          description: this.config.terminalName,
          tooltip: 'Click to edit: Name of the dedicated integrated terminal.',
          icon: 'tag',
          type: SidebarItemType.SettingEdit,
          settingKey: 'terminalName',
          settingType: 'string',
          command: {
            command: 'nextCleanRestart.editSetting',
            title: 'Edit Terminal Name',
            arguments: ['terminalName', 'Integrated Terminal Name', this.config.terminalName],
          },
        },
        {
          id: 'setting-status-bar',
          label: 'Status Bar Button',
          description: this.config.showStatusBarItem ? 'Visible' : 'Hidden',
          tooltip: 'Click to toggle: Show or hide the clean restart button on the bottom status bar.',
          icon: this.config.showStatusBarItem ? 'check' : 'circle-slash',
          type: SidebarItemType.SettingToggle,
          settingKey: 'showStatusBarItem',
          settingType: 'boolean',
          command: {
            command: 'nextCleanRestart.toggleSetting',
            title: 'Toggle Status Bar Item',
            arguments: ['showStatusBarItem', !this.config.showStatusBarItem],
          },
        },
        {
          id: 'setting-cache-directory',
          label: 'Cache Directory',
          description: this.config.cacheDirectory,
          tooltip: 'Click to edit: Relative path to Next.js cache directory (default: .next).',
          icon: 'folder',
          type: SidebarItemType.SettingEdit,
          settingKey: 'cacheDirectory',
          settingType: 'string',
          command: {
            command: 'nextCleanRestart.editSetting',
            title: 'Edit Cache Directory',
            arguments: ['cacheDirectory', 'Cache Directory Name/Path', this.config.cacheDirectory],
          },
        },
        {
          id: 'setting-retry-attempts',
          label: 'File Lock Retries',
          description: `${this.config.retryAttempts} attempts (${this.config.retryDelayMs}ms delay)`,
          tooltip: 'Click to edit: Number of retry attempts when deleting locked files.',
          icon: 'history',
          type: SidebarItemType.SettingEdit,
          settingKey: 'retryAttempts',
          settingType: 'number',
          command: {
            command: 'nextCleanRestart.editSetting',
            title: 'Edit Retry Attempts',
            arguments: ['retryAttempts', 'Number of retry attempts (e.g. 5)', String(this.config.retryAttempts), true],
          },
        },
        {
          id: 'setting-open-all',
          label: 'Open Extension Settings UI',
          tooltip: 'Open the full VS Code Settings editor filtered to Next.js Clean Restart.',
          icon: 'gear',
          type: SidebarItemType.OpenSettings,
          command: {
            command: 'nextCleanRestart.openSettings',
            title: 'Open Extension Settings UI',
          },
        },
      ],
    };
  }
}
