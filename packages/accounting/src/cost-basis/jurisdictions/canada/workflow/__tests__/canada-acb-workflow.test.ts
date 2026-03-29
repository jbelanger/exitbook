import type { AssetReviewSummary } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildTransaction, createCanadaPriceRuntime, createConfirmedTransferLink } from '../../__tests__/test-utils.js';
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
    const fxProvider = createCanadaPriceRuntime();

    const first = buildTransaction({
      id: 1,
      datetime: '2024-01-01T12:00:00Z',
      platformKey: 'arbitrum',
      platformKind: 'blockchain',
      inflows: [
        { assetId: 'blockchain:arbitrum:0xaaa', assetSymbol: 'USDC', amount: '10', price: '1', priceCurrency: 'CAD' },
      ],
      category: 'transfer',
      type: 'deposit',
    });

    const second = buildTransaction({
      id: 2,
      datetime: '2024-01-02T12:00:00Z',
      platformKey: 'arbitrum',
      platformKind: 'blockchain',
      outflows: [
        { assetId: 'blockchain:arbitrum:0xbbb', assetSymbol: 'USDC', amount: '5', price: '1', priceCurrency: 'CAD' },
      ],
      category: 'transfer',
      type: 'withdrawal',
    });

    const result = await runCanadaAcbWorkflow({
      transactions: [first, second],
      confirmedLinks: [],
      priceRuntime: fxProvider,
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
    const fxProvider = createCanadaPriceRuntime();

    const first = buildTransaction({
      id: 3,
      datetime: '2024-01-03T12:00:00Z',
      platformKey: 'arbitrum',
      platformKind: 'blockchain',
      inflows: [
        { assetId: 'blockchain:arbitrum:0xaaa', assetSymbol: 'USDC', amount: '10', price: '1', priceCurrency: 'CAD' },
      ],
      category: 'transfer',
      type: 'deposit',
    });

    const second = buildTransaction({
      id: 4,
      datetime: '2024-01-04T12:00:00Z',
      platformKey: 'arbitrum',
      platformKind: 'blockchain',
      outflows: [
        { assetId: 'blockchain:arbitrum:0xbbb', assetSymbol: 'USDC', amount: '5', price: '1', priceCurrency: 'CAD' },
      ],
      category: 'transfer',
      type: 'withdrawal',
    });

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

    const result = await runCanadaAcbWorkflow({
      transactions: [first, second],
      confirmedLinks: [],
      priceRuntime: fxProvider,
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
    const fxProvider = createCanadaPriceRuntime();
    const reviewRequired = buildTransaction({
      id: 10,
      datetime: '2024-01-01T12:00:00Z',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      inflows: [
        {
          assetId: 'blockchain:ethereum:0xscam',
          assetSymbol: 'SCAM',
          amount: '10',
          price: '1',
          priceCurrency: 'CAD',
        },
      ],
      category: 'transfer',
      type: 'deposit',
    });

    const result = await runCanadaAcbWorkflow({
      transactions: [reviewRequired],
      confirmedLinks: [],
      priceRuntime: fxProvider,
      assetReviewSummaries: new Map([
        ['blockchain:ethereum:0xscam', createAssetReviewSummary('blockchain:ethereum:0xscam')],
      ]),
    });

    expect(assertErr(result).message).toContain('Assets flagged for review require confirmation or exclusion');
  });

  it('does not block excluded assets that still need review on the Canada workflow path', async () => {
    const fxProvider = createCanadaPriceRuntime();
    const safeAcquisition = buildTransaction({
      id: 11,
      datetime: '2024-01-01T12:00:00Z',
      platformKey: 'kraken',
      inflows: [
        {
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          amount: '1',
          price: '10000',
          priceCurrency: 'CAD',
          priceSource: 'exchange-execution',
        },
      ],
    });
    const reviewRequired = buildTransaction({
      id: 12,
      datetime: '2024-01-02T12:00:00Z',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      inflows: [
        {
          assetId: 'blockchain:ethereum:0xscam',
          assetSymbol: 'SCAM',
          amount: '10',
          price: '1',
          priceCurrency: 'CAD',
        },
      ],
      category: 'transfer',
      type: 'deposit',
    });

    const result = await runCanadaAcbWorkflow({
      transactions: [safeAcquisition, reviewRequired],
      confirmedLinks: [],
      priceRuntime: fxProvider,
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
    const fxProvider = createCanadaPriceRuntime();
    const warningOnly = buildTransaction({
      id: 13,
      datetime: '2024-01-03T12:00:00Z',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      inflows: [
        {
          assetId: 'blockchain:ethereum:0xwarn',
          assetSymbol: 'WARN',
          amount: '10',
          price: '1',
          priceCurrency: 'CAD',
        },
      ],
      category: 'transfer',
      type: 'deposit',
    });

    const result = await runCanadaAcbWorkflow({
      transactions: [warningOnly],
      confirmedLinks: [],
      priceRuntime: fxProvider,
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
    const fxProvider = createCanadaPriceRuntime();

    const acquisition = buildTransaction({
      id: 1,
      datetime: '2024-01-01T12:00:00Z',
      platformKey: 'kraken',
      inflows: [
        {
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          amount: '1',
          price: '10000',
          priceCurrency: 'CAD',
          priceSource: 'exchange-execution',
        },
      ],
    });

    const transferOut = buildTransaction({
      id: 2,
      datetime: '2024-01-10T12:00:00Z',
      platformKey: 'kraken',
      outflows: [
        {
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          amount: '1',
          price: '11000',
          priceCurrency: 'CAD',
          priceSource: 'exchange-execution',
        },
      ],
      category: 'transfer',
      type: 'withdrawal',
    });

    const transferIn = buildTransaction({
      id: 3,
      accountId: 2,
      datetime: '2024-01-10T12:05:00Z',
      platformKey: 'bitcoin',
      platformKind: 'blockchain',
      inflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          amount: '1',
          price: '11000',
          priceCurrency: 'CAD',
          priceSource: 'link-propagated',
        },
      ],
      category: 'transfer',
      type: 'deposit',
    });

    const disposition = buildTransaction({
      id: 4,
      accountId: 2,
      datetime: '2024-02-01T12:00:00Z',
      platformKey: 'bitcoin',
      platformKind: 'blockchain',
      outflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          amount: '1',
          price: '12000',
          priceCurrency: 'CAD',
        },
      ],
      type: 'sell',
    });

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

    const result = await runCanadaAcbWorkflow({
      transactions: [acquisition, transferOut, transferIn, disposition],
      confirmedLinks: [confirmedTransferLink],
      priceRuntime: fxProvider,
    });
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
    const fxProvider = createCanadaPriceRuntime({ usdToCad: '1.4' });

    const acquisition = buildTransaction({
      id: 11,
      datetime: '2024-01-20T12:00:00Z',
      platformKey: 'coinbase',
      inflows: [
        {
          assetId: 'exchange:coinbase:eth',
          assetSymbol: 'ETH',
          amount: '2',
          price: '3000',
          priceSource: 'exchange-execution',
        },
      ],
      fees: [
        {
          assetId: 'fiat:usd',
          assetSymbol: 'USD' as Currency,
          amount: parseDecimal('10'),
          scope: 'platform',
          settlement: 'balance',
        },
      ],
    });

    const disposition = buildTransaction({
      id: 12,
      datetime: '2024-03-01T12:00:00Z',
      platformKey: 'coinbase',
      outflows: [
        {
          assetId: 'exchange:coinbase:eth',
          assetSymbol: 'ETH',
          amount: '2',
          price: '3500',
          priceSource: 'exchange-execution',
        },
      ],
      type: 'sell',
    });

    const result = await runCanadaAcbWorkflow({
      transactions: [acquisition, disposition],
      confirmedLinks: [],
      priceRuntime: fxProvider,
    });
    const value = assertOk(result);

    expect(value.inputContext.inputEvents).toHaveLength(2);
    expect(value.acbEngineResult.dispositions).toHaveLength(1);
    expect(value.acbEngineResult.dispositions[0]?.costBasisCad.toFixed()).toBe('8414');
    expect(value.acbEngineResult.dispositions[0]?.proceedsCad.toFixed()).toBe('9800');
    expect(value.acbEngineResult.dispositions[0]?.gainLossCad.toFixed()).toBe('1386');
    expect(value.acbEngineResult.pools[0]?.quantityHeld.toFixed()).toBe('0');
  });

  it('preserves basis through same-hash fee-only internal carryovers', async () => {
    const fxProvider = createCanadaPriceRuntime();

    const acquisition = buildTransaction({
      id: 21,
      datetime: '2024-01-01T12:00:00Z',
      platformKey: 'kraken',
      inflows: [
        {
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          amount: '1',
          price: '10000',
          priceCurrency: 'CAD',
          priceSource: 'exchange-execution',
        },
      ],
    });

    const internalSource = buildTransaction({
      id: 22,
      datetime: '2024-01-10T12:00:00Z',
      platformKey: 'bitcoin',
      platformKind: 'blockchain',
      blockchain: { name: 'bitcoin', transaction_hash: 'hash-fee-only', is_confirmed: true },
      outflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          amount: '1',
          netAmount: '0.99',
          price: '11000',
          priceCurrency: 'CAD',
        },
      ],
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
      category: 'transfer',
      type: 'withdrawal',
    });

    const internalTarget = buildTransaction({
      id: 23,
      accountId: 2,
      datetime: '2024-01-10T12:01:00Z',
      platformKey: 'bitcoin',
      platformKind: 'blockchain',
      blockchain: { name: 'bitcoin', transaction_hash: 'hash-fee-only', is_confirmed: true },
      inflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          amount: '0.99',
          price: '11000',
          priceCurrency: 'CAD',
        },
      ],
      category: 'transfer',
      type: 'deposit',
    });

    const disposition = buildTransaction({
      id: 24,
      accountId: 2,
      datetime: '2024-02-01T12:00:00Z',
      platformKey: 'bitcoin',
      platformKind: 'blockchain',
      outflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          amount: '0.99',
          price: '12000',
          priceCurrency: 'CAD',
        },
      ],
      type: 'sell',
    });

    const result = await runCanadaAcbWorkflow({
      transactions: [acquisition, internalSource, internalTarget, disposition],
      confirmedLinks: [],
      priceRuntime: fxProvider,
    });
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
    const fxProvider = createCanadaPriceRuntime();

    const excludedAcquisition = buildTransaction({
      id: 90,
      datetime: '2024-01-01T12:00:00Z',
      platformKey: 'spam-chain',
      platformKind: 'blockchain',
      inflows: [
        {
          assetId: 'blockchain:spam-chain:0xscam',
          assetSymbol: 'SCAM',
          amount: '1000',
          price: '0.01',
          priceCurrency: 'CAD',
        },
      ],
      category: 'transfer',
      type: 'deposit',
    });

    const result = await runCanadaAcbWorkflow({
      transactions: [excludedAcquisition],
      confirmedLinks: [],
      priceRuntime: fxProvider,
      accountingExclusionPolicy: createAccountingExclusionPolicy(['blockchain:spam-chain:0xscam']),
    });
    const value = assertOk(result);

    expect(value.inputContext.inputEvents).toEqual([]);
    expect(value.inputContext.scopedTransactionIds).toEqual([]);
    expect(value.acbEngineResult.dispositions).toHaveLength(0);
  });
});
