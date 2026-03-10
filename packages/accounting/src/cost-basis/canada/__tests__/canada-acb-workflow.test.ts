import type { UniversalTransactionData } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { createAccountingExclusionPolicy } from '../../shared/accounting-exclusion-policy.js';
import { runCanadaAcbWorkflow } from '../canada-acb-workflow.js';

import { createCanadaFxProvider, createConfirmedTransferLink } from './test-utils.js';

describe('runCanadaAcbWorkflow', () => {
  it('fails closed when same-chain blockchain tokens share a symbol across multiple asset IDs', async () => {
    const fxProvider = createCanadaFxProvider();

    const first: UniversalTransactionData = {
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

    const second: UniversalTransactionData = {
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

    const result = await runCanadaAcbWorkflow([first, second], [], fxProvider);

    expect(assertErr(result).message).toContain('Ambiguous on-chain asset symbols require review');
  });

  it('preserves pooled ACB across a confirmed internal transfer and later disposition', async () => {
    const fxProvider = createCanadaFxProvider();

    const acquisition: UniversalTransactionData = {
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

    const transferOut: UniversalTransactionData = {
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

    const transferIn: UniversalTransactionData = {
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

    const disposition: UniversalTransactionData = {
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

    const acquisition: UniversalTransactionData = {
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

    const disposition: UniversalTransactionData = {
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

    const acquisition: UniversalTransactionData = {
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

    const internalSource: UniversalTransactionData = {
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

    const internalTarget: UniversalTransactionData = {
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

    const disposition: UniversalTransactionData = {
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

    const excludedAcquisition: UniversalTransactionData = {
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
