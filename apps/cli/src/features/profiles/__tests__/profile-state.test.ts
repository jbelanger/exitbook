import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getCliStatePath, readCliStateFile, resolveCliProfileSelection, writeCliStateFile } from '../profile-state.js';

describe('profile-state', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    delete process.env['EXITBOOK_PROFILE'];

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  function createTempDir(): string {
    const dir = mkdtempSync(path.join(process.cwd(), 'tmp-profile-state-'));
    tempDirs.push(dir);
    return dir;
  }

  it('falls back to the default profile when no env var or state file exists', () => {
    const dataDir = createTempDir();

    const result = resolveCliProfileSelection(dataDir);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    expect(result.value).toEqual({ name: 'default', source: 'default' });
  });

  it('uses EXITBOOK_PROFILE before shared state', () => {
    const dataDir = createTempDir();
    writeFileSync(getCliStatePath(dataDir), JSON.stringify({ activeProfileName: 'state-profile' }), 'utf8');
    process.env['EXITBOOK_PROFILE'] = ' Env-Profile ';

    const result = resolveCliProfileSelection(dataDir);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    expect(result.value).toEqual({ name: 'env-profile', source: 'env' });
  });

  it('writes and rereads normalized shared profile state', () => {
    const dataDir = createTempDir();

    const writeResult = writeCliStateFile(dataDir, ' Son ');
    expect(writeResult.isOk()).toBe(true);

    const readResult = readCliStateFile(dataDir);
    expect(readResult.isOk()).toBe(true);
    if (!readResult.isOk()) {
      return;
    }

    expect(readResult.value).toEqual({ activeProfileName: 'son' });

    const selectionResult = resolveCliProfileSelection(dataDir);
    expect(selectionResult.isOk()).toBe(true);
    if (!selectionResult.isOk()) {
      return;
    }

    expect(selectionResult.value).toEqual({ name: 'son', source: 'state' });
  });
});
