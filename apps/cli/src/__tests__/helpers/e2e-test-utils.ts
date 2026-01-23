import { execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CLIResponse } from '../../features/shared/cli-response.js';

/**
 * Paths for e2e testing
 */
export function getTestPaths() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, '../../../../..');
  const cliDir = path.join(repoRoot, 'apps/cli');
  const samplesDir = path.join(cliDir, 'samples');
  const testDataDir = path.join(cliDir, 'data/tests');

  return {
    __dirname,
    repoRoot,
    cliDir,
    samplesDir,
    testDataDir,
  };
}

/**
 * Check if the environment allows creating a Unix domain socket (tsx IPC needs this).
 */
export async function canBindUnixSocket(): Promise<boolean> {
  return await new Promise((resolve) => {
    const { testDataDir } = getTestPaths();
    const socketPath = path.join(testDataDir, `probe-${Date.now()}.sock`);
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen(socketPath, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Escape a shell argument by wrapping it in single quotes and escaping any single quotes
 */
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Execute a CLI command and parse JSON output
 */
export function executeCLI(args: string[]): CLIResponse<unknown> {
  const { repoRoot, testDataDir } = getTestPaths();
  const escapedArgs = args.map(escapeShellArg).join(' ');
  const command = `pnpm -s run dev ${escapedArgs} --json`;

  try {
    const stdout = execSync(command, {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        EXITBOOK_DATA_DIR: testDataDir,
        // Force tmpdir into repo workspace to avoid sandbox IPC permission issues
        TMPDIR: testDataDir,
      },
    });

    const trimmed = stdout.trim();

    if (!trimmed) {
      throw new Error('No output from CLI command');
    }

    return JSON.parse(trimmed) as CLIResponse<unknown>;
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      const stdout = (error as { stdout: Buffer }).stdout?.toString() ?? '';
      const trimmed = stdout.trim();

      if (trimmed) {
        try {
          return JSON.parse(trimmed) as CLIResponse<unknown>;
        } catch {
          // Not JSON, re-throw original error
        }
      }
    }
    throw error;
  }
}

/**
 * Clean up test database before tests
 */
export function cleanupTestDatabase(): void {
  const { testDataDir } = getTestPaths();
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDataDir, { recursive: true });
}

/**
 * Check if sample data exists for a given source
 */
export function hasSampleData(sourceName: string): boolean {
  const { samplesDir } = getTestPaths();
  const sourceDir = path.join(samplesDir, sourceName);
  return fs.existsSync(sourceDir) && fs.readdirSync(sourceDir).length > 0;
}

/**
 * Get sample directory for a source
 */
export function getSampleDir(sourceName: string): string {
  const { samplesDir } = getTestPaths();
  return path.join(samplesDir, sourceName);
}
