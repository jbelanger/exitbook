import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import type { Logger } from '@exitbook/logger';
import { describe, expect, it, vi } from 'vitest';

import { createTransaction } from '../../shared/test-utils.js';
import {
  buildManualLinkOverrideMetadata,
  prepareGroupedManualLinksFromTransactions,
  prepareManualLinkFromTransactions,
} from '../manual-link-utils.js';

const noopLogger = {
  child: () => noopLogger,
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
} as unknown as Logger;

describe('manual-link-utils', () => {
  it('prepares a confirmed manual link from an exact outflow/inflow pair', () => {
    const sourceTransaction = createTransaction({
      id: 1,
      source: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:36:00.000Z',
      outflows: [{ assetSymbol: 'RENDER', amount: '80.61', assetId: 'blockchain:ethereum:render' }],
    });
    const targetTransaction = createTransaction({
      id: 2,
      source: 'solana',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:53:00.000Z',
      inflows: [{ assetSymbol: 'RENDER', amount: '80.61', assetId: 'blockchain:solana:render' }],
    });

    const prepared = assertOk(
      prepareManualLinkFromTransactions(
        {
          transactions: [sourceTransaction, targetTransaction],
          sourceTransactionId: sourceTransaction.id,
          targetTransactionId: targetTransaction.id,
          assetSymbol: 'RENDER' as Currency,
          reviewedAt: new Date('2026-04-10T12:00:00.000Z'),
          reviewedBy: 'cli-user',
          metadata: buildManualLinkOverrideMetadata('override-1', 'transfer'),
        },
        noopLogger
      )
    );

    expect(prepared.link.status).toBe('confirmed');
    expect(prepared.link.linkType).toBe('blockchain_to_blockchain');
    expect(prepared.link.sourceAssetId).toBe('blockchain:ethereum:render');
    expect(prepared.link.targetAssetId).toBe('blockchain:solana:render');
    expect(prepared.link.sourceAmount.toFixed()).toBe('80.61');
    expect(prepared.link.targetAmount.toFixed()).toBe('80.61');
    expect(prepared.link.reviewedBy).toBe('cli-user');
    expect(prepared.link.metadata).toMatchObject({
      overrideId: 'override-1',
      overrideLinkType: 'transfer',
      linkProvenance: 'manual',
      variance: '0',
      variancePct: '0.00',
    });
  });

  it('rejects ambiguous manual links when the source transaction has multiple matching outflows', () => {
    const sourceTransaction = createTransaction({
      id: 1,
      source: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:36:00.000Z',
      outflows: [
        { assetSymbol: 'RENDER', amount: '40.305', assetId: 'blockchain:ethereum:render' },
        { assetSymbol: 'RENDER', amount: '40.305', assetId: 'blockchain:ethereum:render' },
      ],
    });
    const targetTransaction = createTransaction({
      id: 2,
      source: 'solana',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:53:00.000Z',
      inflows: [{ assetSymbol: 'RENDER', amount: '80.61', assetId: 'blockchain:solana:render' }],
    });

    const error = assertErr(
      prepareManualLinkFromTransactions(
        {
          transactions: [sourceTransaction, targetTransaction],
          sourceTransactionId: sourceTransaction.id,
          targetTransactionId: targetTransaction.id,
          assetSymbol: 'RENDER' as Currency,
          reviewedAt: new Date('2026-04-10T12:00:00.000Z'),
          reviewedBy: 'cli-user',
        },
        noopLogger
      )
    );

    expect(error.message).toContain('manual links require exactly one');
  });

  it('prepares a confirmed manual link for a high-variance bridge-style transfer', () => {
    const sourceTransaction = createTransaction({
      id: 1,
      source: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-05-20T18:55:35.000Z',
      outflows: [{ assetSymbol: 'ETH', amount: '0.003', assetId: 'blockchain:ethereum:native' }],
    });
    const targetTransaction = createTransaction({
      id: 2,
      source: 'arbitrum',
      platformKind: 'blockchain',
      datetime: '2024-05-20T19:09:53.000Z',
      inflows: [{ assetSymbol: 'ETH', amount: '0.00221', assetId: 'blockchain:arbitrum:native' }],
    });

    const prepared = assertOk(
      prepareManualLinkFromTransactions(
        {
          transactions: [sourceTransaction, targetTransaction],
          sourceTransactionId: sourceTransaction.id,
          targetTransactionId: targetTransaction.id,
          assetSymbol: 'ETH' as Currency,
          reviewedAt: new Date('2026-04-19T00:00:00.000Z'),
          reviewedBy: 'cli-user',
          metadata: buildManualLinkOverrideMetadata('override-bridge', 'transfer'),
        },
        noopLogger
      )
    );

    expect(prepared.link.linkType).toBe('blockchain_to_blockchain');
    expect(prepared.link.sourceAmount.toFixed()).toBe('0.003');
    expect(prepared.link.targetAmount.toFixed()).toBe('0.00221');
    expect(prepared.link.impliedFeeAmount?.toFixed()).toBe('0.00079');
    expect(prepared.link.metadata).toMatchObject({
      overrideId: 'override-bridge',
      variance: '0.00079',
      variancePct: '26.33',
    });
  });

  it('prepares grouped many-to-one manual links with partial metadata', () => {
    const firstSourceTransaction = createTransaction({
      id: 1,
      source: 'cardano',
      platformKind: 'blockchain',
      datetime: '2024-07-25T20:30:00.000Z',
      outflows: [{ assetSymbol: 'ADA', amount: '1021.4', assetId: 'blockchain:cardano:ada' }],
    });
    const secondSourceTransaction = createTransaction({
      id: 2,
      source: 'cardano',
      platformKind: 'blockchain',
      datetime: '2024-07-25T20:31:00.000Z',
      outflows: [{ assetSymbol: 'ADA', amount: '975.03', assetId: 'blockchain:cardano:ada' }],
    });
    const targetTransaction = createTransaction({
      id: 3,
      source: 'kucoin',
      platformKind: 'exchange',
      datetime: '2024-07-25T20:35:00.000Z',
      inflows: [{ assetSymbol: 'ADA', amount: '1996.43', assetId: 'exchange:kucoin:ada' }],
    });

    const prepared = assertOk(
      prepareGroupedManualLinksFromTransactions(
        {
          transactions: [firstSourceTransaction, secondSourceTransaction, targetTransaction],
          sourceTransactionIds: [firstSourceTransaction.id, secondSourceTransaction.id],
          targetTransactionIds: [targetTransaction.id],
          assetSymbol: 'ADA' as Currency,
          reviewedAt: new Date('2026-04-14T12:00:00.000Z'),
          reviewedBy: 'cli-user',
        },
        noopLogger
      )
    );

    expect(prepared.shape).toBe('many-to-one');
    expect(prepared.entries).toHaveLength(2);
    expect(prepared.entries[0]?.link.metadata).toMatchObject({
      partialMatch: true,
      fullSourceAmount: '1021.4',
      fullTargetAmount: '1996.43',
      consumedAmount: '1021.4',
    });
    expect(prepared.entries[1]?.link.metadata).toMatchObject({
      partialMatch: true,
      fullSourceAmount: '975.03',
      fullTargetAmount: '1996.43',
      consumedAmount: '975.03',
    });
  });

  it('prepares grouped many-to-one manual links with one exact explained target residual', () => {
    const firstSourceTransaction = createTransaction({
      id: 1,
      source: 'cardano',
      platformKind: 'blockchain',
      datetime: '2024-07-25T20:30:00.000Z',
      outflows: [{ assetSymbol: 'ADA', amount: '1021.4', assetId: 'blockchain:cardano:ada' }],
    });
    const secondSourceTransaction = createTransaction({
      id: 2,
      source: 'cardano',
      platformKind: 'blockchain',
      datetime: '2024-07-25T20:31:00.000Z',
      outflows: [{ assetSymbol: 'ADA', amount: '975.03', assetId: 'blockchain:cardano:ada' }],
    });
    const targetTransaction = createTransaction({
      id: 3,
      source: 'kucoin',
      platformKind: 'exchange',
      datetime: '2024-07-25T20:35:00.000Z',
      inflows: [{ assetSymbol: 'ADA', amount: '2006.954451', assetId: 'exchange:kucoin:ada' }],
    });

    const prepared = assertOk(
      prepareGroupedManualLinksFromTransactions(
        {
          transactions: [firstSourceTransaction, secondSourceTransaction, targetTransaction],
          sourceTransactionIds: [firstSourceTransaction.id, secondSourceTransaction.id],
          targetTransactionIds: [targetTransaction.id],
          assetSymbol: 'ADA' as Currency,
          explainedTargetResidual: {
            amount: parseDecimal('10.524451'),
            role: 'staking_reward',
          },
          reviewedAt: new Date('2026-04-14T12:00:00.000Z'),
          reviewedBy: 'cli-user',
        },
        noopLogger
      )
    );

    expect(prepared.shape).toBe('many-to-one');
    expect(prepared.entries.every((entry) => entry.link.metadata?.explainedTargetResidualAmount === '10.524451')).toBe(
      true
    );
    expect(
      prepared.entries.every((entry) => entry.link.metadata?.explainedTargetResidualRole === 'staking_reward')
    ).toBe(true);
  });

  it('rejects grouped manual links when both sides are plural', () => {
    const firstSourceTransaction = createTransaction({
      id: 1,
      source: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:36:00.000Z',
      outflows: [{ assetSymbol: 'USDC', amount: '10', assetId: 'blockchain:ethereum:usdc' }],
    });
    const secondSourceTransaction = createTransaction({
      id: 2,
      source: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:37:00.000Z',
      outflows: [{ assetSymbol: 'USDC', amount: '15', assetId: 'blockchain:ethereum:usdc' }],
    });
    const firstTargetTransaction = createTransaction({
      id: 3,
      source: 'base',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:50:00.000Z',
      inflows: [{ assetSymbol: 'USDC', amount: '12', assetId: 'blockchain:base:usdc' }],
    });
    const secondTargetTransaction = createTransaction({
      id: 4,
      source: 'base',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:51:00.000Z',
      inflows: [{ assetSymbol: 'USDC', amount: '13', assetId: 'blockchain:base:usdc' }],
    });

    const error = assertErr(
      prepareGroupedManualLinksFromTransactions(
        {
          transactions: [
            firstSourceTransaction,
            secondSourceTransaction,
            firstTargetTransaction,
            secondTargetTransaction,
          ],
          sourceTransactionIds: [firstSourceTransaction.id, secondSourceTransaction.id],
          targetTransactionIds: [firstTargetTransaction.id, secondTargetTransaction.id],
          assetSymbol: 'USDC' as Currency,
          reviewedAt: new Date('2026-04-14T12:00:00.000Z'),
          reviewedBy: 'cli-user',
        },
        noopLogger
      )
    );

    expect(error.message).toContain('many-to-one or one-to-many');
  });

  it('rejects grouped manual links when totals do not balance exactly', () => {
    const sourceTransaction = createTransaction({
      id: 1,
      source: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:36:00.000Z',
      outflows: [{ assetSymbol: 'USDC', amount: '25', assetId: 'blockchain:ethereum:usdc' }],
    });
    const firstTargetTransaction = createTransaction({
      id: 2,
      source: 'base',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:50:00.000Z',
      inflows: [{ assetSymbol: 'USDC', amount: '12', assetId: 'blockchain:base:usdc' }],
    });
    const secondTargetTransaction = createTransaction({
      id: 3,
      source: 'base',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:51:00.000Z',
      inflows: [{ assetSymbol: 'USDC', amount: '12.5', assetId: 'blockchain:base:usdc' }],
    });

    const error = assertErr(
      prepareGroupedManualLinksFromTransactions(
        {
          transactions: [sourceTransaction, firstTargetTransaction, secondTargetTransaction],
          sourceTransactionIds: [sourceTransaction.id],
          targetTransactionIds: [firstTargetTransaction.id, secondTargetTransaction.id],
          assetSymbol: 'USDC' as Currency,
          reviewedAt: new Date('2026-04-14T12:00:00.000Z'),
          reviewedBy: 'cli-user',
        },
        noopLogger
      )
    );

    expect(error.message).toContain('require exact conservation');
  });

  it('rejects explained target residuals for grouped one-to-many links', () => {
    const sourceTransaction = createTransaction({
      id: 1,
      source: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:36:00.000Z',
      outflows: [{ assetSymbol: 'USDC', amount: '25', assetId: 'blockchain:ethereum:usdc' }],
    });
    const firstTargetTransaction = createTransaction({
      id: 2,
      source: 'base',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:50:00.000Z',
      inflows: [{ assetSymbol: 'USDC', amount: '10', assetId: 'blockchain:base:usdc' }],
    });
    const secondTargetTransaction = createTransaction({
      id: 3,
      source: 'base',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:51:00.000Z',
      inflows: [{ assetSymbol: 'USDC', amount: '16', assetId: 'blockchain:base:usdc' }],
    });

    const error = assertErr(
      prepareGroupedManualLinksFromTransactions(
        {
          transactions: [sourceTransaction, firstTargetTransaction, secondTargetTransaction],
          sourceTransactionIds: [sourceTransaction.id],
          targetTransactionIds: [firstTargetTransaction.id, secondTargetTransaction.id],
          assetSymbol: 'USDC' as Currency,
          explainedTargetResidual: {
            amount: parseDecimal('1'),
            role: 'refund_rebate',
          },
          reviewedAt: new Date('2026-04-14T12:00:00.000Z'),
          reviewedBy: 'cli-user',
        },
        noopLogger
      )
    );

    expect(error.message).toContain('many-to-one');
  });
});
