import * as path from 'path';

// Mock vscode module for standalone unit testing
export const mockVscode = {
  Uri: {
    file: (filePath: string) => ({
      scheme: 'file',
      fsPath: path.resolve(filePath),
      path: path.resolve(filePath).replace(/\\/g, '/'),
      toString: () => `file://${path.resolve(filePath)}`,
    }),
  },
  workspace: {
    workspaceFolders: [],
    getWorkspaceFolder: (_uri: any) => undefined,
    findFiles: async (_include: string, _exclude?: string) => [],
    fs: {
      delete: async () => {},
    },
  },
  window: {
    terminals: [],
    createTerminal: () => ({
      name: 'mock',
      show: () => {},
      sendText: () => {},
      dispose: () => {},
    }),
    showQuickPick: async () => undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    withProgress: async (_opts: any, task: any) => task({ report: () => {} }),
  },
  ProgressLocation: {
    Notification: 15,
  },
  MarkdownString: class {
    value: string;
    constructor(val = '') {
      this.value = val;
    }
  },
};
