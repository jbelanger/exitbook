import type { AssetMovementDraft, AssetReviewSummary, Currency, TransactionLink } from '@exitbook/core';
import { computeMovementFingerprint, ok, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  createBlockchainTx,
  createExchangeTx,
  createFeeMovement,
  createMovement,
  createPriceAtTxTime,
  createTransaction,
  createTransactionFromMovements,
  seedTxFingerprint,
} from '../../../../__tests__/test-utils.js';
import type { ICostBasisContextReader } from '../../../../ports/cost-basis-persistence.js';
import type { CostBasisConfig } from '../../../model/cost-basis-config.js';
import { createAccountingExclusionPolicy } from '../../validation/accounting-exclusion-policy.js';
import { runCostBasisPipeline } from '../run-standard-cost-basis.js';

const defaultConfig: CostBasisConfig = {
  method: 'fifo',
  jurisdiction: 'US',
  taxYear: 2025,
  currency: 'USD',
  startDate: new Date('2025-01-01T00:00:00.000Z'),
  endDate: new Date('2025-12-31T23:59:59.999Z'),
};

function stubStore(): ICostBasisContextReader {
  return {
    loadCostBasisContext: vi.fn(),
  };
}

function createBlockchainTokenMovement(assetId: string, assetSymbol: string, amount: string): AssetMovementDraft {
  return {
    assetId,
    assetSymbol: assetSymbol as Currency,
    grossAmount: parseDecimal(amount),
    priceAtTxTime: createPriceAtTxTime('1'),
  };
}

function buildMovementFingerprint(params: {
  accountId: number;
  identityReference: string;
  movementType: 'inflow' | 'outflow';
  position: number;
  source: string;
  sourceType: 'blockchain' | 'exchange';
}): string {
  const txFingerprint = seedTxFingerprint(params.source, params.sourceType, params.accountId, params.identityReference);

  return assertOk(
    computeMovementFingerprint({
      txFingerprint,
      movementType: params.movementType,
      position: params.position,
    })
  );
}

function createAssetReviewSummary(assetId: string, overrides: Partial<AssetReviewSummary> = {}): AssetReviewSummary {
  return {
    assetId,
    reviewStatus: 'needs-review',
    referenceStatus: 'unknown',
    evidenceFingerprint: `asset-review:v1:${assetId}`,
    confirmationIsStale: false,
    accountingBlocked: true,
    warningSummary: 'Suspicious asset evidence requires review',
    evidence: [
      {
        kind: 'spam-flag',
        severity: 'error',
        message: 'Processed transactions marked this asset as spam',
      },
    ],
    ...overrides,
  };
}

describe('runCostBasisPipeline', () => {
  it('fails when any transaction is missing required prices', async () => {
    const store = stubStore();
    const priced = createTransaction(1, '2025-01-10T00:00:00.000Z', [
      { assetSymbol: 'BTC', amount: '1', price: '50000' },
    ]);
    const missing = createTransactionFromMovements(2, '2025-01-11T00:00:00.000Z', {
      inflows: [createMovement('ETH', '2')],
    });

    const result = await runCostBasisPipeline([priced, missing], defaultConfig, store, {
      missingPricePolicy: 'error',
    });

    expect(assertErr(result).message).toContain('1 transactions are missing required price data');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).not.toHaveBeenCalled();
  });

  it('blocks included assets that still need review before accounting starts', async () => {
    const store = stubStore();
    const reviewRequired = createTransactionFromMovements(
      10,
      '2025-01-10T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:ethereum:0xscam', 'SCAM', '100')],
      },
      [],
      {
        category: 'transfer',
        source: 'ethereum',
        sourceType: 'blockchain',
        type: 'deposit',
      }
    );

    const result = await runCostBasisPipeline([reviewRequired], defaultConfig, store, {
      missingPricePolicy: 'error',
      assetReviewSummaries: new Map([
        ['blockchain:ethereum:0xscam', createAssetReviewSummary('blockchain:ethereum:0xscam')],
      ]),
    });

    expect(assertErr(result).message).toContain('Assets flagged for review require confirmation or exclusion');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).not.toHaveBeenCalled();
  });

  it('does not block excluded assets that still need review', async () => {
    const store = stubStore();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    vi.mocked(store.loadCostBasisContext).mockResolvedValue(ok({ transactions: [], confirmedLinks: [], accounts: [] }));

    const safe = createTransaction(11, '2025-01-10T00:00:00.000Z', [
      { assetSymbol: 'BTC', amount: '1', price: '50000' },
    ]);
    const reviewRequired = createTransactionFromMovements(
      12,
      '2025-01-11T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:ethereum:0xscam', 'SCAM', '100')],
      },
      [],
      {
        category: 'transfer',
        source: 'ethereum',
        sourceType: 'blockchain',
        type: 'deposit',
      }
    );

    const result = await runCostBasisPipeline([safe, reviewRequired], defaultConfig, store, {
      missingPricePolicy: 'error',
      accountingExclusionPolicy: createAccountingExclusionPolicy(['blockchain:ethereum:0xscam']),
      assetReviewSummaries: new Map([
        ['blockchain:ethereum:0xscam', createAssetReviewSummary('blockchain:ethereum:0xscam')],
      ]),
    });

    expect(result.isOk()).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).toHaveBeenCalledOnce();
  });

  it('allows reviewed assets through the pipeline', async () => {
    const store = stubStore();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    vi.mocked(store.loadCostBasisContext).mockResolvedValue(ok({ transactions: [], confirmedLinks: [], accounts: [] }));

    const reviewRequired = createTransactionFromMovements(
      13,
      '2025-01-10T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:ethereum:0xscam', 'SCAM', '100')],
      },
      [],
      {
        category: 'transfer',
        source: 'ethereum',
        sourceType: 'blockchain',
        type: 'deposit',
      }
    );

    const result = await runCostBasisPipeline([reviewRequired], defaultConfig, store, {
      missingPricePolicy: 'error',
      assetReviewSummaries: new Map([
        [
          'blockchain:ethereum:0xscam',
          createAssetReviewSummary('blockchain:ethereum:0xscam', {
            reviewStatus: 'reviewed',
            confirmedEvidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
            accountingBlocked: false,
          }),
        ],
      ]),
    });

    expect(result.isOk()).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).toHaveBeenCalledOnce();
  });

  it('still fails closed on same-symbol blockchain ambiguity even if review summaries say reviewed', async () => {
    const store = stubStore();
    const first = createTransactionFromMovements(
      14,
      '2025-01-10T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:ethereum:0xaaa', 'USDC', '10')],
      },
      [],
      {
        category: 'transfer',
        source: 'ethereum',
        sourceType: 'blockchain',
        type: 'deposit',
      }
    );
    const second = createTransactionFromMovements(
      15,
      '2025-01-11T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:ethereum:0xbbb', 'USDC', '12')],
      },
      [],
      {
        category: 'transfer',
        source: 'ethereum',
        sourceType: 'blockchain',
        type: 'deposit',
      }
    );

    const result = await runCostBasisPipeline([first, second], defaultConfig, store, {
      missingPricePolicy: 'error',
      assetReviewSummaries: new Map([
        [
          'blockchain:ethereum:0xaaa',
          createAssetReviewSummary('blockchain:ethereum:0xaaa', {
            reviewStatus: 'reviewed',
            accountingBlocked: true,
            evidence: [
              {
                kind: 'same-symbol-ambiguity',
                severity: 'warning',
                message: 'Same-chain symbol ambiguity on ethereum:usdc',
              },
            ],
          }),
        ],
        [
          'blockchain:ethereum:0xbbb',
          createAssetReviewSummary('blockchain:ethereum:0xbbb', {
            reviewStatus: 'reviewed',
            accountingBlocked: true,
            evidence: [
              {
                kind: 'same-symbol-ambiguity',
                severity: 'warning',
                message: 'Same-chain symbol ambiguity on ethereum:usdc',
              },
            ],
          }),
        ],
      ]),
    });

    const error = assertErr(result);
    expect(error.message).toContain('Assets flagged for review require confirmation or exclusion');
    expect(error.message).toContain(
      'Ambiguous on-chain asset symbols remain blocked until the unwanted contract is excluded.'
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).not.toHaveBeenCalled();
  });

  it('allows reviewed same-symbol ambiguity through once the conflicting asset is excluded from scope', async () => {
    const store = stubStore();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    vi.mocked(store.loadCostBasisContext).mockResolvedValue(ok({ transactions: [], confirmedLinks: [], accounts: [] }));

    const first = createTransactionFromMovements(
      17,
      '2025-01-10T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:ethereum:0xaaa', 'USDC', '10')],
      },
      [],
      {
        category: 'transfer',
        source: 'ethereum',
        sourceType: 'blockchain',
        type: 'deposit',
      }
    );
    const second = createTransactionFromMovements(
      18,
      '2025-01-11T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:ethereum:0xbbb', 'USDC', '12')],
      },
      [],
      {
        category: 'transfer',
        source: 'ethereum',
        sourceType: 'blockchain',
        type: 'deposit',
      }
    );

    const ambiguityEvidence = [
      {
        kind: 'same-symbol-ambiguity' as const,
        severity: 'warning' as const,
        message: 'Same-chain symbol ambiguity on ethereum:usdc',
        metadata: {
          chain: 'ethereum',
          conflictingAssetIds: ['blockchain:ethereum:0xaaa', 'blockchain:ethereum:0xbbb'],
          normalizedSymbol: 'usdc',
        },
      },
    ];

    const result = await runCostBasisPipeline([first, second], defaultConfig, store, {
      missingPricePolicy: 'error',
      accountingExclusionPolicy: createAccountingExclusionPolicy(['blockchain:ethereum:0xbbb']),
      assetReviewSummaries: new Map([
        [
          'blockchain:ethereum:0xaaa',
          createAssetReviewSummary('blockchain:ethereum:0xaaa', {
            reviewStatus: 'reviewed',
            accountingBlocked: true,
            evidence: ambiguityEvidence,
          }),
        ],
        [
          'blockchain:ethereum:0xbbb',
          createAssetReviewSummary('blockchain:ethereum:0xbbb', {
            reviewStatus: 'reviewed',
            accountingBlocked: true,
            evidence: ambiguityEvidence,
          }),
        ],
      ]),
    });

    expect(result.isOk()).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).toHaveBeenCalledOnce();
  });

  it('allows warning-only review summaries through the pipeline', async () => {
    const store = stubStore();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    vi.mocked(store.loadCostBasisContext).mockResolvedValue(ok({ transactions: [], confirmedLinks: [], accounts: [] }));

    const warningOnly = createTransactionFromMovements(
      16,
      '2025-01-10T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:ethereum:0xwarn', 'WARN', '10')],
      },
      [],
      {
        category: 'transfer',
        source: 'ethereum',
        sourceType: 'blockchain',
        type: 'deposit',
      }
    );

    const result = await runCostBasisPipeline([warningOnly], defaultConfig, store, {
      missingPricePolicy: 'error',
      assetReviewSummaries: new Map([
        [
          'blockchain:ethereum:0xwarn',
          createAssetReviewSummary('blockchain:ethereum:0xwarn', {
            accountingBlocked: false,
            warningSummary: '1 processed transaction(s) carried SUSPICIOUS_AIRDROP warnings',
            evidence: [
              {
                kind: 'suspicious-airdrop-note',
                severity: 'warning',
                message: '1 processed transaction(s) carried SUSPICIOUS_AIRDROP warnings',
              },
            ],
          }),
        ],
      ]),
    });

    expect(result.isOk()).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).toHaveBeenCalledOnce();
  });

  it('excludes transactions missing prices in soft mode and continues with the price-complete subset', async () => {
    const store = stubStore();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    vi.mocked(store.loadCostBasisContext).mockResolvedValue(ok({ transactions: [], confirmedLinks: [], accounts: [] }));

    const priced = createTransaction(1, '2025-01-10T00:00:00.000Z', [
      { assetSymbol: 'BTC', amount: '1', price: '50000' },
    ]);
    const missing = createTransactionFromMovements(2, '2025-01-11T00:00:00.000Z', {
      inflows: [createMovement('ETH', '2')],
    });

    const result = await runCostBasisPipeline([priced, missing], defaultConfig, store, {
      missingPricePolicy: 'exclude',
    });

    const resultValue = assertOk(result);
    expect(resultValue.missingPricesCount).toBe(1);
    expect(resultValue.rebuildTransactions.map((tx) => tx.id)).toEqual([1]);
    expect(resultValue.summary.calculation.transactionsProcessed).toBe(1);
    expect(resultValue.summary.lotsCreated).toBe(1);
    expect(resultValue.summary.disposalsProcessed).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).toHaveBeenCalledOnce();
  });

  it('keeps same-hash internal dependency transactions when rebuilding the soft price-complete subset', async () => {
    const store = stubStore();
    const hash = '45ec1d9a069424a0c969507f82300f9ef4102ebb0f1921d89b2d50390862c131';

    const acquisition = createExchangeTx({
      id: 10,
      accountId: 50,
      datetime: '2025-01-01T00:00:00.000Z',
      identityReference: 'acq-10',
      source: 'kraken',
      type: 'buy',
      inflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('0.05'),
          netAmount: parseDecimal('0.05'),
          priceAtTxTime: createPriceAtTxTime('63074.01'),
        },
      ],
    });

    const networkFee = {
      ...createFeeMovement('network', 'on-chain', 'BTC', '0.00003821', '63074.01'),
      assetId: 'blockchain:bitcoin:native',
    };

    const sender = createBlockchainTx({
      id: 11,
      accountId: 3,
      datetime: '2025-05-08T10:14:40.000Z',
      txHash: hash,
      outflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('0.01037'),
          netAmount: parseDecimal('0.01033179'),
          priceAtTxTime: createPriceAtTxTime('63074.01'),
        },
      ],
      fees: [networkFee],
    });

    const internalReceiver = createBlockchainTx({
      id: 12,
      accountId: 10,
      datetime: '2025-05-08T10:14:40.000Z',
      txHash: hash,
      inflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('0.01012179'),
          netAmount: parseDecimal('0.01012179'),
          priceAtTxTime: createPriceAtTxTime('63074.01'),
        },
      ],
    });

    const exchangeDeposit = createExchangeTx({
      id: 13,
      accountId: 90,
      datetime: '2025-05-08T10:16:45.000Z',
      identityReference: hash,
      source: 'kucoin',
      type: 'deposit',
      inflows: [
        {
          assetId: 'exchange:kucoin:btc',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('0.00021'),
          netAmount: parseDecimal('0.00021'),
          priceAtTxTime: createPriceAtTxTime('63074.01'),
        },
      ],
    });

    const missingPriceTx = createTransactionFromMovements(99, '2025-05-09T00:00:00.000Z', {
      inflows: [createMovement('ETH', '2')],
    });

    const confirmedLink: TransactionLink = {
      id: 3340,
      sourceTransactionId: sender.id,
      targetTransactionId: exchangeDeposit.id,
      assetSymbol: 'BTC' as Currency,
      sourceAssetId: 'blockchain:bitcoin:native',
      targetAssetId: 'exchange:kucoin:btc',
      sourceAmount: parseDecimal('0.00021'),
      targetAmount: parseDecimal('0.00021'),
      sourceMovementFingerprint: buildMovementFingerprint({
        source: sender.source,
        sourceType: sender.sourceType,
        accountId: sender.accountId,
        identityReference: hash,
        movementType: 'outflow',
        position: 0,
      }),
      targetMovementFingerprint: buildMovementFingerprint({
        source: exchangeDeposit.source,
        sourceType: exchangeDeposit.sourceType,
        accountId: exchangeDeposit.accountId,
        identityReference: hash,
        movementType: 'inflow',
        position: 0,
      }),
      linkType: 'blockchain_to_exchange',
      confidenceScore: parseDecimal('1'),
      matchCriteria: {
        assetMatch: true,
        amountSimilarity: parseDecimal('1'),
        timingValid: true,
        timingHours: 0.034722222222222224,
        hashMatch: true,
      },
      status: 'confirmed',
      createdAt: new Date('2026-03-10T21:52:39.280Z'),
      updatedAt: new Date('2026-03-10T21:52:39.280Z'),
      reviewedAt: new Date('2026-03-10T21:52:39.280Z'),
      reviewedBy: 'auto',
      metadata: {
        variance: '0',
        variancePct: '0.00',
      },
    };

    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    vi.mocked(store.loadCostBasisContext).mockResolvedValue(
      ok({ transactions: [], confirmedLinks: [confirmedLink], accounts: [] })
    );

    const result = await runCostBasisPipeline(
      [acquisition, sender, internalReceiver, exchangeDeposit, missingPriceTx],
      defaultConfig,
      store,
      {
        missingPricePolicy: 'exclude',
      }
    );

    const resultValue = assertOk(result);
    expect(resultValue.missingPricesCount).toBe(1);
    expect(resultValue.rebuildTransactions.map((tx) => tx.id)).toEqual([10, 11, 12, 13]);
    expect(resultValue.summary.lotTransfers).toHaveLength(1);
  });

  it('prunes excluded assets before price validation in mixed transactions', async () => {
    const store = stubStore();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    vi.mocked(store.loadCostBasisContext).mockResolvedValue(ok({ transactions: [], confirmedLinks: [], accounts: [] }));

    const mixed = createTransactionFromMovements(1, '2025-01-10T00:00:00.000Z', {
      inflows: [createMovement('ETH', '1', '3000'), createMovement('SCAM', '1000')],
    });

    const result = await runCostBasisPipeline([mixed], defaultConfig, store, {
      accountingExclusionPolicy: createAccountingExclusionPolicy(['test:scam']),
      missingPricePolicy: 'error',
    });

    const resultValue = assertOk(result);
    expect(resultValue.missingPricesCount).toBe(0);
    expect(resultValue.rebuildTransactions.map((tx) => tx.id)).toEqual([1]);
    expect(resultValue.summary.calculation.transactionsProcessed).toBe(1);
  });

  it('fails closed when same-chain blockchain tokens share a symbol across multiple asset IDs', async () => {
    const store = stubStore();
    const first = createTransactionFromMovements(
      1,
      '2025-01-10T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:arbitrum:0xaaa', 'USDC', '10')],
      },
      [],
      { source: 'arbitrum', sourceType: 'blockchain', category: 'transfer', type: 'deposit' }
    );
    const second = createTransactionFromMovements(
      2,
      '2025-01-11T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:arbitrum:0xbbb', 'USDC', '5')],
      },
      [],
      { source: 'arbitrum', sourceType: 'blockchain', category: 'transfer', type: 'deposit' }
    );

    const result = await runCostBasisPipeline([first, second], defaultConfig, store, {
      missingPricePolicy: 'error',
      assetReviewSummaries: new Map([
        [
          'blockchain:arbitrum:0xaaa',
          createAssetReviewSummary('blockchain:arbitrum:0xaaa', {
            reviewStatus: 'reviewed',
            accountingBlocked: true,
            warningSummary: 'Same-chain symbol ambiguity on arbitrum:usdc',
            evidence: [
              {
                kind: 'same-symbol-ambiguity',
                severity: 'warning',
                message: 'Same-chain symbol ambiguity on arbitrum:usdc',
              },
            ],
          }),
        ],
        [
          'blockchain:arbitrum:0xbbb',
          createAssetReviewSummary('blockchain:arbitrum:0xbbb', {
            reviewStatus: 'reviewed',
            accountingBlocked: true,
            warningSummary: 'Same-chain symbol ambiguity on arbitrum:usdc',
            evidence: [
              {
                kind: 'same-symbol-ambiguity',
                severity: 'warning',
                message: 'Same-chain symbol ambiguity on arbitrum:usdc',
              },
            ],
          }),
        ],
      ]),
    });

    const error = assertErr(result);
    expect(error.message).toContain('Assets flagged for review require confirmation or exclusion');
    expect(error.message).toContain(
      'Ambiguous on-chain asset symbols remain blocked until the unwanted contract is excluded.'
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).not.toHaveBeenCalled();
  });
});
