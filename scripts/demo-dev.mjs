import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const demoRoot = resolve(repoRoot, 'demo');

const rootTscCli = resolve(repoRoot, 'node_modules/typescript/bin/tsc');
const rootViteCli = resolve(repoRoot, 'node_modules/vite/bin/vite.js');
const demoViteCli = resolve(demoRoot, 'node_modules/vite/bin/vite.js');
const demoCheckScript = resolve(demoRoot, 'scripts/check-sdk-dist.mjs');

const childProcesses = new Set();

let shuttingDown = false;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  await ensureDependenciesExist();

  console.log('Building SDK before starting the demo...');
  await runNodeCli(repoRoot, rootTscCli, []);
  await runNodeCli(repoRoot, rootViteCli, ['build']);

  console.log('Checking demo prerequisites...');
  await runNodeCli(demoRoot, demoCheckScript, []);

  console.log('Starting SDK watcher and demo dev server...');
  const sdkWatcher = startManagedProcess(repoRoot, rootViteCli, ['build', '--watch']);
  const hostArg = process.argv.find((arg) => arg === '--host' || arg.startsWith('--host='));
  const viteArgs = hostArg ? [hostArg] : [];
  const demoServer = startManagedProcess(demoRoot, demoViteCli, viteArgs);

  registerShutdownHandlers();
  await Promise.race([
    waitForManagedProcess(sdkWatcher, 'SDK watcher'),
    waitForManagedProcess(demoServer, 'Demo server'),
  ]);
}

async function ensureDependenciesExist() {
  await assertExists(rootTscCli, 'Root dependencies are missing. Run `npm install` at the repository root.');
  await assertExists(rootViteCli, 'Root dependencies are missing. Run `npm install` at the repository root.');
  await assertExists(demoViteCli, 'Demo dependencies are missing. Run `npm install` inside `demo/`.');
  await assertExists(demoCheckScript, 'The demo prerequisite checker is missing.');
}

async function assertExists(path, message) {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

function runNodeCli(cwd, scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(formatExitMessage(scriptPath, code, signal)));
    });
  });
}

function startManagedProcess(cwd, scriptPath, args) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd,
    stdio: 'inherit',
  });

  childProcesses.add(child);
  child.on('exit', () => {
    childProcesses.delete(child);
  });

  return { child, scriptPath };
}

function waitForManagedProcess(processHandle, name) {
  return new Promise((resolve, reject) => {
    processHandle.child.on('error', reject);
    processHandle.child.on('exit', (code, signal) => {
      if (shuttingDown) {
        resolve();
        return;
      }

      shuttingDown = true;
      stopAllChildren();

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(formatExitMessage(name, code, signal)));
    });
  });
}

function registerShutdownHandlers() {
  for (const eventName of ['SIGINT', 'SIGTERM']) {
    process.on(eventName, () => {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      stopAllChildren();
      process.exit(0);
    });
  }
}

function stopAllChildren() {
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
}

function formatExitMessage(name, code, signal) {
  if (signal) {
    return `${name} exited due to signal ${signal}.`;
  }

  return `${name} exited with code ${code ?? 'unknown'}.`;
}
