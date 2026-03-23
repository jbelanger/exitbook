import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { TaxPackageManifest } from '@exitbook/accounting';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildTaxPackageStatusSummaryLines,
  resolveCostBasisExportOutputDir,
  TaxPackageDirectoryWriter,
} from './cost-basis-export.js';

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

describe('resolveCostBasisExportOutputDir', () => {
  it('prefers the original shell cwd when pnpm sets INIT_CWD', () => {
    expect(
      resolveCostBasisExportOutputDir(
        './',
        'reports/2024-ca-tax-package',
        { INIT_CWD: '/workspace/root' },
        '/workspace/root/apps/cli'
      )
    ).toBe('/workspace/root');
  });

  it('falls back to process cwd when INIT_CWD is unavailable', () => {
    expect(
      resolveCostBasisExportOutputDir(undefined, 'reports/2024-ca-tax-package', {}, '/workspace/root/apps/cli')
    ).toBe('/workspace/root/apps/cli/reports/2024-ca-tax-package');
  });
});

describe('buildTaxPackageStatusSummaryLines', () => {
  it('renders blocking issue details and recommended action', () => {
    expect(
      buildTaxPackageStatusSummaryLines(
        {
          status: 'blocked',
          manifest: {
            blockingIssues: [
              {
                code: 'UNKNOWN_TRANSACTION_CLASSIFICATION',
                severity: 'blocked',
                summary: 'Some transactions still have unresolved tax classification.',
                details:
                  'Tax package export for CA 2023 is blocked because 1 transactions still require tax classification review.',
                recommendedAction: 'Review and classify the affected transactions before filing.',
              },
            ],
            warnings: [],
          } as unknown as TaxPackageManifest,
        },
        '/workspace/root/reports/2023-ca-tax-package'
      )
    ).toEqual([
      'This package was written for inspection, but it is not filing-ready.',
      'Blocking issues: 1',
      '  - UNKNOWN_TRANSACTION_CLASSIFICATION: Some transactions still have unresolved tax classification.',
      '    Tax package export for CA 2023 is blocked because 1 transactions still require tax classification review.',
      '    Recommended action: Review and classify the affected transactions before filing.',
      '',
      'Review /workspace/root/reports/2023-ca-tax-package/report.md and /workspace/root/reports/2023-ca-tax-package/issues.csv for full details.',
    ]);
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
