import type { AssetReviewSummary, Transaction } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { createCanadaFxProvider, createConfirmedTransferLink } from '../../__tests__/test-utils.js';
import { createAccountingExclusionPolicy } from '../../../../standard/validation/accounting-exclusion-policy.js';
import { runCanadaAcbWorkflow } from '../canada-acb-workflow.js';

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

describe('runCanadaAcbWorkflow', () => {
  it('fails closed when same-chain blockchain tokens share a symbol across multiple asset IDs', async () => {
    const fxProvider = createCanadaFxProvider();

    const first: Transaction = {
      id: 1,
      accountId: 1,
      externalId: 'tx-1',
      datetime: '2024-01-01T12:00:00Z',
      timestamp: Date.parse('2024-01-01T12:00:00Z'),
      source: 'arbitrum',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:arbitrum:0xaaa',
            assetSymbol: 'USDC' as Currency,
            grossAmount: parseDecimal('10'),
            priceAtTxTime: {
              price: { amount: parseDecimal('1'), currency: 'CAD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-01-01T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const second: Transaction = {
      id: 2,
      accountId: 1,
      externalId: 'tx-2',
      datetime: '2024-01-02T12:00:00Z',
      timestamp: Date.parse('2024-01-02T12:00:00Z'),
      source: 'arbitrum',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:arbitrum:0xbbb',
            assetSymbol: 'USDC' as Currency,
            grossAmount: parseDecimal('5'),
            priceAtTxTime: {
              price: { amount: parseDecimal('1'), currency: 'CAD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-01-02T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
      },
      fees: [],
      operation: { category: 'transfer', type: 'withdrawal' },
    };

    const result = await runCanadaAcbWorkflow([first, second], [], fxProvider, {
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
  });

  it('allows reviewed same-symbol ambiguity once the conflicting contract is excluded', async () => {
    const fxProvider = createCanadaFxProvider();

    const first: Transaction = {
      id: 3,
      accountId: 1,
      externalId: 'tx-3',
      datetime: '2024-01-03T12:00:00Z',
      timestamp: Date.parse('2024-01-03T12:00:00Z'),
      source: 'arbitrum',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:arbitrum:0xaaa',
            assetSymbol: 'USDC' as Currency,
            grossAmount: parseDecimal('10'),
            priceAtTxTime: {
              price: { amount: parseDecimal('1'), currency: 'CAD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-01-03T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const second: Transaction = {
      id: 4,
      accountId: 1,
      externalId: 'tx-4',
      datetime: '2024-01-04T12:00:00Z',
      timestamp: Date.parse('2024-01-04T12:00:00Z'),
      source: 'arbitrum',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:arbitrum:0xbbb',
            assetSymbol: 'USDC' as Currency,
            grossAmount: parseDecimal('5'),
            priceAtTxTime: {
              price: { amount: parseDecimal('1'), currency: 'CAD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-01-04T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
      },
      fees: [],
      operation: { category: 'transfer', type: 'withdrawal' },
    };

    const ambiguityEvidence = [
      {
        kind: 'same-symbol-ambiguity' as const,
        severity: 'warning' as const,
        message: 'Same-chain symbol ambiguity on arbitrum:usdc',
        metadata: {
          chain: 'arbitrum',
          conflictingAssetIds: ['blockchain:arbitrum:0xaaa', 'blockchain:arbitrum:0xbbb'],
          normalizedSymbol: 'usdc',
        },
      },
    ];

    const result = await runCanadaAcbWorkflow([first, second], [], fxProvider, {
      accountingExclusionPolicy: createAccountingExclusionPolicy(['blockchain:arbitrum:0xbbb']),
      assetReviewSummaries: new Map([
        [
          'blockchain:arbitrum:0xaaa',
          createAssetReviewSummary('blockchain:arbitrum:0xaaa', {
            reviewStatus: 'reviewed',
            accountingBlocked: true,
            warningSummary: 'Same-chain symbol ambiguity on arbitrum:usdc',
            evidence: ambiguityEvidence,
          }),
        ],
        [
          'blockchain:arbitrum:0xbbb',
          createAssetReviewSummary('blockchain:arbitrum:0xbbb', {
            reviewStatus: 'reviewed',
            accountingBlocked: true,
            warningSummary: 'Same-chain symbol ambiguity on arbitrum:usdc',
            evidence: ambiguityEvidence,
          }),
        ],
      ]),
    });

    expect(result.isOk()).toBe(true);
  });

  it('blocks included assets that still need review on the Canada workflow path', async () => {
    const fxProvider = createCanadaFxProvider();
    const reviewRequired: Transaction = {
      id: 10,
      accountId: 1,
      externalId: 'tx-10',
      datetime: '2024-01-01T12:00:00Z',
      timestamp: Date.parse('2024-01-01T12:00:00Z'),
      source: 'ethereum',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:0xscam',
            assetSymbol: 'SCAM' as Currency,
            grossAmount: parseDecimal('10'),
            priceAtTxTime: {
              price: { amount: parseDecimal('1'), currency: 'CAD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-01-01T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const result = await runCanadaAcbWorkflow([reviewRequired], [], fxProvider, {
      assetReviewSummaries: new Map([
        ['blockchain:ethereum:0xscam', createAssetReviewSummary('blockchain:ethereum:0xscam')],
      ]),
    });

    expect(assertErr(result).message).toContain('Assets flagged for review require confirmation or exclusion');
  });

  it('does not block excluded assets that still need review on the Canada workflow path', async () => {
    const fxProvider = createCanadaFxProvider();
    const safeAcquisition: Transaction = {
      id: 11,
      accountId: 1,
      externalId: 'tx-11',
      datetime: '2024-01-01T12:00:00Z',
      timestamp: Date.parse('2024-01-01T12:00:00Z'),
      source: 'kraken',
      sourceType: 'exchange',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('10000'), currency: 'CAD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2024-01-01T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'trade', type: 'buy' },
    };
    const reviewRequired: Transaction = {
      id: 12,
      accountId: 1,
      externalId: 'tx-12',
      datetime: '2024-01-02T12:00:00Z',
      timestamp: Date.parse('2024-01-02T12:00:00Z'),
      source: 'ethereum',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:0xscam',
            assetSymbol: 'SCAM' as Currency,
            grossAmount: parseDecimal('10'),
            priceAtTxTime: {
              price: { amount: parseDecimal('1'), currency: 'CAD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-01-02T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const result = await runCanadaAcbWorkflow([safeAcquisition, reviewRequired], [], fxProvider, {
      accountingExclusionPolicy: createAccountingExclusionPolicy(['blockchain:ethereum:0xscam']),
      assetReviewSummaries: new Map([
        ['blockchain:ethereum:0xscam', createAssetReviewSummary('blockchain:ethereum:0xscam')],
      ]),
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.inputContext.inputEvents.map((event) => event.assetId)).toEqual(['exchange:kraken:btc']);
    }
  });

  it('does not block warning-only review summaries on the Canada workflow path', async () => {
    const fxProvider = createCanadaFxProvider();
    const warningOnly: Transaction = {
      id: 13,
      accountId: 1,
      externalId: 'tx-13',
      datetime: '2024-01-03T12:00:00Z',
      timestamp: Date.parse('2024-01-03T12:00:00Z'),
      source: 'ethereum',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:0xwarn',
            assetSymbol: 'WARN' as Currency,
            grossAmount: parseDecimal('10'),
            priceAtTxTime: {
              price: { amount: parseDecimal('1'), currency: 'CAD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-01-03T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const result = await runCanadaAcbWorkflow([warningOnly], [], fxProvider, {
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
  });

  it('preserves pooled ACB across a confirmed internal transfer and later disposition', async () => {
    const fxProvider = createCanadaFxProvider();

    const acquisition: Transaction = {
      id: 1,
      accountId: 1,
      externalId: 'tx-1',
      datetime: '2024-01-01T12:00:00Z',
      timestamp: Date.parse('2024-01-01T12:00:00Z'),
      source: 'kraken',
      sourceType: 'exchange',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('10000'), currency: 'CAD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2024-01-01T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'trade', type: 'buy' },
    };

    const transferOut: Transaction = {
      id: 2,
      accountId: 1,
      externalId: 'tx-2',
      datetime: '2024-01-10T12:00:00Z',
      timestamp: Date.parse('2024-01-10T12:00:00Z'),
      source: 'kraken',
      sourceType: 'exchange',
      status: 'success',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('11000'), currency: 'CAD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2024-01-10T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
      },
      fees: [],
      operation: { category: 'transfer', type: 'withdrawal' },
    };

    const transferIn: Transaction = {
      id: 3,
      accountId: 2,
      externalId: 'tx-3',
      datetime: '2024-01-10T12:05:00Z',
      timestamp: Date.parse('2024-01-10T12:05:00Z'),
      source: 'bitcoin',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('11000'), currency: 'CAD' as Currency },
              source: 'link-propagated',
              fetchedAt: new Date('2024-01-10T12:05:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const disposition: Transaction = {
      id: 4,
      accountId: 2,
      externalId: 'tx-4',
      datetime: '2024-02-01T12:00:00Z',
      timestamp: Date.parse('2024-02-01T12:00:00Z'),
      source: 'bitcoin',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('12000'), currency: 'CAD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-02-01T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
      },
      fees: [],
      operation: { category: 'trade', type: 'sell' },
    };

    const confirmedTransferLink = createConfirmedTransferLink({
      id: 50,
      sourceAmount: '1',
      sourceAssetId: 'exchange:kraken:btc',
      sourceTransaction: transferOut,
      targetAmount: '1',
      targetAssetId: 'blockchain:bitcoin:native',
      targetTransaction: transferIn,
      assetSymbol: 'BTC' as Currency,
    });

    const result = await runCanadaAcbWorkflow(
      [acquisition, transferOut, transferIn, disposition],
      [confirmedTransferLink],
      fxProvider
    );
    const value = assertOk(result);

    expect(value.inputContext.inputEvents.map((event) => event.kind)).toEqual([
      'acquisition',
      'transfer-out',
      'transfer-in',
      'disposition',
    ]);
    expect(value.acbEngineResult.dispositions).toHaveLength(1);
    expect(value.acbEngineResult.dispositions[0]?.transactionId).toBe(4);
    expect(value.acbEngineResult.dispositions[0]?.costBasisCad.toFixed()).toBe('10000');
    expect(value.acbEngineResult.dispositions[0]?.proceedsCad.toFixed()).toBe('12000');
    expect(value.acbEngineResult.dispositions[0]?.gainLossCad.toFixed()).toBe('2000');
    expect(value.acbEngineResult.pools[0]?.quantityHeld.toFixed()).toBe('0');
  });

  it('handles fee-bearing acquisitions end to end', async () => {
    const fxProvider = createCanadaFxProvider({ usdToCad: '1.4' });

    const acquisition: Transaction = {
      id: 11,
      accountId: 1,
      externalId: 'tx-11',
      datetime: '2024-01-20T12:00:00Z',
      timestamp: Date.parse('2024-01-20T12:00:00Z'),
      source: 'coinbase',
      sourceType: 'exchange',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'exchange:coinbase:eth',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('2'),
            priceAtTxTime: {
              price: { amount: parseDecimal('3000'), currency: 'USD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2024-01-20T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [
        {
          assetId: 'fiat:usd',
          assetSymbol: 'USD' as Currency,
          amount: parseDecimal('10'),
          scope: 'platform',
          settlement: 'balance',
        },
      ],
      operation: { category: 'trade', type: 'buy' },
    };

    const disposition: Transaction = {
      id: 12,
      accountId: 1,
      externalId: 'tx-12',
      datetime: '2024-03-01T12:00:00Z',
      timestamp: Date.parse('2024-03-01T12:00:00Z'),
      source: 'coinbase',
      sourceType: 'exchange',
      status: 'success',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'exchange:coinbase:eth',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('2'),
            priceAtTxTime: {
              price: { amount: parseDecimal('3500'), currency: 'USD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2024-03-01T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
      },
      fees: [],
      operation: { category: 'trade', type: 'sell' },
    };

    const result = await runCanadaAcbWorkflow([acquisition, disposition], [], fxProvider);
    const value = assertOk(result);

    expect(value.inputContext.inputEvents).toHaveLength(2);
    expect(value.acbEngineResult.dispositions).toHaveLength(1);
    expect(value.acbEngineResult.dispositions[0]?.costBasisCad.toFixed()).toBe('8414');
    expect(value.acbEngineResult.dispositions[0]?.proceedsCad.toFixed()).toBe('9800');
    expect(value.acbEngineResult.dispositions[0]?.gainLossCad.toFixed()).toBe('1386');
    expect(value.acbEngineResult.pools[0]?.quantityHeld.toFixed()).toBe('0');
  });

  it('preserves basis through same-hash fee-only internal carryovers', async () => {
    const fxProvider = createCanadaFxProvider();

    const acquisition: Transaction = {
      id: 21,
      accountId: 1,
      externalId: 'tx-21',
      datetime: '2024-01-01T12:00:00Z',
      timestamp: Date.parse('2024-01-01T12:00:00Z'),
      source: 'kraken',
      sourceType: 'exchange',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('10000'), currency: 'CAD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2024-01-01T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'trade', type: 'buy' },
    };

    const internalSource: Transaction = {
      id: 22,
      accountId: 1,
      externalId: 'tx-22',
      datetime: '2024-01-10T12:00:00Z',
      timestamp: Date.parse('2024-01-10T12:00:00Z'),
      source: 'bitcoin',
      sourceType: 'blockchain',
      status: 'success',
      blockchain: {
        name: 'bitcoin',
        transaction_hash: 'hash-fee-only',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.99'),
            priceAtTxTime: {
              price: { amount: parseDecimal('11000'), currency: 'CAD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-01-10T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
      },
      fees: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('0.01'),
          scope: 'network',
          settlement: 'on-chain',
          priceAtTxTime: {
            price: { amount: parseDecimal('11000'), currency: 'CAD' as Currency },
            source: 'manual',
            fetchedAt: new Date('2024-01-10T12:00:00Z'),
            granularity: 'exact',
          },
        },
      ],
      operation: { category: 'transfer', type: 'withdrawal' },
    };

    const internalTarget: Transaction = {
      id: 23,
      accountId: 2,
      externalId: 'tx-23',
      datetime: '2024-01-10T12:01:00Z',
      timestamp: Date.parse('2024-01-10T12:01:00Z'),
      source: 'bitcoin',
      sourceType: 'blockchain',
      status: 'success',
      blockchain: {
        name: 'bitcoin',
        transaction_hash: 'hash-fee-only',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.99'),
            priceAtTxTime: {
              price: { amount: parseDecimal('11000'), currency: 'CAD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-01-10T12:01:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const disposition: Transaction = {
      id: 24,
      accountId: 2,
      externalId: 'tx-24',
      datetime: '2024-02-01T12:00:00Z',
      timestamp: Date.parse('2024-02-01T12:00:00Z'),
      source: 'bitcoin',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.99'),
            priceAtTxTime: {
              price: { amount: parseDecimal('12000'), currency: 'CAD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-02-01T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
      },
      fees: [],
      operation: { category: 'trade', type: 'sell' },
    };

    const result = await runCanadaAcbWorkflow(
      [acquisition, internalSource, internalTarget, disposition],
      [],
      fxProvider
    );
    const value = assertOk(result);
    const kinds = value.inputContext.inputEvents.map((event) => event.kind);

    expect(value.inputContext.feeOnlyInternalCarryoverSourceTransactionIds).toEqual([22]);
    expect(kinds).toHaveLength(4);
    expect(kinds.filter((kind) => kind === 'acquisition')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'transfer-in')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'fee-adjustment')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'disposition')).toHaveLength(1);
    expect(value.acbEngineResult.dispositions).toHaveLength(1);
    expect(value.acbEngineResult.dispositions[0]?.costBasisCad.toFixed()).toBe('10010');
    expect(value.acbEngineResult.dispositions[0]?.proceedsCad.toFixed()).toBe('11880');
    expect(value.acbEngineResult.dispositions[0]?.gainLossCad.toFixed()).toBe('1870');
    expect(value.acbEngineResult.pools[0]?.quantityHeld.toFixed()).toBe('0');
    expect(value.acbEngineResult.pools[0]?.totalAcbCad.toFixed()).toBe('0');
  });

  it('drops fully excluded assets before building the Canada tax input context', async () => {
    const fxProvider = createCanadaFxProvider();

    const excludedAcquisition: Transaction = {
      id: 90,
      accountId: 1,
      externalId: 'tx-90',
      datetime: '2024-01-01T12:00:00Z',
      timestamp: Date.parse('2024-01-01T12:00:00Z'),
      source: 'spam-chain',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:spam-chain:0xscam',
            assetSymbol: 'SCAM' as Currency,
            grossAmount: parseDecimal('1000'),
            priceAtTxTime: {
              price: { amount: parseDecimal('0.01'), currency: 'CAD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-01-01T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const result = await runCanadaAcbWorkflow([excludedAcquisition], [], fxProvider, {
      accountingExclusionPolicy: createAccountingExclusionPolicy(['blockchain:spam-chain:0xscam']),
    });
    const value = assertOk(result);

    expect(value.inputContext.inputEvents).toEqual([]);
    expect(value.inputContext.scopedTransactionIds).toEqual([]);
    expect(value.acbEngineResult.dispositions).toHaveLength(0);
  });
});
