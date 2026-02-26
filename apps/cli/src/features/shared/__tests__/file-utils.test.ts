/**
 * Tests for atomic file write utilities
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tmp from 'tmp';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeFilesAtomically } from '../file-utils.js';

describe('writeFilesAtomically', () => {
  let testDir: string;

  beforeEach(async () => {
    // Use a securely created temporary directory for tests
    testDir = tmp.dirSync({ unsafeCleanup: true }).name;
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('writes multiple files atomically', async () => {
    const files = [
      { path: join(testDir, 'file1.txt'), content: 'content 1' },
      { path: join(testDir, 'file2.txt'), content: 'content 2' },
      { path: join(testDir, 'file3.txt'), content: 'content 3' },
    ];

    const result = await writeFilesAtomically(files);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([
      join(testDir, 'file1.txt'),
      join(testDir, 'file2.txt'),
      join(testDir, 'file3.txt'),
    ]);

    // Verify files exist with correct content
    expect(await fs.readFile(join(testDir, 'file1.txt'), 'utf8')).toBe('content 1');
    expect(await fs.readFile(join(testDir, 'file2.txt'), 'utf8')).toBe('content 2');
    expect(await fs.readFile(join(testDir, 'file3.txt'), 'utf8')).toBe('content 3');

    // Verify no temp files remain
    const dirContents = await fs.readdir(testDir);
    expect(dirContents).toEqual(['file1.txt', 'file2.txt', 'file3.txt']);
  });

  it('creates parent directories if needed', async () => {
    const nestedPath = join(testDir, 'nested', 'deep', 'file.txt');
    const files = [{ path: nestedPath, content: 'nested content' }];

    const result = await writeFilesAtomically(files);
    expect(result.isOk()).toBe(true);

    expect(await fs.readFile(nestedPath, 'utf8')).toBe('nested content');
  });

  it('returns error on write failure', async () => {
    // Simulate a write error by using an invalid path
    const files = [{ path: '/dev/null/invalid/path/file.txt', content: 'will fail' }];

    const result = await writeFilesAtomically(files);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toMatch(/ENOTDIR|EACCES|EPERM/);
  });

  it('handles single file write', async () => {
    const files = [{ path: join(testDir, 'single.txt'), content: 'single file' }];

    const result = await writeFilesAtomically(files);
    expect(result.isOk()).toBe(true);
    expect(await fs.readFile(join(testDir, 'single.txt'), 'utf8')).toBe('single file');
  });

  it('overwrites existing files', async () => {
    const filePath = join(testDir, 'overwrite.txt');
    await fs.writeFile(filePath, 'old content');

    const files = [{ path: filePath, content: 'new content' }];
    const result = await writeFilesAtomically(files);

    expect(result.isOk()).toBe(true);
    expect(await fs.readFile(filePath, 'utf8')).toBe('new content');
  });
});
