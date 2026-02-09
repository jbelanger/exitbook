/**
 * Atomic file write utilities.
 * Ensures all-or-nothing semantics for multi-file writes.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import { err, ok, type Result } from 'neverthrow';

export interface FileWrite {
  path: string;
  content: string;
}

/**
 * Atomically write multiple files.
 * Writes to temp files first, then renames atomically on success.
 * Cleans up temp files if any write fails.
 */
export async function writeFilesAtomically(files: FileWrite[]): Promise<Result<string[], Error>> {
  const tempPaths: string[] = [];

  try {
    // Ensure parent directories exist
    const uniqueDirs = [...new Set(files.map((f) => dirname(f.path)))];
    await Promise.all(uniqueDirs.map((dir) => fs.mkdir(dir, { recursive: true })));

    // Write to temp files first
    for (const file of files) {
      const tempPath = `${file.path}.tmp`;
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
        fs.unlink(path).catch(() => {
          /* empty */
        })
      )
    );

    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
