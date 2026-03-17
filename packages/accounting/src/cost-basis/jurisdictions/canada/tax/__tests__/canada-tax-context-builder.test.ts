/* eslint-disable @typescript-eslint/unbound-method -- acceptable in tests */
import type { Transaction } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import {
  buildCanadaTestInputContext,
  createCanadaFxProvider,
  createConfirmedTransferLink,
  noopLogger,
} from '../../__tests__/test-utils.js';
import { buildCostBasisScopedTransactions } from '../../../../standard/matching/build-cost-basis-scoped-transactions.js';
import type { ValidatedScopedTransferSet } from '../../../../standard/matching/validated-scoped-transfer-links.js';
import { getJurisdictionConfig } from '../../../jurisdiction-configs.js';
import { buildCanadaTaxInputContext } from '../canada-tax-context-builder.js';

describe('buildCanadaTaxInputContext', () => {
  it('uses preserved quoted CAD price without fetching USD->CAD FX', async () => {
    const fxProvider = createCanadaFxProvider();
    const transaction: Transaction = {
      id: 1,
      accountId: 1,
      externalId: 'tx-1',
      datetime: '2024-01-15T12:00:00Z',
      timestamp: Date.parse('2024-01-15T12:00:00Z'),
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
              price: { amount: parseDecimal('48100'), currency: 'USD' as Currency },
              quotedPrice: { amount: parseDecimal('65000'), currency: 'CAD' as Currency },
              source: 'derived-ratio',
              fetchedAt: new Date('2024-01-15T12:00:00Z'),
              granularity: 'exact',
              fxRateToUSD: parseDecimal('0.74'),
              fxSource: 'bank-of-canada',
              fxTimestamp: new Date('2024-01-15T12:00:00Z'),
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'trade', type: 'buy' },
    };

    const result = await buildCanadaTestInputContext([transaction], [], fxProvider);
    const context = assertOk(result);

    expect(context.scopedTransactionIds).toEqual([1]);
    expect(context.validatedTransferLinkIds).toEqual([]);
    expect(context.feeOnlyInternalCarryoverSourceTransactionIds).toEqual([]);
    expect(context.inputEvents).toHaveLength(1);
    expect(context.inputEvents[0]?.kind).toBe('acquisition');
    expect(context.inputEvents[0]?.taxPropertyKey).toBe('ca:btc');
    expect(context.inputEvents[0]?.valuation.unitValueCad.toFixed()).toBe('65000');
    expect(context.inputEvents[0]?.valuation.totalValueCad.toFixed()).toBe('65000');
    expect(context.inputEvents[0]?.valuation.valuationSource).toBe('quoted-price');
    expect(fxProvider.getRateFromUSD).not.toHaveBeenCalled();
  });

  it('rolls acquisition fees into cost basis adjustments in CAD', async () => {
    const fxProvider = createCanadaFxProvider({ usdToCad: '1.4' });
    const transaction: Transaction = {
      id: 2,
      accountId: 1,
      externalId: 'tx-2',
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

    const result = await buildCanadaTestInputContext([transaction], [], fxProvider);
    const context = assertOk(result);
    const acquisition = context.inputEvents[0];

    expect(context.inputEvents).toHaveLength(1);
    expect(acquisition?.kind).toBe('acquisition');
    expect(acquisition?.valuation.unitValueCad.toFixed()).toBe('4200');
    expect(acquisition?.valuation.totalValueCad.toFixed()).toBe('8400');
    expect(
      acquisition && 'costBasisAdjustmentCad' in acquisition ? acquisition.costBasisAdjustmentCad?.toFixed() : undefined
    ).toBe('14');
    expect(fxProvider.getRateFromUSD).toHaveBeenCalledTimes(2);
  });

  it('converts confirmed internal links into transfer events instead of acquisitions or dispositions', async () => {
    const fxProvider = createCanadaFxProvider();
    const withdrawal: Transaction = {
      id: 10,
      accountId: 1,
      externalId: 'tx-10',
      datetime: '2024-02-01T12:00:00Z',
      timestamp: Date.parse('2024-02-01T12:00:00Z'),
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
              price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2024-02-01T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
      },
      fees: [],
      operation: { category: 'transfer', type: 'withdrawal' },
    };

    const deposit: Transaction = {
      id: 11,
      accountId: 2,
      externalId: 'tx-11',
      datetime: '2024-02-01T12:05:00Z',
      timestamp: Date.parse('2024-02-01T12:05:00Z'),
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
              price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
              source: 'link-propagated',
              fetchedAt: new Date('2024-02-01T12:05:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const confirmedLink = createConfirmedTransferLink({
      id: 99,
      sourceAmount: '1',
      sourceAssetId: 'exchange:kraken:btc',
      sourceTransaction: withdrawal,
      targetAmount: '1',
      targetAssetId: 'blockchain:bitcoin:native',
      targetTransaction: deposit,
      assetSymbol: 'BTC' as Currency,
    });

    const result = await buildCanadaTestInputContext([withdrawal, deposit], [confirmedLink], fxProvider);
    const context = assertOk(result);

    expect(context.validatedTransferLinkIds).toEqual([99]);
    expect(context.inputEvents).toHaveLength(2);
    expect(context.inputEvents.map((event) => event.kind)).toEqual(['transfer-out', 'transfer-in']);
    expect(
      context.inputEvents
        .filter(
          (
            event
          ): event is Exclude<
            (typeof context.inputEvents)[number],
            { kind: 'fee-adjustment' | 'superficial-loss-adjustment' }
          > => event.kind !== 'fee-adjustment' && event.kind !== 'superficial-loss-adjustment'
        )
        .map((event) => event.quantity.toFixed())
    ).toEqual(['1', '1']);
  });

  it('resolves fee identity and emits same-asset transfer fee adjustments', async () => {
    const fxProvider = createCanadaFxProvider();
    const withdrawal: Transaction = {
      id: 20,
      accountId: 1,
      externalId: 'tx-20',
      datetime: '2024-02-10T12:00:00Z',
      timestamp: Date.parse('2024-02-10T12:00:00Z'),
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
            netAmount: parseDecimal('0.99'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: 'CAD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2024-02-10T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
      },
      fees: [
        {
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('0.01'),
          scope: 'network',
          settlement: 'on-chain',
          priceAtTxTime: {
            price: { amount: parseDecimal('50000'), currency: 'CAD' as Currency },
            source: 'exchange-execution',
            fetchedAt: new Date('2024-02-10T12:00:00Z'),
            granularity: 'exact',
          },
        },
      ],
      operation: { category: 'transfer', type: 'withdrawal' },
    };

    const deposit: Transaction = {
      id: 21,
      accountId: 2,
      externalId: 'tx-21',
      datetime: '2024-02-10T12:05:00Z',
      timestamp: Date.parse('2024-02-10T12:05:00Z'),
      source: 'bitcoin',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.99'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: 'CAD' as Currency },
              source: 'link-propagated',
              fetchedAt: new Date('2024-02-10T12:05:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const confirmedLink = createConfirmedTransferLink({
      id: 199,
      sourceAmount: '0.99',
      sourceAssetId: 'exchange:kraken:btc',
      sourceTransaction: withdrawal,
      targetAmount: '0.99',
      targetAssetId: 'blockchain:bitcoin:native',
      targetTransaction: deposit,
      assetSymbol: 'BTC' as Currency,
    });

    const result = await buildCanadaTestInputContext([withdrawal, deposit], [confirmedLink], fxProvider);
    const context = assertOk(result);
    const feeAdjustment = context.inputEvents.find(
      (event): event is Extract<(typeof context.inputEvents)[number], { kind: 'fee-adjustment' }> =>
        event.kind === 'fee-adjustment'
    );

    expect(context.inputEvents.map((event) => event.kind)).toEqual(['transfer-out', 'fee-adjustment', 'transfer-in']);
    expect(feeAdjustment?.adjustmentType).toBe('same-asset-transfer-fee-add-to-basis');
    expect(feeAdjustment?.feeAssetIdentityKey).toBe('btc');
    expect(feeAdjustment?.feeQuantity.toFixed()).toBe('0.01');
    expect(feeAdjustment?.quantityReduced?.toFixed()).toBe('0.01');
    expect(feeAdjustment?.valuation.totalValueCad.toFixed()).toBe('500');
  });

  it('allocates same-asset network fees once across internal transfer and residual disposition shares', async () => {
    const fxProvider = createCanadaFxProvider();
    const withdrawal: Transaction = {
      id: 25,
      accountId: 1,
      externalId: 'tx-25',
      datetime: '2024-02-12T12:00:00Z',
      timestamp: Date.parse('2024-02-12T12:00:00Z'),
      source: 'kraken',
      sourceType: 'exchange',
      status: 'success',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1.2'),
            netAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('100'), currency: 'CAD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2024-02-12T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
      },
      fees: [
        {
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('0.2'),
          scope: 'network',
          settlement: 'on-chain',
          priceAtTxTime: {
            price: { amount: parseDecimal('100'), currency: 'CAD' as Currency },
            source: 'exchange-execution',
            fetchedAt: new Date('2024-02-12T12:00:00Z'),
            granularity: 'exact',
          },
        },
      ],
      operation: { category: 'transfer', type: 'withdrawal' },
    };

    const deposit: Transaction = {
      id: 26,
      accountId: 2,
      externalId: 'tx-26',
      datetime: '2024-02-12T12:05:00Z',
      timestamp: Date.parse('2024-02-12T12:05:00Z'),
      source: 'bitcoin',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.4'),
            priceAtTxTime: {
              price: { amount: parseDecimal('100'), currency: 'CAD' as Currency },
              source: 'link-propagated',
              fetchedAt: new Date('2024-02-12T12:05:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const confirmedLink = createConfirmedTransferLink({
      id: 250,
      sourceAmount: '0.4',
      sourceAssetId: 'exchange:kraken:btc',
      sourceTransaction: withdrawal,
      targetAmount: '0.4',
      targetAssetId: 'blockchain:bitcoin:native',
      targetTransaction: deposit,
      assetSymbol: 'BTC' as Currency,
      metadata: {
        partialMatch: true,
        fullSourceAmount: '1',
        fullTargetAmount: '0.4',
        consumedAmount: '0.4',
      },
    });

    const scopedResult = buildCostBasisScopedTransactions([withdrawal, deposit], noopLogger);
    const scoped = assertOk(scopedResult);
    const canadaConfig = getJurisdictionConfig('CA');
    if (!canadaConfig) {
      throw new Error('Canada jurisdiction config is not registered');
    }

    const sourceMovementFingerprint = confirmedLink.sourceMovementFingerprint;
    const targetMovementFingerprint = confirmedLink.targetMovementFingerprint;
    const validatedLink = {
      isPartialMatch: true,
      link: confirmedLink,
      sourceAssetId: 'exchange:kraken:btc',
      sourceMovementAmount: parseDecimal('1'),
      sourceMovementFingerprint,
      targetAssetId: 'blockchain:bitcoin:native',
      targetMovementAmount: parseDecimal('0.4'),
      targetMovementFingerprint,
    };
    const validatedTransfers: ValidatedScopedTransferSet = {
      links: [validatedLink],
      bySourceMovementFingerprint: new Map([[sourceMovementFingerprint, [validatedLink]]]),
      byTargetMovementFingerprint: new Map([[targetMovementFingerprint, [validatedLink]]]),
    };

    const result = await buildCanadaTaxInputContext(
      scoped.transactions,
      validatedTransfers,
      scoped.feeOnlyInternalCarryovers,
      fxProvider,
      {
        taxAssetIdentityPolicy: canadaConfig.taxAssetIdentityPolicy,
        relaxedTaxIdentitySymbols: canadaConfig.relaxedTaxIdentitySymbols,
      }
    );
    const context = assertOk(result);
    const disposition = context.inputEvents.find(
      (event): event is Extract<(typeof context.inputEvents)[number], { kind: 'disposition' }> =>
        event.kind === 'disposition'
    );
    const feeAdjustment = context.inputEvents.find(
      (event): event is Extract<(typeof context.inputEvents)[number], { kind: 'fee-adjustment' }> =>
        event.kind === 'fee-adjustment'
    );

    expect(context.inputEvents.map((event) => event.kind)).toEqual([
      'transfer-out',
      'disposition',
      'fee-adjustment',
      'transfer-in',
    ]);
    expect(disposition?.quantity.toFixed()).toBe('0.6');
    expect(disposition?.proceedsReductionCad?.toFixed()).toBe('12');
    expect(feeAdjustment?.quantityReduced?.toFixed()).toBe('0.08');
    expect(feeAdjustment?.valuation.totalValueCad.toFixed()).toBe('8');
    expect(
      disposition && feeAdjustment
        ? disposition.proceedsReductionCad?.plus(feeAdjustment.valuation.totalValueCad).toFixed()
        : undefined
    ).toBe('20');
  });

  it('emits link-scoped same-asset fee adjustments when one source movement fans out to multiple links', async () => {
    const fxProvider = createCanadaFxProvider();
    const withdrawal: Transaction = {
      id: 27,
      accountId: 1,
      externalId: 'tx-27',
      datetime: '2024-02-13T12:00:00Z',
      timestamp: Date.parse('2024-02-13T12:00:00Z'),
      source: 'kraken',
      sourceType: 'exchange',
      status: 'success',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1.02'),
            netAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('100'), currency: 'CAD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2024-02-13T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
      },
      fees: [
        {
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('0.02'),
          scope: 'network',
          settlement: 'on-chain',
          priceAtTxTime: {
            price: { amount: parseDecimal('100'), currency: 'CAD' as Currency },
            source: 'exchange-execution',
            fetchedAt: new Date('2024-02-13T12:00:00Z'),
            granularity: 'exact',
          },
        },
      ],
      operation: { category: 'transfer', type: 'withdrawal' },
    };

    const firstDeposit: Transaction = {
      id: 28,
      accountId: 2,
      externalId: 'tx-28',
      datetime: '2024-02-13T12:05:00Z',
      timestamp: Date.parse('2024-02-13T12:05:00Z'),
      source: 'bitcoin',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.4'),
            priceAtTxTime: {
              price: { amount: parseDecimal('100'), currency: 'CAD' as Currency },
              source: 'link-propagated',
              fetchedAt: new Date('2024-02-13T12:05:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const secondDeposit: Transaction = {
      id: 29,
      accountId: 3,
      externalId: 'tx-29',
      datetime: '2024-02-13T12:06:00Z',
      timestamp: Date.parse('2024-02-13T12:06:00Z'),
      source: 'bitcoin',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.6'),
            priceAtTxTime: {
              price: { amount: parseDecimal('100'), currency: 'CAD' as Currency },
              source: 'link-propagated',
              fetchedAt: new Date('2024-02-13T12:06:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const firstLink = createConfirmedTransferLink({
      id: 270,
      sourceAmount: '0.4',
      sourceAssetId: 'exchange:kraken:btc',
      sourceTransaction: withdrawal,
      targetAmount: '0.4',
      targetAssetId: 'blockchain:bitcoin:native',
      targetTransaction: firstDeposit,
      assetSymbol: 'BTC' as Currency,
      metadata: {
        partialMatch: true,
        fullSourceAmount: '1',
        fullTargetAmount: '0.4',
        consumedAmount: '0.4',
      },
    });
    const secondLink = createConfirmedTransferLink({
      id: 271,
      sourceAmount: '0.6',
      sourceAssetId: 'exchange:kraken:btc',
      sourceTransaction: withdrawal,
      targetAmount: '0.6',
      targetAssetId: 'blockchain:bitcoin:native',
      targetTransaction: secondDeposit,
      assetSymbol: 'BTC' as Currency,
      metadata: {
        partialMatch: true,
        fullSourceAmount: '1',
        fullTargetAmount: '0.6',
        consumedAmount: '0.6',
      },
    });

    const result = await buildCanadaTestInputContext(
      [withdrawal, firstDeposit, secondDeposit],
      [firstLink, secondLink],
      fxProvider
    );
    const context = assertOk(result);
    const feeAdjustments = context.inputEvents.filter(
      (event): event is Extract<(typeof context.inputEvents)[number], { kind: 'fee-adjustment' }> =>
        event.kind === 'fee-adjustment'
    );

    expect(feeAdjustments).toHaveLength(2);
    expect(feeAdjustments.map((event) => event.linkId)).toEqual([270, 271]);
    expect(feeAdjustments.map((event) => event.relatedEventId)).toEqual([
      'link:270:transfer-out',
      'link:271:transfer-out',
    ]);
    expect(feeAdjustments.map((event) => event.targetMovementFingerprint)).toEqual([
      firstLink.targetMovementFingerprint,
      secondLink.targetMovementFingerprint,
    ]);
    expect(feeAdjustments.map((event) => event.feeQuantity.toFixed())).toEqual(['0.008', '0.012']);
    expect(feeAdjustments.map((event) => event.valuation.totalValueCad.toFixed())).toEqual(['0.8', '1.2']);
  });

  it('supports relaxed and strict-onchain-token USDC identity policies from the same imported facts', async () => {
    const fxProvider = createCanadaFxProvider();
    const exchangeAcquisition: Transaction = {
      id: 30,
      accountId: 1,
      externalId: 'tx-30',
      datetime: '2024-01-25T12:00:00Z',
      timestamp: Date.parse('2024-01-25T12:00:00Z'),
      source: 'coinbase',
      sourceType: 'exchange',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'exchange:coinbase:usdc',
            assetSymbol: 'USDC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('1'), currency: 'USD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2024-01-25T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'trade', type: 'deposit' },
    };

    const chainAcquisition: Transaction = {
      id: 31,
      accountId: 2,
      externalId: 'tx-31',
      datetime: '2024-01-26T12:00:00Z',
      timestamp: Date.parse('2024-01-26T12:00:00Z'),
      source: 'ethereum',
      sourceType: 'blockchain',
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            assetSymbol: 'USDC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('1'), currency: 'USD' as Currency },
              source: 'manual',
              fetchedAt: new Date('2024-01-26T12:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'trade', type: 'deposit' },
    };

    const relaxedResult = await buildCanadaTestInputContext([exchangeAcquisition, chainAcquisition], [], fxProvider);
    const relaxedContext = assertOk(relaxedResult);
    expect(new Set(relaxedContext.inputEvents.map((event) => event.taxPropertyKey))).toEqual(new Set(['ca:usdc']));

    const strictResult = await buildCanadaTestInputContext([exchangeAcquisition, chainAcquisition], [], fxProvider, {
      relaxedTaxIdentitySymbols: [],
      taxAssetIdentityPolicy: 'strict-onchain-tokens',
    });
    const strictContext = assertOk(strictResult);
    expect(new Set(strictContext.inputEvents.map((event) => event.taxPropertyKey))).toEqual(
      new Set(['ca:usdc', 'ca:blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'])
    );
  });
});
