import { existsSync } from 'node:fs';
import path from 'node:path';

import { getLogger } from '@exitbook/logger';

const logger = getLogger('data-dir');
const EXITBOOK_WORKSPACE_MARKER = 'pnpm-workspace.yaml';
const EXITBOOK_CLI_PACKAGE_PATH = 'apps/cli/package.json';
const EXITBOOK_CLI_DATA_DIR = 'apps/cli/data';

type PathExists = (path: string) => boolean;

interface WrapDataDirCompatibilityErrorParams {
  configuredDataDir?: string | undefined;
  cwd?: string | undefined;
  dataDir: string;
  databasePath: string;
  pathExists?: PathExists | undefined;
}

export function findExitbookWorkspaceRoot(startDir: string, pathExists: PathExists = existsSync): string | undefined {
  let currentDir = path.resolve(startDir);

  for (;;) {
    const workspaceMarkerPath = path.join(currentDir, EXITBOOK_WORKSPACE_MARKER);
    const cliPackagePath = path.join(currentDir, EXITBOOK_CLI_PACKAGE_PATH);
    if (pathExists(workspaceMarkerPath) && pathExists(cliPackagePath)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

export function resolveDefaultDataDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'data');
}

function isLikelySchemaMismatchError(message: string): boolean {
  return message.includes('no such column:') || message.includes('no such table:');
}

export function wrapDataDirCompatibilityError(error: Error, params: WrapDataDirCompatibilityErrorParams): Error {
  if (!isLikelySchemaMismatchError(error.message) || error.message.startsWith('Selected data directory "')) {
    return error;
  }

  const cwd = params.cwd ?? process.cwd();
  const absoluteDataDir = path.resolve(params.dataDir);
  const absoluteDatabasePath = path.resolve(params.databasePath);
  const pathExists = params.pathExists ?? existsSync;
  const guidance: string[] = [
    `Selected data directory "${absoluteDataDir}" is incompatible with this Exitbook build.`,
    `Database: "${absoluteDatabasePath}".`,
    `SQLite reported: ${error.message}.`,
  ];

  if (params.configuredDataDir !== undefined) {
    guidance.push('It came from EXITBOOK_DATA_DIR. Point that variable at a current data directory and rerun.');
  } else {
    const workspaceRoot = findExitbookWorkspaceRoot(cwd, pathExists);
    if (workspaceRoot !== undefined) {
      const repoCliDataDir = path.join(workspaceRoot, EXITBOOK_CLI_DATA_DIR);
      if (pathExists(repoCliDataDir) && path.resolve(repoCliDataDir) !== absoluteDataDir) {
        guidance.push(`If you meant to use this repo's app dataset, rerun with EXITBOOK_DATA_DIR=${repoCliDataDir}.`);
      }
    }
  }

  return new Error(guidance.join(' '), { cause: error });
}

/**
 * Resolve the data directory for persistent files (databases, overrides).
 *
 * Priority:
 * 1. EXITBOOK_DATA_DIR environment variable (if set)
 * 2. process.cwd() + '/data' (default)
 */
export function getDataDir(): string {
  const configured = process.env['EXITBOOK_DATA_DIR'];
  const defaultDir = resolveDefaultDataDir();

  if (configured === undefined) return defaultDir;

  const trimmed = configured.trim();
  if (trimmed.length === 0) {
    logger.warn('EXITBOOK_DATA_DIR is empty; falling back to default data directory');
    return defaultDir;
  }

  return trimmed;
}
