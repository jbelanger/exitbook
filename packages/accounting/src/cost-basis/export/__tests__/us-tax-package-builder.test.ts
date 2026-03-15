import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { buildCostBasisFilingFacts } from '../../filing-facts/filing-facts-builder.js';
import { evaluateTaxPackageReadiness } from '../tax-package-review-gate.js';
import { validateTaxPackageScope } from '../tax-package-scope-validator.js';
import { buildUsTaxPackage } from '../us-tax-package-builder.js';

import { createStandardPackageBuildContext } from './test-utils.js';

describe('buildUsTaxPackage', () => {
  it('builds the full US package for a ready result', () => {
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
    const readiness = evaluateTaxPackageReadiness({
      workflowResult: context.workflowResult,
      scope,
    });
    const filingFacts = assertOk(buildCostBasisFilingFacts({ artifact: context.workflowResult }));
    if (filingFacts.kind !== 'standard') {
      throw new Error('Expected standard filing facts');
    }

    const result = assertOk(
      buildUsTaxPackage({
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
      'lots.csv',
      'source-links.csv',
    ]);

    const manifest = JSON.parse(
      result.files.find((file) => file.relativePath === 'manifest.json')?.content ?? '{}'
    ) as {
      method?: string;
      packageStatus?: string;
      taxCurrency?: string;
    };
    expect(manifest['packageStatus']).toBe('ready');
    expect(manifest['taxCurrency']).toBe('USD');
    expect(manifest['method']).toBe('fifo');

    const dispositionsCsv = result.files.find((file) => file.relativePath === 'dispositions.csv')?.content ?? '';
    expect(dispositionsCsv).toContain('DISP-0001');
    expect(dispositionsCsv).toContain('DISP-GROUP-0001');
    expect(dispositionsCsv).toContain(',short_term,LOT-0002');
    expect(dispositionsCsv).toContain(',long_term,LOT-0001');
    expect(dispositionsCsv).not.toContain('form_8949_box');
    expect(dispositionsCsv).not.toContain(',G,');
    expect(dispositionsCsv).not.toContain(',J,');

    const transfersCsv = result.files.find((file) => file.relativePath === 'transfers.csv')?.content ?? '';
    expect(transfersCsv).toContain('lot_carryover');
    expect(transfersCsv).toContain('3762.50');

    const lotsCsv = result.files.find((file) => file.relativePath === 'lots.csv')?.content ?? '';
    expect(lotsCsv).toContain('LOT-0001');
    expect(lotsCsv).toContain('fully_disposed');
    expect(lotsCsv).toContain('LOT-0002');
    expect(lotsCsv).toContain('open');

    const sourceLinksCsv = result.files.find((file) => file.relativePath === 'source-links.csv')?.content ?? '';
    expect(sourceLinksCsv).toContain('kraken-3');
    expect(sourceLinksCsv).toContain('txhash-5');

    const report = result.files.find((file) => file.relativePath === 'report.md')?.content ?? '';
    expect(report).toContain('intentionally omits downstream Form 8949 box placement');
    expect(report).toContain('canonical U.S. holding-period classification');
    expect(report).toContain('basis_source remains lot_carryover');
  });

  it('includes issues.csv for review-required packages', () => {
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
    const readiness = evaluateTaxPackageReadiness({
      workflowResult: context.workflowResult,
      scope,
      metadata: {
        fxFallbackCount: 1,
      },
    });
    const filingFacts = assertOk(buildCostBasisFilingFacts({ artifact: context.workflowResult }));
    if (filingFacts.kind !== 'standard') {
      throw new Error('Expected standard filing facts');
    }

    const result = assertOk(
      buildUsTaxPackage({
        context,
        filingFacts,
        readiness,
        now: () => new Date('2026-03-15T14:00:00.000Z'),
      })
    );

    expect(result.status).toBe('review_required');
    expect(result.files.some((file) => file.relativePath === 'issues.csv')).toBe(true);
    expect(result.files.find((file) => file.relativePath === 'issues.csv')?.content ?? '').toContain(
      'FX_FALLBACK_USED'
    );
  });

  it('emits a minimal blocked package', () => {
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
    const readiness = evaluateTaxPackageReadiness({
      workflowResult: context.workflowResult,
      scope,
      metadata: {
        unresolvedAssetReviewCount: 1,
      },
    });
    const filingFacts = assertOk(buildCostBasisFilingFacts({ artifact: context.workflowResult }));
    if (filingFacts.kind !== 'standard') {
      throw new Error('Expected standard filing facts');
    }

    const result = assertOk(
      buildUsTaxPackage({
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
  });

  it('marks fee-only carryovers as review-needed inbound transfers', () => {
    const context = createStandardPackageBuildContext();
    if (context.workflowResult.kind !== 'standard-workflow') {
      throw new Error('Expected standard-workflow scope');
    }

    context.workflowResult.lotTransfers[0] = {
      ...context.workflowResult.lotTransfers[0]!,
      provenance: {
        kind: 'fee-only-carryover',
        sourceMovementFingerprint: 'movement:exchange:source:4:btc:outflow:0',
        targetMovementFingerprint: 'movement:blockchain:target:5:btc:inflow:0',
      },
    };

    const scope = assertOk(
      validateTaxPackageScope({
        config: {
          method: context.workflowResult.summary.calculation.config.method,
          jurisdiction: context.workflowResult.summary.calculation.config.jurisdiction,
          taxYear: context.workflowResult.summary.calculation.config.taxYear,
          startDate: context.workflowResult.summary.calculation.config.startDate!,
          endDate: context.workflowResult.summary.calculation.config.endDate!,
        },
      })
    );
    const readiness = evaluateTaxPackageReadiness({
      workflowResult: context.workflowResult,
      scope,
      metadata: {
        incompleteTransferLinkCount: 1,
      },
    });
    const filingFacts = assertOk(buildCostBasisFilingFacts({ artifact: context.workflowResult }));
    if (filingFacts.kind !== 'standard') {
      throw new Error('Expected standard filing facts');
    }

    const result = assertOk(
      buildUsTaxPackage({
        context,
        filingFacts,
        readiness,
        now: () => new Date('2026-03-15T14:00:00.000Z'),
      })
    );

    expect(result.status).toBe('review_required');
    expect(result.files.find((file) => file.relativePath === 'issues.csv')?.content ?? '').toContain(
      'INCOMPLETE_TRANSFER_LINKING'
    );
    expect(result.files.find((file) => file.relativePath === 'transfers.csv')?.content ?? '').toContain(
      'review_needed_inbound'
    );
  });
});

function neverScope(): never {
  throw new Error('Expected standard-workflow scope');
}
