import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { assertOk } from '@exitbook/core/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { TaxPackageDirectoryWriter } from './cost-basis-export.js';

describe('TaxPackageDirectoryWriter', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.allSettled(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('removes stale managed files when a later export shrinks the package', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'exitbook-tax-package-'));
    tempDirs.push(outputDir);

    const writer = new TaxPackageDirectoryWriter(outputDir);

    assertOk(
      await writer.writeAll([
        buildFile('manifest.json', '{"artifactIndex": []}\n'),
        buildFile('report.md', '# report\n'),
        buildFile('dispositions.csv', 'disposition_ref\nDISP-0001\n'),
      ])
    );

    assertOk(
      await writer.writeAll([
        buildFile('manifest.json', '{"artifactIndex": []}\n'),
        buildFile('report.md', '# blocked report\n'),
        buildFile('issues.csv', 'issue_ref\nISSUE-0001\n'),
      ])
    );

    await expect(readFile(path.join(outputDir, 'issues.csv'), 'utf8')).resolves.toContain('ISSUE-0001');
    await expect(readFile(path.join(outputDir, 'dispositions.csv'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function buildFile(relativePath: string, content: string) {
  return {
    logicalName: relativePath.replace(/\.[^.]+$/, ''),
    relativePath,
    mediaType: relativePath.endsWith('.md') ? 'text/markdown' : 'text/csv',
    purpose: 'test',
    content,
  };
}
