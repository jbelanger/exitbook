/* eslint-disable @typescript-eslint/unbound-method -- acceptable in tests */
import type { UniversalTransactionData } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { buildCanadaTestInputContext, createCanadaFxProvider, createConfirmedTransferLink } from './test-utils.js';

describe('buildCanadaTaxInputContext', () => {
  it('uses preserved quoted CAD price without fetching USD->CAD FX', async () => {
    const fxProvider = createCanadaFxProvider();
    const transaction: UniversalTransactionData = {
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
    const transaction: UniversalTransactionData = {
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
    const withdrawal: UniversalTransactionData = {
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

    const deposit: UniversalTransactionData = {
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
          (event): event is Exclude<(typeof context.inputEvents)[number], { kind: 'fee-adjustment' }> =>
            event.kind !== 'fee-adjustment'
        )
        .map((event) => event.quantity.toFixed())
    ).toEqual(['1', '1']);
  });

  it('resolves fee identity and emits same-asset transfer fee adjustments', async () => {
    const fxProvider = createCanadaFxProvider();
    const withdrawal: UniversalTransactionData = {
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

    const deposit: UniversalTransactionData = {
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

  it('supports relaxed and strict USDC identity policies from the same imported facts', async () => {
    const fxProvider = createCanadaFxProvider();
    const exchangeAcquisition: UniversalTransactionData = {
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

    const chainAcquisition: UniversalTransactionData = {
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
      taxAssetIdentityPolicy: 'strict',
    });
    const strictContext = assertOk(strictResult);
    expect(new Set(strictContext.inputEvents.map((event) => event.taxPropertyKey))).toEqual(
      new Set(['ca:usdc', 'ca:blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'])
    );
  });
});
