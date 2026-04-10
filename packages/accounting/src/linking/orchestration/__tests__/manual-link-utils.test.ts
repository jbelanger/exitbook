import type { Currency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import type { Logger } from '@exitbook/logger';
import { describe, expect, it, vi } from 'vitest';

import { createTransaction } from '../../shared/test-utils.js';
import { buildManualLinkOverrideMetadata, prepareManualLinkFromTransactions } from '../manual-link-utils.js';

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
});
