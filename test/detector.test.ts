import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { mockVscode } from './mockVscode';

// Hook require for 'vscode' before importing modules
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === 'vscode') {
    return mockVscode;
  }
  // eslint-disable-next-line prefer-rest-params
  return originalRequire.apply(this, arguments);
};

// Now import after hook
import {
  detectPackageManager,
  resolveDevCommand,
  isNextProjectDirectory,
} from '../src/detector';
import { NextProjectInfo } from '../src/types';

async function runTests() {
  console.log('Starting Next.js Clean Restart Unit Tests...\n');
  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-clean-restart-test-'));

  try {
    // ----------------------------------------------------
    // Test 1: resolveDevCommand tests
    // ----------------------------------------------------
    console.log('Test 1: resolveDevCommand resolution');

    const mockProject = (pm: 'npm' | 'pnpm' | 'yarn' | 'bun', script = 'dev'): NextProjectInfo => ({
      name: 'test-app',
      uri: mockVscode.Uri.file('/mock/test-app') as any,
      packageManager: pm,
      devScriptName: script,
      cacheUri: mockVscode.Uri.file('/mock/test-app/.next') as any,
      relativePath: '.',
    });

    // Auto command checks
    assert.strictEqual(resolveDevCommand(mockProject('pnpm', 'dev'), 'auto'), 'pnpm dev');
    assert.strictEqual(resolveDevCommand(mockProject('yarn', 'dev'), 'auto'), 'yarn dev');
    assert.strictEqual(resolveDevCommand(mockProject('bun', 'dev'), 'auto'), 'bun dev');
    assert.strictEqual(resolveDevCommand(mockProject('npm', 'dev'), 'auto'), 'npm run dev');

    // Custom script name checks
    assert.strictEqual(resolveDevCommand(mockProject('pnpm', 'dev:custom'), 'auto'), 'pnpm run dev:custom');
    assert.strictEqual(resolveDevCommand(mockProject('yarn', 'dev:custom'), 'auto'), 'yarn dev:custom');
    assert.strictEqual(resolveDevCommand(mockProject('bun', 'dev:custom'), 'auto'), 'bun run dev:custom');
    assert.strictEqual(resolveDevCommand(mockProject('npm', 'dev:custom'), 'auto'), 'npm run dev:custom');

    // Custom devCommand override
    assert.strictEqual(
      resolveDevCommand(mockProject('npm', 'dev'), 'pnpm run dev --turbo'),
      'pnpm run dev --turbo'
    );
    console.log('  [PASS] resolveDevCommand passed for npm, pnpm, yarn, bun and custom scripts');

    // ----------------------------------------------------
    // Test 2: detectPackageManager lockfile tests
    // ----------------------------------------------------
    console.log('\nTest 2: detectPackageManager lockfile detection');

    const pnpmDir = path.join(tempBaseDir, 'pnpm-app');
    fs.mkdirSync(pnpmDir, { recursive: true });
    fs.writeFileSync(path.join(pnpmDir, 'pnpm-lock.yaml'), '');
    const pnpmDetected = await detectPackageManager(mockVscode.Uri.file(pnpmDir) as any);
    assert.strictEqual(pnpmDetected, 'pnpm');
    console.log('  [PASS] Detected pnpm from pnpm-lock.yaml');

    const yarnDir = path.join(tempBaseDir, 'yarn-app');
    fs.mkdirSync(yarnDir, { recursive: true });
    fs.writeFileSync(path.join(yarnDir, 'yarn.lock'), '');
    const yarnDetected = await detectPackageManager(mockVscode.Uri.file(yarnDir) as any);
    assert.strictEqual(yarnDetected, 'yarn');
    console.log('  [PASS] Detected yarn from yarn.lock');

    const bunDir = path.join(tempBaseDir, 'bun-app');
    fs.mkdirSync(bunDir, { recursive: true });
    fs.writeFileSync(path.join(bunDir, 'bun.lockb'), '');
    const bunDetected = await detectPackageManager(mockVscode.Uri.file(bunDir) as any);
    assert.strictEqual(bunDetected, 'bun');
    console.log('  [PASS] Detected bun from bun.lockb');

    const npmDir = path.join(tempBaseDir, 'npm-app');
    fs.mkdirSync(npmDir, { recursive: true });
    fs.writeFileSync(path.join(npmDir, 'package-lock.json'), '{}');
    const npmDetected = await detectPackageManager(mockVscode.Uri.file(npmDir) as any);
    assert.strictEqual(npmDetected, 'npm');
    console.log('  [PASS] Detected npm from package-lock.json');

    // ----------------------------------------------------
    // Test 3: Monorepo nested lockfile traversal
    // ----------------------------------------------------
    console.log('\nTest 3: Monorepo nested lockfile traversal');
    const monorepoRoot = path.join(tempBaseDir, 'monorepo');
    const monorepoApp = path.join(monorepoRoot, 'apps', 'web');
    fs.mkdirSync(monorepoApp, { recursive: true });
    fs.writeFileSync(path.join(monorepoRoot, 'pnpm-lock.yaml'), '');
    const monorepoDetected = await detectPackageManager(mockVscode.Uri.file(monorepoApp) as any);
    assert.strictEqual(monorepoDetected, 'pnpm');
    console.log('  [PASS] Correctly walked up directory tree to detect pnpm in monorepo root');

    // ----------------------------------------------------
    // Test 4: isNextProjectDirectory project identification
    // ----------------------------------------------------
    console.log('\nTest 4: isNextProjectDirectory project identification');

    // 4a. Next.js app with package.json next dependency
    const nextAppDir = path.join(tempBaseDir, 'next-app');
    fs.mkdirSync(nextAppDir, { recursive: true });
    fs.writeFileSync(
      path.join(nextAppDir, 'package.json'),
      JSON.stringify({
        name: 'my-next-app',
        dependencies: { next: '^14.1.0', react: '^18.2.0' },
        scripts: { dev: 'next dev' },
      })
    );
    const nextAppInfo = await isNextProjectDirectory(mockVscode.Uri.file(nextAppDir) as any);
    assert.ok(nextAppInfo !== null, 'Should detect Next.js project');
    assert.strictEqual(nextAppInfo?.name, 'my-next-app');
    assert.strictEqual(nextAppInfo?.devScriptName, 'dev');
    console.log('  [PASS] Detected Next.js app via package.json dependencies');

    // 4b. Next.js app with next.config.ts
    const configAppDir = path.join(tempBaseDir, 'config-app');
    fs.mkdirSync(configAppDir, { recursive: true });
    fs.writeFileSync(path.join(configAppDir, 'next.config.ts'), 'export default {};');
    const configAppInfo = await isNextProjectDirectory(mockVscode.Uri.file(configAppDir) as any);
    assert.ok(configAppInfo !== null, 'Should detect Next.js project via next.config.ts');
    console.log('  [PASS] Detected Next.js app via next.config.ts');

    // 4c. Non-Next.js project
    const nonNextDir = path.join(tempBaseDir, 'regular-node-app');
    fs.mkdirSync(nonNextDir, { recursive: true });
    fs.writeFileSync(
      path.join(nonNextDir, 'package.json'),
      JSON.stringify({
        name: 'express-api',
        dependencies: { express: '^4.18.0' },
      })
    );
    const nonNextInfo = await isNextProjectDirectory(mockVscode.Uri.file(nonNextDir) as any);
    assert.strictEqual(nonNextInfo, null, 'Should not detect non-Next.js project');
    console.log('  [PASS] Non-Next.js projects are properly ignored');

    console.log('\nAll unit tests completed successfully!');
  } finally {
    // Cleanup temporary files
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}

runTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
