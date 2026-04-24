import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { Logger } from '@exitbook/logger';
import { describe, expect, it, vi } from 'vitest';

import { buildTransaction } from '../../__tests__/test-utils.js';
import {
  buildLedgerDraftShadowEffects,
  buildLegacyLedgerShadowEffects,
  reconcileLegacyAccountingToLedgerDrafts,
  type LedgerShadowDraft,
} from '../shadow-reconciliation.js';

const ADA = assertOk(parseCurrency('ADA'));

const noopLogger: Logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
};

function createSourceActivity(sourceKey: string, ownerAccountId = 1) {
  return {
    ownerAccountId,
    sourceActivityFingerprint: `source_activity:${sourceKey}`,
    platformKey: 'cardano',
    platformKind: 'blockchain' as const,
    activityStatus: 'success' as const,
    activityDatetime: '2026-04-23T00:00:00.000Z',
    activityTimestampMs: 1713830400000,
    blockchainName: 'cardano',
    blockchainBlockHeight: 123,
    blockchainTransactionHash: sourceKey,
    blockchainIsConfirmed: true,
  };
}

function createFeeMovement(amount: string) {
  return {
    assetId: 'blockchain:cardano:native',
    assetSymbol: ADA,
    amount: parseDecimal(amount),
    scope: 'network' as const,
    settlement: 'on-chain' as const,
  };
}

function createLedgerDraft(params: {
  accountId?: number | undefined;
  feeAmount?: string | undefined;
  principalQuantity?: string | undefined;
  rewardQuantity?: string | undefined;
  sourceKey: string;
}): LedgerShadowDraft {
  const journals = [];

  if (params.principalQuantity !== undefined) {
    journals.push({
      sourceActivityFingerprint: `source_activity:${params.sourceKey}`,
      journalStableKey: 'transfer',
      journalKind: 'transfer' as const,
      postings: [
        {
          postingStableKey: 'principal:ada',
          assetId: 'blockchain:cardano:native',
          assetSymbol: ADA,
          quantity: parseDecimal(params.principalQuantity),
          role: 'principal' as const,
          sourceComponentRefs: [
            {
              component: {
                sourceActivityFingerprint: `source_activity:${params.sourceKey}`,
                componentKind: 'account_delta' as const,
                componentId: `${params.sourceKey}:principal`,
                assetId: 'blockchain:cardano:native',
              },
              quantity: parseDecimal(params.principalQuantity).abs(),
            },
          ],
        },
      ],
    });
  }

  if (params.rewardQuantity !== undefined) {
    journals.push({
      sourceActivityFingerprint: `source_activity:${params.sourceKey}`,
      journalStableKey: 'staking_reward',
      journalKind: 'staking_reward' as const,
      postings: [
        {
          postingStableKey: 'staking_reward:ada',
          assetId: 'blockchain:cardano:native',
          assetSymbol: ADA,
          quantity: parseDecimal(params.rewardQuantity),
          role: 'staking_reward' as const,
          sourceComponentRefs: [
            {
              component: {
                sourceActivityFingerprint: `source_activity:${params.sourceKey}`,
                componentKind: 'staking_reward' as const,
                componentId: `${params.sourceKey}:reward`,
                assetId: 'blockchain:cardano:native',
              },
              quantity: parseDecimal(params.rewardQuantity).abs(),
            },
          ],
        },
      ],
    });
  }

  if (params.feeAmount !== undefined) {
    journals.push({
      sourceActivityFingerprint: `source_activity:${params.sourceKey}`,
      journalStableKey: 'network_fee',
      journalKind: 'expense_only' as const,
      postings: [
        {
          postingStableKey: 'network_fee:ada',
          assetId: 'blockchain:cardano:native',
          assetSymbol: ADA,
          quantity: parseDecimal(params.feeAmount).negated(),
          role: 'fee' as const,
          settlement: 'on-chain' as const,
          sourceComponentRefs: [
            {
              component: {
                sourceActivityFingerprint: `source_activity:${params.sourceKey}`,
                componentKind: 'network_fee' as const,
                componentId: `${params.sourceKey}:fee`,
                assetId: 'blockchain:cardano:native',
              },
              quantity: parseDecimal(params.feeAmount),
            },
          ],
        },
      ],
    });
  }

  return {
    sourceActivity: createSourceActivity(params.sourceKey, params.accountId),
    journals,
  };
}

describe('shadow reconciliation', () => {
  it('aggregates matching incoming transfer effects with no diffs', () => {
    const transaction = buildTransaction({
      id: 1,
      datetime: '2026-04-23T00:00:00Z',
      platformKey: 'cardano',
      platformKind: 'blockchain',
      category: 'transfer',
      type: 'deposit',
      blockchain: {
        name: 'cardano',
        transaction_hash: 'tx-incoming-1',
        is_confirmed: true,
      },
      inflows: [
        {
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA',
          amount: '2',
        },
      ],
    });

    const reconciliation = assertOk(
      reconcileLegacyAccountingToLedgerDrafts(
        [transaction],
        [createLedgerDraft({ sourceKey: 'tx-incoming-1', principalQuantity: '2' })],
        noopLogger
      )
    );

    expect(reconciliation.diffs).toEqual([]);
    expect(reconciliation.legacyEffects).toHaveLength(1);
    expect(reconciliation.ledgerEffects).toHaveLength(1);
  });

  it('reconciles transfer-with-change by comparing signed principal and fee effects', () => {
    const transaction = buildTransaction({
      id: 2,
      datetime: '2026-04-23T00:00:00Z',
      platformKey: 'cardano',
      platformKind: 'blockchain',
      category: 'transfer',
      type: 'withdrawal',
      blockchain: {
        name: 'cardano',
        transaction_hash: 'tx-change-1',
        is_confirmed: true,
      },
      inflows: [
        {
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA',
          amount: '7',
        },
      ],
      outflows: [
        {
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA',
          amount: '10.17',
          netAmount: '10',
        },
      ],
      fees: [createFeeMovement('0.17')],
    });

    const reconciliation = assertOk(
      reconcileLegacyAccountingToLedgerDrafts(
        [transaction],
        [createLedgerDraft({ sourceKey: 'tx-change-1', principalQuantity: '-3', feeAmount: '0.17' })],
        noopLogger
      )
    );

    expect(reconciliation.diffs).toEqual([]);
  });

  it('reconciles attributable staking withdrawal as principal plus reward plus fee', () => {
    const transaction = buildTransaction({
      id: 3,
      datetime: '2026-04-23T00:00:00Z',
      platformKey: 'cardano',
      platformKind: 'blockchain',
      category: 'transfer',
      type: 'withdrawal',
      blockchain: {
        name: 'cardano',
        transaction_hash: 'tx-withdrawal-1',
        is_confirmed: true,
      },
      inflows: [
        {
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA',
          amount: '1',
          movementRole: 'staking_reward',
        },
      ],
      outflows: [
        {
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA',
          amount: '10',
          netAmount: '9.83',
        },
      ],
      fees: [createFeeMovement('0.17')],
    });

    const reconciliation = assertOk(
      reconcileLegacyAccountingToLedgerDrafts(
        [transaction],
        [
          createLedgerDraft({
            sourceKey: 'tx-withdrawal-1',
            principalQuantity: '-9.83',
            rewardQuantity: '1',
            feeAmount: '0.17',
          }),
        ],
        noopLogger
      )
    );

    expect(reconciliation.diffs).toEqual([]);
  });

  it('reconciles sibling-input unattributed withdrawal without staking reward ledger output', () => {
    const transaction = buildTransaction({
      id: 4,
      datetime: '2026-04-23T00:00:00Z',
      platformKey: 'cardano',
      platformKind: 'blockchain',
      category: 'transfer',
      type: 'withdrawal',
      blockchain: {
        name: 'cardano',
        transaction_hash: 'tx-withdrawal-2',
        is_confirmed: true,
      },
      outflows: [
        {
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA',
          amount: '6',
          netAmount: '5.898',
        },
      ],
      fees: [createFeeMovement('0.102')],
    });

    const reconciliation = assertOk(
      reconcileLegacyAccountingToLedgerDrafts(
        [transaction],
        [createLedgerDraft({ sourceKey: 'tx-withdrawal-2', principalQuantity: '-5.898', feeAmount: '0.102' })],
        noopLogger
      )
    );

    expect(reconciliation.diffs).toEqual([]);
  });

  it('reports quantity mismatches as diffs', () => {
    const transaction = buildTransaction({
      id: 5,
      datetime: '2026-04-23T00:00:00Z',
      platformKey: 'cardano',
      platformKind: 'blockchain',
      category: 'transfer',
      type: 'deposit',
      blockchain: {
        name: 'cardano',
        transaction_hash: 'tx-mismatch-1',
        is_confirmed: true,
      },
      inflows: [
        {
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA',
          amount: '2',
        },
      ],
    });

    const reconciliation = assertOk(
      reconcileLegacyAccountingToLedgerDrafts(
        [transaction],
        [createLedgerDraft({ sourceKey: 'tx-mismatch-1', principalQuantity: '1.5' })],
        noopLogger
      )
    );

    expect(reconciliation.diffs).toHaveLength(1);
    expect(reconciliation.diffs[0]).toMatchObject({
      assetId: 'blockchain:cardano:native',
      role: 'principal',
      sourceKey: 'cardano:1:tx-mismatch-1',
    });
    expect(reconciliation.diffs[0]?.delta.toFixed()).toBe('-0.5');
  });

  it('builds sorted ledger draft effects with journal kind context', () => {
    const effects = assertOk(
      buildLedgerDraftShadowEffects([
        createLedgerDraft({
          sourceKey: 'tx-sorted-1',
          principalQuantity: '-9.83',
          rewardQuantity: '1',
          feeAmount: '0.17',
        }),
      ])
    );

    expect(effects.map((effect) => [effect.role, effect.quantity.toFixed(), effect.journalKinds ?? []])).toEqual([
      ['fee', '-0.17', ['expense_only']],
      ['principal', '-9.83', ['transfer']],
      ['staking_reward', '1', ['staking_reward']],
    ]);
  });

  it('builds legacy effects from current accounting model output', () => {
    const transaction = buildTransaction({
      id: 6,
      datetime: '2026-04-23T00:00:00Z',
      platformKey: 'cardano',
      platformKind: 'blockchain',
      category: 'transfer',
      type: 'withdrawal',
      blockchain: {
        name: 'cardano',
        transaction_hash: 'tx-legacy-1',
        is_confirmed: true,
      },
      outflows: [
        {
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA',
          amount: '10',
          netAmount: '9.83',
        },
      ],
      fees: [createFeeMovement('0.17')],
    });

    const effects = assertOk(buildLegacyLedgerShadowEffects([transaction], noopLogger));

    expect(effects.map((effect) => [effect.role, effect.quantity.toFixed(), effect.settlement ?? ''])).toEqual([
      ['fee', '-0.17', 'on-chain'],
      ['principal', '-9.83', ''],
    ]);
  });
});
