import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { NextProjectInfo, PackageManager } from './types';

/**
 * Checks if a directory contains a Next.js project by inspecting package.json and config files.
 */
export async function isNextProjectDirectory(
  dirUri: vscode.Uri,
  cacheDirName = '.next'
): Promise<NextProjectInfo | null> {
  const dirPath = dirUri.fsPath;

  // Check for next.config.* files
  const configExtensions = ['js', 'mjs', 'ts', 'cjs'];
  let foundConfigUri: vscode.Uri | undefined;

  for (const ext of configExtensions) {
    const configPath = path.join(dirPath, `next.config.${ext}`);
    if (fs.existsSync(configPath)) {
      foundConfigUri = vscode.Uri.file(configPath);
      break;
    }
  }

  // Check package.json
  const pkgPath = path.join(dirPath, 'package.json');
  let hasNextDependency = false;
  let devScriptName = 'dev';
  let projectName = path.basename(dirPath);
  let foundPkgUri: vscode.Uri | undefined;

  if (fs.existsSync(pkgPath)) {
    foundPkgUri = vscode.Uri.file(pkgPath);
    try {
      const content = await fs.promises.readFile(pkgPath, 'utf8');
      const pkgJson = JSON.parse(content);

      if (pkgJson.name && typeof pkgJson.name === 'string') {
        projectName = pkgJson.name;
      }

      const deps = pkgJson.dependencies || {};
      const devDeps = pkgJson.devDependencies || {};
      const peerDeps = pkgJson.peerDependencies || {};

      if (deps.next || devDeps.next || peerDeps.next) {
        hasNextDependency = true;
      }

      if (pkgJson.scripts) {
        if (pkgJson.scripts.dev) {
          devScriptName = 'dev';
        } else if (pkgJson.scripts['dev:next']) {
          devScriptName = 'dev:next';
        } else if (pkgJson.scripts.start) {
          devScriptName = 'start';
        }
      }
    } catch {
      // Ignore JSON parse errors and continue
    }
  }

  // If neither config nor dependency is found, it is not a Next.js project
  if (!foundConfigUri && !hasNextDependency) {
    return null;
  }

  const packageManager = await detectPackageManager(dirUri);
  const cacheUri = vscode.Uri.file(path.join(dirPath, cacheDirName));

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(dirUri);
  const relativePath = workspaceFolder
    ? path.relative(workspaceFolder.uri.fsPath, dirPath) || '.'
    : path.basename(dirPath);

  return {
    name: projectName,
    uri: dirUri,
    packageJsonUri: foundPkgUri,
    configUri: foundConfigUri,
    packageManager,
    devScriptName,
    cacheUri,
    relativePath,
  };
}

/**
 * Detects the package manager (pnpm, yarn, bun, npm) by searching for lockfiles
 * in the project folder and walking up to the workspace root / repository root.
 */
export async function detectPackageManager(dirUri: vscode.Uri): Promise<PackageManager> {
  let currentDir = dirUri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(dirUri);
  const rootBoundary = workspaceFolder ? workspaceFolder.uri.fsPath : path.parse(currentDir).root;

  while (true) {
    // 1. pnpm
    if (fs.existsSync(path.join(currentDir, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }
    // 2. yarn
    if (fs.existsSync(path.join(currentDir, 'yarn.lock'))) {
      return 'yarn';
    }
    // 3. bun
    if (
      fs.existsSync(path.join(currentDir, 'bun.lockb')) ||
      fs.existsSync(path.join(currentDir, 'bun.lock'))
    ) {
      return 'bun';
    }
    // 4. npm
    if (fs.existsSync(path.join(currentDir, 'package-lock.json'))) {
      return 'npm';
    }

    if (currentDir === rootBoundary || path.dirname(currentDir) === currentDir) {
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  return 'npm';
}

/**
 * Resolves the CLI development command to run.
 */
export function resolveDevCommand(
  project: NextProjectInfo,
  configuredDevCommand?: string
): string {
  if (configuredDevCommand && configuredDevCommand.trim() !== '' && configuredDevCommand !== 'auto') {
    return configuredDevCommand.trim();
  }

  const script = project.devScriptName || 'dev';
  switch (project.packageManager) {
    case 'pnpm':
      return script === 'dev' ? 'pnpm dev' : `pnpm run ${script}`;
    case 'yarn':
      return script === 'dev' ? 'yarn dev' : `yarn ${script}`;
    case 'bun':
      return script === 'dev' ? 'bun dev' : `bun run ${script}`;
    case 'npm':
    default:
      return `npm run ${script}`;
  }
}

/**
 * Scans all workspace folders to find all Next.js projects (including monorepos).
 */
export async function findAllNextProjects(
  cacheDirName = '.next'
): Promise<NextProjectInfo[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return [];
  }

  const results: NextProjectInfo[] = [];
  const processedDirs = new Set<string>();

  // Check top-level workspace folders first
  for (const folder of workspaceFolders) {
    const project = await isNextProjectDirectory(folder.uri, cacheDirName);
    if (project) {
      results.push(project);
      processedDirs.add(folder.uri.fsPath);
    }
  }

  // Find any package.json or next.config.* in subdirectories (e.g. monorepo apps)
  try {
    const configMatches = await vscode.workspace.findFiles(
      '**/next.config.{js,mjs,ts,cjs}',
      '**/node_modules/**'
    );

    for (const match of configMatches) {
      const dirUri = vscode.Uri.file(path.dirname(match.fsPath));
      if (!processedDirs.has(dirUri.fsPath)) {
        const project = await isNextProjectDirectory(dirUri, cacheDirName);
        if (project) {
          results.push(project);
          processedDirs.add(dirUri.fsPath);
        }
      }
    }

    const pkgMatches = await vscode.workspace.findFiles(
      '**/package.json',
      '**/node_modules/**'
    );

    for (const match of pkgMatches) {
      const dirUri = vscode.Uri.file(path.dirname(match.fsPath));
      if (!processedDirs.has(dirUri.fsPath)) {
        const project = await isNextProjectDirectory(dirUri, cacheDirName);
        if (project) {
          results.push(project);
          processedDirs.add(dirUri.fsPath);
        }
      }
    }
  } catch {
    // If findFiles fails (e.g. non-VS Code environment), fallback to root check
  }

  return results;
}

/**
 * Resolves which Next.js project to target.
 * If there are multiple projects, checks if the active editor is inside one,
 * or prompts the user with a QuickPick.
 */
export async function resolveTargetProject(
  projects: NextProjectInfo[],
  activeFileUri?: vscode.Uri
): Promise<NextProjectInfo | null> {
  if (projects.length === 0) {
    return null;
  }

  if (projects.length === 1) {
    return projects[0];
  }

  // If active file is inside one of the projects, prioritize that project
  if (activeFileUri) {
    const activePath = activeFileUri.fsPath.toLowerCase();
    // Sort projects by longest path first to match deepest nested project in monorepos
    const sortedProjects = [...projects].sort(
      (a, b) => b.uri.fsPath.length - a.uri.fsPath.length
    );

    for (const proj of sortedProjects) {
      const projPath = proj.uri.fsPath.toLowerCase();
      if (activePath.startsWith(projPath)) {
        return proj;
      }
    }
  }

  // Prompt the user to pick a project
  const items = projects.map((p) => ({
    label: `$(folder) ${p.name}`,
    description: p.relativePath !== '.' ? p.relativePath : p.uri.fsPath,
    detail: `Package Manager: ${p.packageManager} | Script: ${p.devScriptName}`,
    project: p,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select the Next.js project to clean & restart',
    title: 'Multiple Next.js Projects Detected',
  });

  return selected ? selected.project : null;
}
