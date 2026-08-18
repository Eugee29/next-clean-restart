import * as vscode from 'vscode';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface NextProjectInfo {
  name: string;
  uri: vscode.Uri;
  packageJsonUri?: vscode.Uri;
  configUri?: vscode.Uri;
  packageManager: PackageManager;
  devScriptName: string;
  cacheUri: vscode.Uri;
  relativePath: string;
}

export interface ExtensionConfig {
  devCommand: string;
  showConfirmation: boolean;
  terminalName: string;
  showStatusBarItem: boolean;
  cacheDirectory: string;
  retryAttempts: number;
  retryDelayMs: number;
  focusTerminalOnStart: boolean;
  reuseTerminal: boolean;
}

export type ExecutionMode = 'cleanAndRestart' | 'cleanOnly' | 'restartOnly';

export interface CleanRestartResult {
  success: boolean;
  project?: NextProjectInfo;
  devCommand?: string;
  deletedCache: boolean;
  restartedServer: boolean;
  error?: string;
}
