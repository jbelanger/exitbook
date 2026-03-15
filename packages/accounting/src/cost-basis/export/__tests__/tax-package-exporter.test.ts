import { ok } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { exportTaxPackage } from '../tax-package-exporter.js';
import { validateTaxPackageScope } from '../tax-package-scope-validator.js';
import type { WrittenTaxPackageFile } from '../tax-package-types.js';

import { createCanadaPackageBuildContext, createStandardPackageBuildContext } from './test-utils.js';

describe('exportTaxPackage', () => {
  it('backfills manifest artifact hashes before writing', async () => {
    const context = createCanadaPackageBuildContext();
    const scope = assertOk(
      validateTaxPackageScope({
        config: context.workflowResult.kind === 'canada-workflow' ? context.workflowResult.calculation : neverScope(),
      })
    );

    const capturedWrites: WrittenTaxPackageFile[] = [];
    const result = assertOk(
      await exportTaxPackage(
        {
          context,
          scope,
        },
        {
          now: () => new Date('2026-03-15T14:00:00.000Z'),
          writer: {
            writeAll: async (files) => {
              const writtenFiles = await Promise.all(
                files.map(async (file) => ({
                  ...file,
                  absolutePath: `/tmp/${file.relativePath}`,
                  bytesWritten: Buffer.byteLength(file.content, 'utf8'),
                  sha256: await computeSha256(file.content),
                }))
              );
              capturedWrites.push(...writtenFiles);
              return ok(writtenFiles);
            },
          },
        }
      )
    );

    const manifestFile = capturedWrites.find((file) => file.relativePath === 'manifest.json');
    expect(manifestFile).toBeDefined();

    const manifest = JSON.parse(manifestFile?.content ?? '{}') as {
      artifactIndex?: { relativePath: string; sha256?: string | undefined }[];
    };
    const artifactIndex = manifest.artifactIndex ?? [];
    const hashesByPath = new Map(artifactIndex.map((entry) => [entry.relativePath, entry.sha256] as const));

    expect(hashesByPath.get('manifest.json')).toBeUndefined();

    for (const file of capturedWrites.filter((entry) => entry.relativePath !== 'manifest.json')) {
      expect(hashesByPath.get(file.relativePath)).toBe(file.sha256);
    }

    expect(result.manifest.artifactIndex.find((entry) => entry.relativePath === 'report.md')?.sha256).toBe(
      hashesByPath.get('report.md')
    );
  });

  it('exports the US package path and backfills lots.csv hashes', async () => {
    const context = createStandardPackageBuildContext();
    const scope = assertOk(
      validateTaxPackageScope({
        config:
          context.workflowResult.kind === 'standard-workflow'
            ? {
                method: context.workflowResult.summary.calculation.config.method,
                jurisdiction: context.workflowResult.summary.calculation.config.jurisdiction,
                taxYear: context.workflowResult.summary.calculation.config.taxYear,
                startDate: context.workflowResult.summary.calculation.config.startDate!,
                endDate: context.workflowResult.summary.calculation.config.endDate!,
              }
            : neverScope(),
      })
    );

    const capturedWrites: WrittenTaxPackageFile[] = [];
    const result = assertOk(
      await exportTaxPackage(
        {
          context,
          scope,
        },
        {
          now: () => new Date('2026-03-15T14:00:00.000Z'),
          writer: {
            writeAll: async (files) => {
              const writtenFiles = await Promise.all(
                files.map(async (file) => ({
                  ...file,
                  absolutePath: `/tmp/${file.relativePath}`,
                  bytesWritten: Buffer.byteLength(file.content, 'utf8'),
                  sha256: await computeSha256(file.content),
                }))
              );
              capturedWrites.push(...writtenFiles);
              return ok(writtenFiles);
            },
          },
        }
      )
    );

    expect(result.status).toBe('ready');
    expect(capturedWrites.map((file) => file.relativePath)).toContain('lots.csv');

    const manifest = JSON.parse(
      capturedWrites.find((file) => file.relativePath === 'manifest.json')?.content ?? '{}'
    ) as {
      artifactIndex?: { relativePath: string; sha256?: string | undefined }[];
    };
    const lotsEntry = manifest.artifactIndex?.find((entry) => entry.relativePath === 'lots.csv');
    const lotsFile = capturedWrites.find((file) => file.relativePath === 'lots.csv');

    expect(lotsEntry?.sha256).toBe(lotsFile?.sha256);
  });
});

async function computeSha256(content: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function neverScope(): never {
  throw new Error('Expected canada-workflow scope');
}
