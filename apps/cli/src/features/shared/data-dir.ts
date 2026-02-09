import path from 'node:path';

import { getLogger } from '@exitbook/logger';

const logger = getLogger('data-dir');

/**
 * Resolve the data directory for persistent files (databases, overrides).
 *
 * Priority:
 * 1. EXITBOOK_DATA_DIR environment variable (if set)
 * 2. process.cwd() + '/data' (default)
 */
export function getDataDir(): string {
  const configured = process.env['EXITBOOK_DATA_DIR'];
  const defaultDir = path.join(process.cwd(), 'data');

  if (configured === undefined) return defaultDir;

  const trimmed = configured.trim();
  if (trimmed.length === 0) {
    logger.warn('EXITBOOK_DATA_DIR is empty; falling back to default data directory');
    return defaultDir;
  }

  return trimmed;
}
