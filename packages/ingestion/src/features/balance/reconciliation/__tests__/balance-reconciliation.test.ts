import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { reconcileBalanceRows, type BalanceReconciliationInputRow } from '../balance-reconciliation.js';

function row(overrides: Partial<BalanceReconciliationInputRow> = {}): BalanceReconciliationInputRow {
  return {
    accountId: 1,
    assetId: 'asset:eth',
    assetSymbol: 'ETH',
    balanceCategory: 'liquid',
    quantity: '10',
    ...overrides,
  };
}

describe('reconcileBalanceRows', () => {
  it('marks rows as matched when expected and reference quantities are within tolerance', () => {
    const result = assertOk(
      reconcileBalanceRows({
        expectedRows: [row({ quantity: '10.000000001' })],
        referenceRows: [row({ quantity: '10' })],
        referenceSource: 'live',
        tolerance: '0.00000001',
      })
    );

    expect(result.rows).toMatchObject([
      {
        assetId: 'asset:eth',
        balanceCategory: 'liquid',
        diffQuantity: '0.000000001',
        expectedQuantity: '10.000000001',
        referenceQuantity: '10',
        referenceSource: 'live',
        status: 'matched',
      },
    ]);
    expect(result.summary).toEqual({
      categoryUnsupported: 0,
      matched: 1,
      missingReference: 0,
      quantityMismatches: 0,
      totalRows: 1,
      unexpectedReference: 0,
    });
  });

  it('reports expected balances with no reference row', () => {
    const result = assertOk(
      reconcileBalanceRows({
        expectedRows: [row()],
        referenceRows: [],
        referenceSource: 'stored',
      })
    );

    expect(result.rows[0]).toMatchObject({
      diffQuantity: '10',
      expectedQuantity: '10',
      referenceQuantity: '0',
      referenceSource: 'stored',
      status: 'missing_reference',
    });
  });

  it('reports reference rows that are outside the expected ledger scope', () => {
    const result = assertOk(
      reconcileBalanceRows({
        expectedRows: [],
        referenceRows: [row({ quantity: '3' })],
        referenceSource: 'live',
      })
    );

    expect(result.rows[0]).toMatchObject({
      diffQuantity: '-3',
      expectedQuantity: '0',
      referenceQuantity: '3',
      status: 'unexpected_reference',
    });
  });

  it('ignores zero reference-only rows outside the expected ledger scope', () => {
    const result = assertOk(
      reconcileBalanceRows({
        expectedRows: [],
        referenceRows: [row({ quantity: '0' })],
        referenceSource: 'live',
      })
    );

    expect(result.rows).toEqual([]);
    expect(result.summary).toEqual({
      categoryUnsupported: 0,
      matched: 0,
      missingReference: 0,
      quantityMismatches: 0,
      totalRows: 0,
      unexpectedReference: 0,
    });
  });

  it('reports quantity mismatches with expected minus reference diff quantity', () => {
    const result = assertOk(
      reconcileBalanceRows({
        expectedRows: [row({ quantity: '10' })],
        referenceRows: [row({ quantity: '8.5' })],
        referenceSource: 'live',
      })
    );

    expect(result.rows[0]).toMatchObject({
      diffQuantity: '1.5',
      expectedQuantity: '10',
      referenceQuantity: '8.5',
      status: 'quantity_mismatch',
    });
  });

  it('keeps balance categories separate for the same account and asset', () => {
    const result = assertOk(
      reconcileBalanceRows({
        expectedRows: [row({ balanceCategory: 'liquid' }), row({ balanceCategory: 'staked', quantity: '2' })],
        referenceRows: [row({ balanceCategory: 'liquid' }), row({ balanceCategory: 'staked', quantity: '0' })],
        referenceSource: 'stored',
      })
    );

    expect(
      result.rows.map((reconciliationRow) => [reconciliationRow.balanceCategory, reconciliationRow.status])
    ).toEqual([
      ['liquid', 'matched'],
      ['staked', 'quantity_mismatch'],
    ]);
  });

  it('reports expected categories unsupported by the selected reference source', () => {
    const result = assertOk(
      reconcileBalanceRows({
        expectedRows: [row({ balanceCategory: 'staked', quantity: '2' })],
        referenceRows: [],
        referenceSource: 'live',
        unsupportedReferenceRows: [
          {
            accountId: 1,
            assetId: 'asset:eth',
            assetSymbol: 'ETH',
            balanceCategory: 'staked',
            reason: 'Live balance provider exposes only liquid balances',
          },
        ],
      })
    );

    expect(result.rows[0]).toMatchObject({
      balanceCategory: 'staked',
      expectedQuantity: '2',
      referenceSource: 'live',
      referenceUnavailableReason: 'Live balance provider exposes only liquid balances',
      status: 'category_unsupported',
    });
    expect(result.summary.categoryUnsupported).toBe(1);
  });

  it('aggregates duplicate rows before comparison and keeps provenance refs', () => {
    const result = assertOk(
      reconcileBalanceRows({
        expectedRows: [row({ quantity: '4', refs: ['posting:1'] }), row({ quantity: '6', refs: ['posting:2'] })],
        referenceRows: [row({ quantity: '10', refs: ['snapshot:1'] })],
        referenceSource: 'stored',
      })
    );

    expect(result.rows[0]).toMatchObject({
      expectedQuantity: '10',
      expectedRefs: ['posting:1', 'posting:2'],
      referenceRefs: ['snapshot:1'],
      status: 'matched',
    });
  });

  it('fails on invalid quantities instead of silently dropping rows', () => {
    const error = assertErr(
      reconcileBalanceRows({
        expectedRows: [row({ quantity: 'not-a-number' })],
        referenceRows: [],
        referenceSource: 'live',
      })
    );

    expect(error.message).toContain('Invalid balance reconciliation expected quantity');
  });
});
