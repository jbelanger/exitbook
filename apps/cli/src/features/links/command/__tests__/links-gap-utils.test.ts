import type { TransactionLink } from '@exitbook/accounting';
import type { Account, Currency, Transaction, TransactionDraft } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';
import { analyzeLinkGaps } from '../links-gap-utils.js';

describe('analyzeLinkGaps', () => {
  const selfAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const serviceInAddress = '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed';
  const serviceOutAddress = '0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef';

  const createMockAccount = (
    overrides: Partial<Pick<Account, 'id' | 'identifier' | 'userId'>> = {}
  ): Pick<Account, 'id' | 'identifier' | 'userId'> => ({
    id: overrides.id ?? 1,
    identifier: overrides.identifier ?? selfAddress,
    userId: overrides.userId ?? 1,
  });

  const createMockTransaction = (
    overrides: Omit<Partial<Transaction>, 'movements' | 'fees'> & {
      fees?: TransactionDraft['fees'];
      movements?: TransactionDraft['movements'];
    } = {}
  ): Transaction =>
    createPersistedTransaction({
      id: 1,
      accountId: 1,
      txFingerprint: String(overrides.txFingerprint ?? 'tx-123'),
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

  const createBlockchainDeposit = (
    overrides: Omit<Partial<Transaction>, 'movements' | 'fees'> & {
      fees?: TransactionDraft['fees'];
      movements?: TransactionDraft['movements'];
    } = {}
  ): Transaction =>
    createMockTransaction({
      id: 11,
      txFingerprint: 'btc-inflow',
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

  const createBlockchainWithdrawal = (
    overrides: Omit<Partial<Transaction>, 'movements' | 'fees'> & {
      fees?: TransactionDraft['fees'];
      movements?: TransactionDraft['movements'];
    } = {}
  ): Transaction =>
    createMockTransaction({
      id: 21,
      txFingerprint: 'btc-outflow',
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

  const createExchangeWithdrawal = (
    overrides: Omit<Partial<Transaction>, 'movements' | 'fees'> & {
      fees?: TransactionDraft['fees'];
      movements?: TransactionDraft['movements'];
    } = {}
  ): Transaction =>
    createMockTransaction({
      id: 31,
      txFingerprint: 'kraken-outflow',
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

  const createBlockchainSwap = (overrides: Partial<Transaction> = {}): Transaction =>
    createMockTransaction({
      id: 41,
      accountId: 1,
      txFingerprint: 'eth-swap',
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
    const transactions: Transaction[] = [createBlockchainDeposit()];
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
    const transactions: Transaction[] = [createBlockchainDeposit()];
    const links: TransactionLink[] = [
      createMockLink({
        id: 1,
        sourceTransactionId: 5,
        targetTransactionId: 11,
        assetSymbol: 'BTC',
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
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

  it('should treat confirmed migration links as coverage based on asset ids even when symbols differ', () => {
    const renderDeposit = createBlockchainDeposit({
      id: 8813,
      txFingerprint: 'render-deposit',
      source: 'ethereum',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'render-migration-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('19.5536'),
            netAmount: parseDecimal('19.5536'),
          },
        ],
        outflows: [],
      },
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    });
    const links: TransactionLink[] = [
      createMockLink({
        id: 1,
        sourceTransactionId: 9005,
        targetTransactionId: 8813,
        assetSymbol: 'RNDR',
        sourceAssetId: 'exchange:kucoin:rndr',
        targetAssetId: 'blockchain:ethereum:0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24',
        sourceAmount: '19.5536',
        targetAmount: '19.5536',
        linkType: 'exchange_to_blockchain',
        confidenceScore: '1',
      }),
    ];

    const analysis = analyzeLinkGaps([renderDeposit], links);

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
  });

  it('should ignore reward transactions', () => {
    const transactions: Transaction[] = [
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

  it('should ignore staking inflow transactions such as unstake returns', () => {
    const transactions: Transaction[] = [
      createBlockchainDeposit({
        id: 23,
        operation: {
          category: 'staking',
          type: 'unstake',
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
    const transactions: Transaction[] = [createBlockchainWithdrawal()];
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
      txFingerprint: 'syrup-deposit',
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
      txFingerprint: 'service-swap',
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
      txFingerprint: 'rsr-withdrawal',
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
      txFingerprint: 'syrup-deposit-no-swap',
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
      txFingerprint: 'rsr-withdrawal-no-swap',
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

  it('should suppress cross-chain one-sided blockchain flows for the same user when they look like a service-mediated swap', () => {
    const nearWithdrawal = createBlockchainWithdrawal({
      id: 8941,
      accountId: 86,
      txFingerprint: 'near-withdrawal',
      source: 'near',
      datetime: '2026-02-18T23:09:37.281Z',
      timestamp: Date.parse('2026-02-18T23:09:37.281Z'),
      from: '3c49dfe359205e7ceb0cfac58f3592d12b14554e73f1f5448ea938cb04cf5fcc',
      to: 'swap.near-intent-service',
      blockchain: {
        name: 'near',
        transaction_hash: 'near-withdrawal-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:near:native',
            assetSymbol: 'NEAR' as Currency,
            grossAmount: parseDecimal('71.1104447677142475'),
            netAmount: parseDecimal('71.1104447677142475'),
          },
        ],
      },
    });

    const ethereumDeposit = createBlockchainDeposit({
      id: 8865,
      accountId: 50,
      txFingerprint: 'ethereum-deposit',
      source: 'ethereum',
      datetime: '2026-02-18T23:09:59.000Z',
      timestamp: Date.parse('2026-02-18T23:09:59.000Z'),
      from: '0x2cff890f0378a11913b6129b2e97417a2c302680',
      to: '0x15a2aa147781b08a0105d678386ea63e6ca06281',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'ethereum-deposit-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('70.320942'),
            netAmount: parseDecimal('70.320942'),
          },
        ],
        outflows: [],
      },
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    });

    const analysis = analyzeLinkGaps([nearWithdrawal, ethereumDeposit], [], {
      accounts: [
        createMockAccount({
          id: 86,
          identifier: '3c49dfe359205e7ceb0cfac58f3592d12b14554e73f1f5448ea938cb04cf5fcc',
          userId: 1,
        }),
        createMockAccount({
          id: 50,
          identifier: '0x15a2aa147781b08a0105d678386ea63e6ca06281',
          userId: 1,
        }),
      ],
    });

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
    expect(analysis.summary.assets).toHaveLength(0);
  });

  it('should not suppress cross-chain one-sided blockchain flows across different users', () => {
    const nearWithdrawal = createBlockchainWithdrawal({
      id: 8941,
      accountId: 86,
      txFingerprint: 'near-withdrawal-different-user',
      source: 'near',
      datetime: '2026-02-18T23:09:37.281Z',
      timestamp: Date.parse('2026-02-18T23:09:37.281Z'),
      from: '3c49dfe359205e7ceb0cfac58f3592d12b14554e73f1f5448ea938cb04cf5fcc',
      to: 'swap.near-intent-service',
      blockchain: {
        name: 'near',
        transaction_hash: 'near-withdrawal-different-user-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:near:native',
            assetSymbol: 'NEAR' as Currency,
            grossAmount: parseDecimal('71.1104447677142475'),
            netAmount: parseDecimal('71.1104447677142475'),
          },
        ],
      },
    });

    const ethereumDeposit = createBlockchainDeposit({
      id: 8865,
      accountId: 50,
      txFingerprint: 'ethereum-deposit-different-user',
      source: 'ethereum',
      datetime: '2026-02-18T23:09:59.000Z',
      timestamp: Date.parse('2026-02-18T23:09:59.000Z'),
      from: '0x2cff890f0378a11913b6129b2e97417a2c302680',
      to: '0x15a2aa147781b08a0105d678386ea63e6ca06281',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'ethereum-deposit-different-user-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('70.320942'),
            netAmount: parseDecimal('70.320942'),
          },
        ],
        outflows: [],
      },
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    });

    const analysis = analyzeLinkGaps([nearWithdrawal, ethereumDeposit], [], {
      accounts: [
        createMockAccount({
          id: 86,
          identifier: '3c49dfe359205e7ceb0cfac58f3592d12b14554e73f1f5448ea938cb04cf5fcc',
          userId: 1,
        }),
        createMockAccount({
          id: 50,
          identifier: '0x15a2aa147781b08a0105d678386ea63e6ca06281',
          userId: 2,
        }),
      ],
    });

    expect(analysis.summary.total_issues).toBe(2);
    expect(analysis.summary.uncovered_inflows).toBe(1);
    expect(analysis.summary.unmatched_outflows).toBe(1);
  });

  it('should treat confirmed links as coverage for withdrawals', () => {
    const withdrawal = createBlockchainWithdrawal({ id: 22, txFingerprint: 'btc-outflow-2' });
    const transactions: Transaction[] = [withdrawal];
    const links: TransactionLink[] = [
      createMockLink({
        id: 1,
        sourceTransactionId: withdrawal.id,
        targetTransactionId: 42,
        assetSymbol: 'BTC',
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
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
    const transactions: Transaction[] = [createExchangeWithdrawal()];
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
    const withdrawal = createExchangeWithdrawal({ id: 32, txFingerprint: 'kraken-outflow-2' });
    const transactions: Transaction[] = [withdrawal];
    const links: TransactionLink[] = [
      createMockLink({
        id: 1,
        sourceTransactionId: withdrawal.id,
        targetTransactionId: 77,
        assetSymbol: 'ETH',
        sourceAssetId: 'test:eth',
        targetAssetId: 'test:eth',
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
