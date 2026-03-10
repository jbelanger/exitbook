import type { TransactionLink } from '@exitbook/accounting';
import type { Currency, UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { analyzeLinkGaps } from '../command/links-gap-utils.js';

describe('analyzeLinkGaps', () => {
  const selfAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const serviceInAddress = '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed';
  const serviceOutAddress = '0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef';

  const createMockTransaction = (overrides: Partial<UniversalTransactionData> = {}): UniversalTransactionData => ({
    id: 1,
    accountId: 1,
    externalId: 'tx-123',
    datetime: '2024-01-01T12:00:00Z',
    timestamp: 1704110400000,
    source: 'kraken',
    sourceType: 'exchange',
    status: 'success',
    movements: {
      inflows: [],
      outflows: [],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'withdrawal',
    },
    ...overrides,
  });

  const createBlockchainDeposit = (overrides: Partial<UniversalTransactionData> = {}): UniversalTransactionData =>
    createMockTransaction({
      id: 11,
      externalId: 'btc-inflow',
      source: 'bitcoin',
      blockchain: {
        name: 'bitcoin',
        transaction_hash: 'hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.8'),
            netAmount: parseDecimal('0.8'),
          },
        ],
        outflows: [],
      },
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
      ...overrides,
    });

  const createBlockchainWithdrawal = (overrides: Partial<UniversalTransactionData> = {}): UniversalTransactionData =>
    createMockTransaction({
      id: 21,
      externalId: 'btc-outflow',
      source: 'bitcoin',
      blockchain: {
        name: 'bitcoin',
        transaction_hash: 'hash-out',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.5'),
            netAmount: parseDecimal('0.5'),
          },
        ],
      },
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
      ...overrides,
    });

  const createExchangeWithdrawal = (overrides: Partial<UniversalTransactionData> = {}): UniversalTransactionData =>
    createMockTransaction({
      id: 31,
      externalId: 'kraken-outflow',
      source: 'kraken',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('5'),
            netAmount: parseDecimal('5'),
          },
        ],
      },
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
      ...overrides,
    });

  const createBlockchainSwap = (overrides: Partial<UniversalTransactionData> = {}): UniversalTransactionData =>
    createMockTransaction({
      id: 41,
      accountId: 1,
      externalId: 'eth-swap',
      source: 'ethereum',
      sourceType: 'blockchain',
      datetime: '2026-02-05T04:08:59.000Z',
      timestamp: Date.parse('2026-02-05T04:08:59.000Z'),
      from: selfAddress,
      to: serviceOutAddress,
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'swap-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:aave',
            assetSymbol: 'AAVE' as Currency,
            grossAmount: parseDecimal('1.9'),
            netAmount: parseDecimal('1.9'),
          },
        ],
        outflows: [
          {
            assetId: 'blockchain:ethereum:rsr',
            assetSymbol: 'RSR' as Currency,
            grossAmount: parseDecimal('135000'),
            netAmount: parseDecimal('135000'),
          },
        ],
      },
      operation: {
        category: 'trade',
        type: 'swap',
      },
      ...overrides,
    });

  const createMockLink = (params: {
    assetSymbol: string;
    confidenceScore: string;
    id: number;
    linkType: TransactionLink['linkType'];
    sourceAmount: string;
    sourceAssetId: string;
    sourceTransactionId: number;
    targetAmount: string;
    targetAssetId: string;
    targetTransactionId: number;
  }): TransactionLink => ({
    id: params.id,
    sourceTransactionId: params.sourceTransactionId,
    targetTransactionId: params.targetTransactionId,
    assetSymbol: params.assetSymbol as Currency,
    sourceAssetId: params.sourceAssetId,
    targetAssetId: params.targetAssetId,
    sourceAmount: parseDecimal(params.sourceAmount),
    targetAmount: parseDecimal(params.targetAmount),
    sourceMovementFingerprint: `movement:${params.sourceAssetId}:${params.sourceTransactionId}:outflow:0`,
    targetMovementFingerprint: `movement:${params.targetAssetId}:${params.targetTransactionId}:inflow:0`,
    linkType: params.linkType,
    confidenceScore: parseDecimal(params.confidenceScore),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('0.99'),
      timingValid: true,
      timingHours: 1,
      addressMatch: true,
    },
    status: 'confirmed',
    reviewedBy: undefined,
    reviewedAt: undefined,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    metadata: undefined,
  });

  it('should flag deposits without confirmed links', () => {
    const transactions: UniversalTransactionData[] = [createBlockchainDeposit()];
    const links: TransactionLink[] = [];

    const analysis = analyzeLinkGaps(transactions, links);

    expect(analysis.summary.total_issues).toBe(1);
    expect(analysis.summary.uncovered_inflows).toBe(1);
    expect(analysis.summary.unmatched_outflows).toBe(0);
    expect(analysis.summary.affected_assets).toBe(1);
    expect(analysis.issues[0]!.assetSymbol).toBe('BTC');
    expect(analysis.issues[0]!.missingAmount).toBe('0.8');
    expect(analysis.issues[0]!.totalAmount).toBe('0.8');
    expect(analysis.issues[0]!.direction).toBe('inflow');
    expect(analysis.summary.assets[0]).toStrictEqual({
      assetSymbol: 'BTC',
      inflowOccurrences: 1,
      inflowMissingAmount: '0.8',
      outflowOccurrences: 0,
      outflowMissingAmount: '0',
    });
  });

  it('should treat confirmed links as coverage', () => {
    const transactions: UniversalTransactionData[] = [createBlockchainDeposit()];
    const links: TransactionLink[] = [
      createMockLink({
        id: 1,
        sourceTransactionId: 5,
        targetTransactionId: 11,
        assetSymbol: 'BTC',
        sourceAssetId: 'exchange:source:btc',
        targetAssetId: 'blockchain:target:btc',
        sourceAmount: '0.8',
        targetAmount: '0.8',
        linkType: 'exchange_to_blockchain',
        confidenceScore: '0.97',
      }),
    ];

    const analysis = analyzeLinkGaps(transactions, links);

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
    expect(analysis.summary.assets).toHaveLength(0);
  });

  it('should ignore reward transactions', () => {
    const transactions: UniversalTransactionData[] = [
      createBlockchainDeposit({
        id: 20,
        operation: {
          category: 'staking',
          type: 'reward',
        },
      }),
    ];
    const links: TransactionLink[] = [];

    const analysis = analyzeLinkGaps(transactions, links);

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
  });

  it('should flag withdrawals without confirmed links', () => {
    const transactions: UniversalTransactionData[] = [createBlockchainWithdrawal()];
    const links: TransactionLink[] = [];

    const analysis = analyzeLinkGaps(transactions, links);

    expect(analysis.summary.total_issues).toBe(1);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(1);
    expect(analysis.summary.affected_assets).toBe(1);
    const issue = analysis.issues[0]!;
    expect(issue.assetSymbol).toBe('BTC');
    expect(issue.missingAmount).toBe('0.5');
    expect(issue.totalAmount).toBe('0.5');
    expect(issue.direction).toBe('outflow');
    expect(analysis.summary.assets[0]).toStrictEqual({
      assetSymbol: 'BTC',
      inflowOccurrences: 0,
      inflowMissingAmount: '0',
      outflowOccurrences: 1,
      outflowMissingAmount: '0.5',
    });
  });

  it('should suppress nearby one-sided blockchain flows when they look like a service-mediated cross-asset flow', () => {
    const syrupDeposit = createBlockchainDeposit({
      id: 101,
      accountId: 7,
      externalId: 'syrup-deposit',
      source: 'ethereum',
      sourceType: 'blockchain',
      datetime: '2026-02-05T03:51:35.000Z',
      timestamp: Date.parse('2026-02-05T03:51:35.000Z'),
      from: serviceInAddress,
      to: selfAddress,
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'syrup-deposit-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:syrup',
            assetSymbol: 'SYRUP' as Currency,
            grossAmount: parseDecimal('829.908183876325994303'),
            netAmount: parseDecimal('829.908183876325994303'),
          },
        ],
        outflows: [],
      },
    });
    const swap = createBlockchainSwap({
      id: 102,
      accountId: 7,
      externalId: 'service-swap',
      datetime: '2026-02-05T04:08:59.000Z',
      timestamp: Date.parse('2026-02-05T04:08:59.000Z'),
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'service-swap-hash',
        is_confirmed: true,
      },
    });
    const rsrWithdrawal = createBlockchainWithdrawal({
      id: 103,
      accountId: 7,
      externalId: 'rsr-withdrawal',
      source: 'ethereum',
      sourceType: 'blockchain',
      datetime: '2026-02-05T04:38:47.000Z',
      timestamp: Date.parse('2026-02-05T04:38:47.000Z'),
      from: selfAddress,
      to: serviceOutAddress,
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'rsr-withdrawal-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:rsr',
            assetSymbol: 'RSR' as Currency,
            grossAmount: parseDecimal('134544.8442'),
            netAmount: parseDecimal('134544.8442'),
          },
        ],
      },
    });

    const analysis = analyzeLinkGaps([syrupDeposit, swap, rsrWithdrawal], []);

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
    expect(analysis.summary.assets).toHaveLength(0);
  });

  it('should keep one-sided blockchain flows when no nearby swap supports service-flow suppression', () => {
    const syrupDeposit = createBlockchainDeposit({
      id: 111,
      accountId: 7,
      externalId: 'syrup-deposit-no-swap',
      source: 'ethereum',
      sourceType: 'blockchain',
      datetime: '2026-02-05T03:51:35.000Z',
      timestamp: Date.parse('2026-02-05T03:51:35.000Z'),
      from: serviceInAddress,
      to: selfAddress,
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'syrup-deposit-no-swap-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:syrup',
            assetSymbol: 'SYRUP' as Currency,
            grossAmount: parseDecimal('829.908183876325994303'),
            netAmount: parseDecimal('829.908183876325994303'),
          },
        ],
        outflows: [],
      },
    });
    const rsrWithdrawal = createBlockchainWithdrawal({
      id: 112,
      accountId: 7,
      externalId: 'rsr-withdrawal-no-swap',
      source: 'ethereum',
      sourceType: 'blockchain',
      datetime: '2026-02-05T04:38:47.000Z',
      timestamp: Date.parse('2026-02-05T04:38:47.000Z'),
      from: selfAddress,
      to: serviceOutAddress,
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'rsr-withdrawal-no-swap-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:rsr',
            assetSymbol: 'RSR' as Currency,
            grossAmount: parseDecimal('134544.8442'),
            netAmount: parseDecimal('134544.8442'),
          },
        ],
      },
    });

    const analysis = analyzeLinkGaps([syrupDeposit, rsrWithdrawal], []);

    expect(analysis.summary.total_issues).toBe(2);
    expect(analysis.summary.uncovered_inflows).toBe(1);
    expect(analysis.summary.unmatched_outflows).toBe(1);
    expect(analysis.summary.assets).toStrictEqual([
      {
        assetSymbol: 'RSR',
        inflowOccurrences: 0,
        inflowMissingAmount: '0',
        outflowOccurrences: 1,
        outflowMissingAmount: '134544.8442',
      },
      {
        assetSymbol: 'SYRUP',
        inflowOccurrences: 1,
        inflowMissingAmount: '829.908183876325994303',
        outflowOccurrences: 0,
        outflowMissingAmount: '0',
      },
    ]);
  });

  it('should treat confirmed links as coverage for withdrawals', () => {
    const withdrawal = createBlockchainWithdrawal({ id: 22, externalId: 'btc-outflow-2' });
    const transactions: UniversalTransactionData[] = [withdrawal];
    const links: TransactionLink[] = [
      createMockLink({
        id: 1,
        sourceTransactionId: withdrawal.id ?? 0,
        targetTransactionId: 42,
        assetSymbol: 'BTC',
        sourceAssetId: 'blockchain:source:btc',
        targetAssetId: 'blockchain:target:btc',
        sourceAmount: '0.5',
        targetAmount: '0.5',
        linkType: 'blockchain_to_blockchain',
        confidenceScore: '0.95',
      }),
    ];

    const analysis = analyzeLinkGaps(transactions, links);

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
  });

  it('should flag exchange withdrawals without confirmed links', () => {
    const transactions: UniversalTransactionData[] = [createExchangeWithdrawal()];
    const links: TransactionLink[] = [];

    const analysis = analyzeLinkGaps(transactions, links);

    expect(analysis.summary.total_issues).toBe(1);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(1);
    expect(analysis.summary.affected_assets).toBe(1);
    const issue = analysis.issues[0]!;
    expect(issue.assetSymbol).toBe('ETH');
    expect(issue.direction).toBe('outflow');
    expect(issue.missingAmount).toBe('5');
    expect(issue.totalAmount).toBe('5');
    expect(analysis.summary.assets[0]).toStrictEqual({
      assetSymbol: 'ETH',
      inflowOccurrences: 0,
      inflowMissingAmount: '0',
      outflowOccurrences: 1,
      outflowMissingAmount: '5',
    });
  });

  it('should treat confirmed links as coverage for exchange withdrawals', () => {
    const withdrawal = createExchangeWithdrawal({ id: 32, externalId: 'kraken-outflow-2' });
    const transactions: UniversalTransactionData[] = [withdrawal];
    const links: TransactionLink[] = [
      createMockLink({
        id: 1,
        sourceTransactionId: withdrawal.id ?? 0,
        targetTransactionId: 77,
        assetSymbol: 'ETH',
        sourceAssetId: 'exchange:source:eth',
        targetAssetId: 'blockchain:target:eth',
        sourceAmount: '5',
        targetAmount: '5',
        linkType: 'exchange_to_blockchain',
        confidenceScore: '0.92',
      }),
    ];

    const analysis = analyzeLinkGaps(transactions, links);

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
  });
});
