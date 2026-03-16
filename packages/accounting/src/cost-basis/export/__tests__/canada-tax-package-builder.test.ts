import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { buildCostBasisFilingFacts } from '../../filing-facts/filing-facts-builder.js';
import { buildCanadaTaxPackage } from '../canada-tax-package-builder.js';
import { evaluateTaxPackageReadiness } from '../tax-package-review-gate.js';
import { validateTaxPackageScope } from '../tax-package-scope-validator.js';

import { createCanadaPackageBuildContext } from './test-utils.js';

describe('buildCanadaTaxPackage', () => {
  it('builds the full Canada package for a ready result', () => {
    const context = createCanadaPackageBuildContext();
    const scope = assertOk(
      validateTaxPackageScope({
        config: context.workflowResult.kind === 'canada-workflow' ? context.workflowResult.calculation : neverScope(),
      })
    );
    const readiness = evaluateTaxPackageReadiness({
      workflowResult: context.workflowResult,
      scope,
    });
    const filingFacts = assertOk(buildCostBasisFilingFacts({ artifact: context.workflowResult }));
    if (filingFacts.kind !== 'canada') {
      throw new Error('Expected Canada filing facts');
    }

    const result = assertOk(
      buildCanadaTaxPackage({
        context,
        filingFacts,
        readiness,
        now: () => new Date('2026-03-15T14:00:00.000Z'),
      })
    );

    expect(result.status).toBe('ready');
    expect(result.files.map((file) => file.relativePath)).toEqual([
      'manifest.json',
      'report.md',
      'dispositions.csv',
      'transfers.csv',
      'acquisitions.csv',
      'superficial-loss-adjustments.csv',
      'source-links.csv',
    ]);

    const manifestFile = result.files.find((file) => file.relativePath === 'manifest.json');
    const manifest = JSON.parse(manifestFile?.content ?? '{}') as Record<string, unknown>;
    expect(manifest['packageStatus']).toBe('ready');
    expect(manifest['taxCurrency']).toBe('CAD');

    const dispositionsCsv = result.files.find((file) => file.relativePath === 'dispositions.csv')?.content ?? '';
    expect(dispositionsCsv).toContain('DISP-0001');
    expect(dispositionsCsv).toContain('36050.00,50.00,36000.00,30000.00,6000.00');

    const adjustmentsCsv =
      result.files.find((file) => file.relativePath === 'superficial-loss-adjustments.csv')?.content ?? '';
    expect(adjustmentsCsv).toContain('SLA-0001');
    expect(adjustmentsCsv).toContain('DISP-0001');
    expect(adjustmentsCsv).toContain('ACQ-0001');

    const sourceLinksCsv = result.files.find((file) => file.relativePath === 'source-links.csv')?.content ?? '';
    expect(sourceLinksCsv).toContain('kraken-11');
    expect(sourceLinksCsv).toContain('txhash-12');

    const report = result.files.find((file) => file.relativePath === 'report.md')?.content ?? '';
    expect(report).toContain('Canada capital-gains inclusion rate of 0.5');
  });

  it('includes issues.csv for ready packages with warnings', () => {
    const context = createCanadaPackageBuildContext();
    const scope = assertOk(
      validateTaxPackageScope({
        config: context.workflowResult.kind === 'canada-workflow' ? context.workflowResult.calculation : neverScope(),
      })
    );
    const readiness = evaluateTaxPackageReadiness({
      workflowResult: context.workflowResult,
      scope,
      metadata: {
        fxFallbackCount: 1,
      },
    });
    const filingFacts = assertOk(buildCostBasisFilingFacts({ artifact: context.workflowResult }));
    if (filingFacts.kind !== 'canada') {
      throw new Error('Expected Canada filing facts');
    }

    const result = assertOk(
      buildCanadaTaxPackage({
        context,
        filingFacts,
        readiness,
        now: () => new Date('2026-03-15T14:00:00.000Z'),
      })
    );

    expect(result.status).toBe('ready');
    expect(result.files.some((file) => file.relativePath === 'issues.csv')).toBe(true);
    expect(result.files.find((file) => file.relativePath === 'issues.csv')?.content ?? '').toContain(
      'FX_FALLBACK_USED'
    );
  });

  it('emits a minimal blocked package', () => {
    const context = createCanadaPackageBuildContext();
    const scope = assertOk(
      validateTaxPackageScope({
        config: context.workflowResult.kind === 'canada-workflow' ? context.workflowResult.calculation : neverScope(),
      })
    );
    const readiness = evaluateTaxPackageReadiness({
      workflowResult: context.workflowResult,
      scope,
      metadata: {
        unresolvedAssetReviewCount: 1,
      },
    });
    const filingFacts = assertOk(buildCostBasisFilingFacts({ artifact: context.workflowResult }));
    if (filingFacts.kind !== 'canada') {
      throw new Error('Expected Canada filing facts');
    }

    const result = assertOk(
      buildCanadaTaxPackage({
        context,
        filingFacts,
        readiness,
        now: () => new Date('2026-03-15T14:00:00.000Z'),
      })
    );

    expect(result.status).toBe('blocked');
    expect(result.files.map((file) => file.relativePath)).toEqual(['manifest.json', 'report.md', 'issues.csv']);
    expect(result.files.find((file) => file.relativePath === 'issues.csv')?.content ?? '').toContain(
      'UNRESOLVED_ASSET_REVIEW'
    );
    expect(result.files.find((file) => file.relativePath === 'report.md')?.content ?? '').toContain(
      'Recommended action: Resolve the pending asset reviews before using this package for filing.'
    );
  });
});

function neverScope(): never {
  throw new Error('Expected canada-workflow scope');
}
