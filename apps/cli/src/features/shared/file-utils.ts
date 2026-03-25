/**
 * Temp-file write helpers for export commands.
 * Each destination file is written via an atomic rename, but a multi-file batch can still partially commit.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import { ok, randomHex, wrapError, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

const logger = getLogger('file-utils');

interface FileWrite {
  path: string;
  content: string;
}

/**
 * Write multiple files by staging temp files and renaming each destination atomically.
 * This guarantees per-file atomic replacement, not batch-level rollback across all outputs.
 */
export async function writeFilesWithAtomicRenames(files: FileWrite[]): Promise<Result<string[], Error>> {
  const tempPaths: string[] = [];

  try {
    // Ensure parent directories exist
    const uniqueDirs = [...new Set(files.map((f) => dirname(f.path)))];
    await Promise.all(uniqueDirs.map((dir) => fs.mkdir(dir, { recursive: true })));

    // Write to temp files first
    for (const file of files) {
      const tempPath = `${file.path}.${randomHex(6)}.tmp`;
      tempPaths.push(tempPath);
      await fs.writeFile(tempPath, file.content, 'utf8');
    }

    // Atomically rename all temp files to final paths
    await Promise.all(
      files.map((file, i) => {
        const tempPath = tempPaths[i];
        if (!tempPath) throw new Error('Missing temp path');
        return fs.rename(tempPath, file.path);
      })
    );

    return ok(files.map((f) => f.path));
  } catch (error) {
    // Clean up temp files on failure
    await Promise.allSettled(
      tempPaths.map((path) =>
        fs.unlink(path).catch((unlinkError: unknown) => {
          logger.warn({ path, error: unlinkError }, 'Failed to clean up temp file after write failure');
        })
      )
    );

    return wrapError(error, 'Failed to write file');
  }
}
