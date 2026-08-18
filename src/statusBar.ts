import * as vscode from 'vscode';
import { NextProjectInfo } from './types';

export class StatusBarController implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private isVisible = false;
  private currentProjects: NextProjectInfo[] = [];

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      'nextCleanRestart.statusBarItem',
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.name = 'Next.js Clean Restart';
    this.statusBarItem.command = 'nextCleanRestart.cleanRestart';
  }

  public get detectedProjects(): NextProjectInfo[] {
    return this.currentProjects;
  }

  /**
   * Updates the status bar visibility and contents based on detected projects and configuration.
   */
  public update(projects: NextProjectInfo[], isEnabledInConfig: boolean): void {
    this.currentProjects = projects;

    if (!isEnabledInConfig || projects.length === 0) {
      this.hide();
      return;
    }

    if (projects.length === 1) {
      const p = projects[0];
      this.statusBarItem.text = `$(sync) Clean & Restart Next.js`;
      this.statusBarItem.tooltip = new vscode.MarkdownString(
        `**Next.js Clean Restart**\n\n` +
        `- **Project**: \`${p.name}\`\n` +
        `- **Package Manager**: \`${p.packageManager}\`\n` +
        `- **Dev Script**: \`${p.devScriptName}\`\n\n` +
        `Click to delete \`.next\` directory and restart dev server.`
      );
    } else {
      this.statusBarItem.text = `$(sync) Clean & Restart Next.js (${projects.length})`;
      const listMd = projects
        .map((p) => `- \`${p.name}\` (${p.relativePath})`)
        .join('\n');
      this.statusBarItem.tooltip = new vscode.MarkdownString(
        `**Next.js Clean Restart (${projects.length} projects detected)**\n\n` +
        `${listMd}\n\n` +
        `Click to select a project, wipe its \`.next\` cache, and restart its dev server.`
      );
    }

    this.show();
  }

  public show(): void {
    if (!this.isVisible) {
      this.statusBarItem.show();
      this.isVisible = true;
    }
  }

  public hide(): void {
    if (this.isVisible) {
      this.statusBarItem.hide();
      this.isVisible = false;
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
