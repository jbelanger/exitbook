import type { Account, Transaction, TransactionDraft, TransactionLink } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { materializeTestTransaction } from '../../../__tests__/test-utils.js';
import { analyzeLinkGaps, applyResolvedLinkGapVisibility } from '../gap-analysis.js';
import { buildLinkGapIssueKey } from '../gap-model.js';

describe('analyzeLinkGaps', () => {
  const selfAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const serviceInAddress = '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed';
  const serviceOutAddress = '0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef';

  const createMockAccount = (
    overrides: Partial<Pick<Account, 'id' | 'identifier' | 'profileId'>> = {}
  ): Pick<Account, 'id' | 'identifier' | 'profileId'> => ({
    id: overrides.id ?? 1,
    identifier: overrides.identifier ?? selfAddress,
    profileId: overrides.profileId ?? 1,
  });

  const createMockTransaction = (
    overrides: Omit<Partial<Transaction>, 'movements' | 'fees'> & {
      fees?: TransactionDraft['fees'];
      movements?: TransactionDraft['movements'];
    } = {}
  ): Transaction =>
    materializeTestTransaction({
      id: 1,
      accountId: 1,
      txFingerprint: String(overrides.txFingerprint ?? 'tx-123'),
      datetime: '2024-01-01T12:00:00Z',
      timestamp: 1704110400000,
      platformKey: 'kraken',
      platformKind: 'exchange',
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
      platformKey: 'bitcoin',
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
      platformKey: 'bitcoin',
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
      platformKey: 'kraken',
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
      platformKey: 'ethereum',
      platformKind: 'blockchain',
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
    metadata?: TransactionLink['metadata'];
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
    ...(params.metadata === undefined ? {} : { metadata: params.metadata }),
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

  it('should ignore staking-reward inflows for transfer gap detection', () => {
    const transactions: Transaction[] = [
      createBlockchainDeposit({
        movements: {
          inflows: [
            {
              assetId: 'blockchain:cardano:native',
              assetSymbol: 'ADA' as Currency,
              grossAmount: parseDecimal('1'),
              movementRole: 'staking_reward',
              netAmount: parseDecimal('1'),
            },
          ],
          outflows: [],
        },
        blockchain: {
          name: 'cardano',
          transaction_hash: 'cardano-staking-reward',
          is_confirmed: true,
        },
        txFingerprint: 'cardano-staking-reward',
      }),
    ];

    const analysis = analyzeLinkGaps(transactions, []);

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.issues).toHaveLength(0);
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
      platformKey: 'ethereum',
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

  it('should ignore deposits for excluded assets', () => {
    const analysis = analyzeLinkGaps([createBlockchainDeposit()], [], {
      excludedAssetIds: new Set(['test:btc']),
    });

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
    expect(analysis.summary.assets).toHaveLength(0);
  });

  it('should keep same-symbol inflow gaps distinct when asset ids differ', () => {
    const mixedDeposit = createBlockchainDeposit({
      id: 25,
      txFingerprint: 'same-symbol-different-asset-ids',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            assetSymbol: 'USDC' as Currency,
            grossAmount: parseDecimal('125'),
            netAmount: parseDecimal('125'),
          },
          {
            assetId: 'blockchain:ethereum:0x1234567890abcdef1234567890abcdef12345678',
            assetSymbol: 'USDC' as Currency,
            grossAmount: parseDecimal('75'),
            netAmount: parseDecimal('75'),
          },
        ],
        outflows: [],
      },
    });

    const analysis = analyzeLinkGaps([mixedDeposit], []);

    expect(analysis.summary.total_issues).toBe(2);
    expect(analysis.issues.map((issue) => issue.assetId)).toStrictEqual([
      'blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      'blockchain:ethereum:0x1234567890abcdef1234567890abcdef12345678',
    ]);
    expect(analysis.summary.assets).toStrictEqual([
      {
        assetSymbol: 'USDC',
        inflowOccurrences: 2,
        inflowMissingAmount: '200',
        outflowOccurrences: 0,
        outflowMissingAmount: '0',
      },
    ]);
  });

  it('should suppress gap issues for transactions excluded from accounting', () => {
    const analysis = analyzeLinkGaps(
      [
        createBlockchainDeposit({
          id: 26,
          txFingerprint: 'excluded-gap',
          excludedFromAccounting: true,
        }),
      ],
      []
    );

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
  });

  it('should suppress gap issues for scam-marked transactions', () => {
    const analysis = analyzeLinkGaps(
      [
        createBlockchainDeposit({
          id: 27,
          txFingerprint: 'scam-gap',
          diagnostics: [
            {
              code: 'SCAM_TOKEN',
              message: 'Known scam token',
              severity: 'error',
            },
          ],
        }),
      ],
      []
    );

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
  });

  it('should suppress gap issues for suspicious-airdrop transactions', () => {
    const analysis = analyzeLinkGaps(
      [
        createBlockchainDeposit({
          id: 28,
          txFingerprint: 'suspicious-airdrop-gap',
          diagnostics: [
            {
              code: 'SUSPICIOUS_AIRDROP',
              message: 'Likely airdrop bait',
              severity: 'warning',
            },
          ],
        }),
      ],
      []
    );

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
  });

  it('should suppress gap issues for SCAM_TOKEN transactions', () => {
    const analysis = analyzeLinkGaps(
      [
        createBlockchainDeposit({
          id: 29,
          txFingerprint: 'spam-gap',
          diagnostics: [
            {
              code: 'SCAM_TOKEN',
              message: 'Scam token detected',
              severity: 'error',
            },
          ],
        }),
      ],
      []
    );

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
  });

  it('should attach a context hint for materially explanatory diagnostics', () => {
    const analysis = analyzeLinkGaps(
      [
        createBlockchainWithdrawal({
          id: 30,
          txFingerprint: 'cardano-shared-hash-gap',
          platformKey: 'cardano',
          blockchain: {
            name: 'cardano',
            transaction_hash: 'cardano-shared-hash',
            is_confirmed: true,
          },
          diagnostics: [
            {
              code: 'classification_uncertain',
              message:
                'Cardano transaction includes wallet-scoped staking withdrawal of 10.524451 ADA that cannot be attributed to a single derived address in the current per-address projection.',
              severity: 'info',
            },
          ],
          movements: {
            inflows: [],
            outflows: [
              {
                assetId: 'blockchain:cardano:native',
                assetSymbol: 'ADA' as Currency,
                grossAmount: parseDecimal('1021.402541'),
                netAmount: parseDecimal('1021.329314829243639698026006'),
              },
            ],
          },
        }),
      ],
      []
    );

    expect(analysis.summary.total_issues).toBe(1);
    expect(analysis.issues[0]?.contextHint).toStrictEqual({
      kind: 'diagnostic',
      code: 'classification_uncertain',
      label: 'staking withdrawal in same tx',
      message:
        'Cardano transaction includes wallet-scoped staking withdrawal of 10.524451 ADA that cannot be attributed to a single derived address in the current per-address projection.',
    });
  });

  it('should attach a movement-role context hint when the transaction includes staking rewards', () => {
    const analysis = analyzeLinkGaps(
      [
        createBlockchainWithdrawal({
          id: 31,
          txFingerprint: 'staking-reward-context-gap',
          platformKey: 'ethereum',
          blockchain: {
            name: 'ethereum',
            transaction_hash: 'staking-reward-context-gap',
            is_confirmed: true,
          },
          diagnostics: [],
          movements: {
            inflows: [
              {
                assetId: 'blockchain:ethereum:native',
                assetSymbol: 'ETH' as Currency,
                grossAmount: parseDecimal('0.12'),
                netAmount: parseDecimal('0.12'),
                movementRole: 'staking_reward',
              },
            ],
            outflows: [
              {
                assetId: 'blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                assetSymbol: 'USDC' as Currency,
                grossAmount: parseDecimal('100'),
                netAmount: parseDecimal('100'),
              },
            ],
          },
        }),
      ],
      []
    );

    expect(analysis.summary.total_issues).toBe(1);
    expect(analysis.issues[0]?.contextHint).toStrictEqual({
      kind: 'movement_role',
      code: 'staking_reward',
      label: 'staking reward in same tx',
      message: 'Transaction includes a staking reward movement that is excluded from transfer matching.',
    });
  });

  it('should hide only resolved issue-level gaps and track hidden issue counts', () => {
    const txFingerprint = 'resolved-gap';
    const mixedDeposit = createBlockchainDeposit({
      id: 24,
      txFingerprint,
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.8'),
            netAmount: parseDecimal('0.8'),
          },
          {
            assetId: 'test:usdt',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('125'),
            netAmount: parseDecimal('125'),
          },
        ],
        outflows: [],
      },
    });

    const analysis = analyzeLinkGaps([mixedDeposit], []);
    const visibleAnalysis = applyResolvedLinkGapVisibility(
      analysis,
      new Set([
        buildLinkGapIssueKey({
          txFingerprint,
          assetId: 'test:btc',
          direction: 'inflow',
        }),
      ])
    );

    expect(visibleAnalysis.analysis.issues).toHaveLength(1);
    expect(visibleAnalysis.analysis.issues[0]?.assetId).toBe('test:usdt');
    expect(visibleAnalysis.analysis.summary.total_issues).toBe(1);
    expect(visibleAnalysis.analysis.summary.uncovered_inflows).toBe(1);
    expect(visibleAnalysis.analysis.summary.unmatched_outflows).toBe(0);
    expect(visibleAnalysis.analysis.summary.affected_assets).toBe(1);
    expect(visibleAnalysis.hiddenResolvedIssueCount).toBe(1);
    expect(visibleAnalysis.analysis.summary.assets).toStrictEqual([
      {
        assetSymbol: 'USDT',
        inflowOccurrences: 1,
        inflowMissingAmount: '125',
        outflowOccurrences: 0,
        outflowMissingAmount: '0',
      },
    ]);
  });

  it('should keep non-excluded inflow gaps in mixed one-sided transactions', () => {
    const mixedDeposit = createBlockchainDeposit({
      id: 24,
      txFingerprint: 'mixed-deposit',
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.8'),
            netAmount: parseDecimal('0.8'),
          },
          {
            assetId: 'test:usdt',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('125'),
            netAmount: parseDecimal('125'),
          },
        ],
        outflows: [],
      },
    });

    const analysis = analyzeLinkGaps([mixedDeposit], [], {
      excludedAssetIds: new Set(['test:btc']),
    });

    expect(analysis.summary.total_issues).toBe(1);
    expect(analysis.summary.uncovered_inflows).toBe(1);
    expect(analysis.summary.unmatched_outflows).toBe(0);
    expect(analysis.summary.assets).toStrictEqual([
      {
        assetSymbol: 'USDT',
        inflowOccurrences: 1,
        inflowMissingAmount: '125',
        outflowOccurrences: 0,
        outflowMissingAmount: '0',
      },
    ]);
    expect(analysis.issues[0]!.assetSymbol).toBe('USDT');
    expect(analysis.issues[0]!.missingAmount).toBe('125');
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

  it('should suppress residual fee-asset outflow gaps when every other outflow asset is fully covered', () => {
    const withdrawal = createBlockchainWithdrawal({
      id: 210,
      accountId: 7,
      txFingerprint: 'solana-linked-send-source',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2026-03-13T00:24:54.000Z',
      timestamp: Date.parse('2026-03-13T00:24:54.000Z'),
      from: selfAddress,
      to: serviceOutAddress,
      blockchain: {
        name: 'solana',
        transaction_hash: 'linked-send-source-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:solana:usdt',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('165'),
            netAmount: parseDecimal('165'),
          },
          {
            assetId: 'blockchain:solana:native',
            assetSymbol: 'SOL' as Currency,
            grossAmount: parseDecimal('0.00407856'),
            netAmount: parseDecimal('0.00407856'),
          },
        ],
      },
      fees: [
        {
          assetId: 'blockchain:solana:native',
          assetSymbol: 'SOL' as Currency,
          amount: parseDecimal('0.000067691'),
          scope: 'network',
          settlement: 'balance',
        },
      ],
    });

    const links: TransactionLink[] = [
      createMockLink({
        id: 763,
        sourceTransactionId: withdrawal.id,
        targetTransactionId: 211,
        assetSymbol: 'USDT',
        sourceAssetId: 'blockchain:solana:usdt',
        targetAssetId: 'blockchain:solana:usdt',
        sourceAmount: '165',
        targetAmount: '165',
        linkType: 'blockchain_to_blockchain',
        confidenceScore: '1',
        metadata: {
          variance: '0',
          variancePct: '0.00',
        },
      }),
    ];

    const analysis = analyzeLinkGaps([withdrawal], links);

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
    expect(analysis.summary.assets).toHaveLength(0);
  });

  it('should suppress residual native outflow gaps for blockchain-to-exchange sends when the principal asset is fully covered', () => {
    const withdrawal = createBlockchainWithdrawal({
      id: 220,
      accountId: 7,
      txFingerprint: 'solana-exchange-send-source',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2024-03-25T11:19:21.000Z',
      timestamp: Date.parse('2024-03-25T11:19:21.000Z'),
      from: selfAddress,
      to: serviceOutAddress,
      blockchain: {
        name: 'solana',
        transaction_hash: 'exchange-send-source-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:solana:usdc',
            assetSymbol: 'USDC' as Currency,
            grossAmount: parseDecimal('568.637'),
            netAmount: parseDecimal('568.637'),
          },
          {
            assetId: 'blockchain:solana:native',
            assetSymbol: 'SOL' as Currency,
            grossAmount: parseDecimal('0.00203928'),
            netAmount: parseDecimal('0.00203928'),
          },
        ],
      },
      fees: [
        {
          assetId: 'blockchain:solana:native',
          assetSymbol: 'SOL' as Currency,
          amount: parseDecimal('0.000025'),
          scope: 'network',
          settlement: 'balance',
        },
      ],
    });

    const links: TransactionLink[] = [
      createMockLink({
        id: 764,
        sourceTransactionId: withdrawal.id,
        targetTransactionId: 221,
        assetSymbol: 'USDC',
        sourceAssetId: 'blockchain:solana:usdc',
        targetAssetId: 'exchange:kucoin:usdc',
        sourceAmount: '568.637',
        targetAmount: '568.637',
        linkType: 'blockchain_to_exchange',
        confidenceScore: '1',
        metadata: {
          variance: '0',
          variancePct: '0.00',
        },
      }),
    ];

    const analysis = analyzeLinkGaps([withdrawal], links);

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
    expect(analysis.summary.assets).toHaveLength(0);
  });

  it('should keep residual native outflow gaps when another outflow asset is only partially covered', () => {
    const withdrawal = createBlockchainWithdrawal({
      id: 230,
      accountId: 7,
      txFingerprint: 'solana-partial-principal-coverage',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2026-03-13T00:24:54.000Z',
      timestamp: Date.parse('2026-03-13T00:24:54.000Z'),
      from: selfAddress,
      to: serviceOutAddress,
      blockchain: {
        name: 'solana',
        transaction_hash: 'partial-principal-coverage-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:solana:usdt',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('165'),
            netAmount: parseDecimal('165'),
          },
          {
            assetId: 'blockchain:solana:native',
            assetSymbol: 'SOL' as Currency,
            grossAmount: parseDecimal('0.00407856'),
            netAmount: parseDecimal('0.00407856'),
          },
        ],
      },
      fees: [
        {
          assetId: 'blockchain:solana:native',
          assetSymbol: 'SOL' as Currency,
          amount: parseDecimal('0.000067691'),
          scope: 'network',
          settlement: 'balance',
        },
      ],
    });

    const links: TransactionLink[] = [
      createMockLink({
        id: 765,
        sourceTransactionId: withdrawal.id,
        targetTransactionId: 231,
        assetSymbol: 'USDT',
        sourceAssetId: 'blockchain:solana:usdt',
        targetAssetId: 'blockchain:solana:usdt',
        sourceAmount: '100',
        targetAmount: '100',
        linkType: 'blockchain_to_blockchain',
        confidenceScore: '1',
        metadata: {
          variance: '0',
          variancePct: '0.00',
        },
      }),
    ];

    const analysis = analyzeLinkGaps([withdrawal], links);

    expect(analysis.summary.total_issues).toBe(2);
    expect(analysis.summary.unmatched_outflows).toBe(2);
    expect(analysis.summary.assets).toStrictEqual([
      {
        assetSymbol: 'SOL',
        inflowOccurrences: 0,
        inflowMissingAmount: '0',
        outflowOccurrences: 1,
        outflowMissingAmount: '0.00407856',
      },
      {
        assetSymbol: 'USDT',
        inflowOccurrences: 0,
        inflowMissingAmount: '0',
        outflowOccurrences: 1,
        outflowMissingAmount: '65',
      },
    ]);
  });

  it('should suppress nearby one-sided blockchain flows when they look like a service-mediated cross-asset flow', () => {
    const syrupDeposit = createBlockchainDeposit({
      id: 101,
      accountId: 7,
      txFingerprint: 'syrup-deposit',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
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
      platformKey: 'ethereum',
      platformKind: 'blockchain',
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

  it('should cue same-account same-chain uncovered flows that look like a correlated service swap', () => {
    const solanaSelfAddress = 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm';
    const renderWithdrawal = createBlockchainWithdrawal({
      id: 121,
      accountId: 7,
      txFingerprint: 'render-withdrawal-service-swap',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2026-03-13T00:02:12.000Z',
      timestamp: Date.parse('2026-03-13T00:02:12.000Z'),
      from: solanaSelfAddress,
      to: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5Nt7nQkbF',
      blockchain: {
        name: 'solana',
        transaction_hash: 'render-withdrawal-service-swap-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:solana:render',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('100'),
            netAmount: parseDecimal('100'),
          },
        ],
      },
    });
    const solRebateDeposit = createBlockchainDeposit({
      id: 122,
      accountId: 7,
      txFingerprint: 'sol-rebate-service-swap',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2026-03-13T00:02:43.000Z',
      timestamp: Date.parse('2026-03-13T00:02:43.000Z'),
      from: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5Nt7nQkbF',
      to: solanaSelfAddress,
      blockchain: {
        name: 'solana',
        transaction_hash: 'sol-rebate-service-swap-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:solana:native',
            assetSymbol: 'SOL' as Currency,
            grossAmount: parseDecimal('0.00001'),
            netAmount: parseDecimal('0.00001'),
          },
        ],
        outflows: [],
      },
    });
    const usdtDeposit = createBlockchainDeposit({
      id: 123,
      accountId: 7,
      txFingerprint: 'usdt-deposit-service-swap',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2026-03-13T00:03:04.000Z',
      timestamp: Date.parse('2026-03-13T00:03:04.000Z'),
      from: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5Nt7nQkbF',
      to: solanaSelfAddress,
      blockchain: {
        name: 'solana',
        transaction_hash: 'usdt-deposit-service-swap-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:solana:usdt',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('165.1695'),
            netAmount: parseDecimal('165.1695'),
          },
        ],
        outflows: [],
      },
    });

    const analysis = analyzeLinkGaps([renderWithdrawal, solRebateDeposit, usdtDeposit], []);

    expect(analysis.summary.total_issues).toBe(3);
    expect(analysis.issues.map((issue) => issue.gapCue)).toStrictEqual([
      'likely_correlated_service_swap',
      'likely_correlated_service_swap',
      'likely_correlated_service_swap',
    ]);
  });

  it('should keep one-sided blockchain flows when no nearby swap supports service-flow suppression', () => {
    const syrupDeposit = createBlockchainDeposit({
      id: 111,
      accountId: 7,
      txFingerprint: 'syrup-deposit-no-swap',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
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
      platformKey: 'ethereum',
      platformKind: 'blockchain',
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
    expect(analysis.issues.every((issue) => issue.gapCue === undefined)).toBe(true);
  });

  it('should not cue isolated one-sided blockchain flows', () => {
    const analysis = analyzeLinkGaps(
      [
        createBlockchainDeposit({
          id: 113,
          txFingerprint: 'isolated-solana-inflow',
          platformKey: 'solana',
          platformKind: 'blockchain',
          datetime: '2026-03-13T00:02:43.000Z',
          timestamp: Date.parse('2026-03-13T00:02:43.000Z'),
          from: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5Nt7nQkbF',
          to: 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm',
          blockchain: {
            name: 'solana',
            transaction_hash: 'isolated-solana-inflow-hash',
            is_confirmed: true,
          },
          movements: {
            inflows: [
              {
                assetId: 'blockchain:solana:usdt',
                assetSymbol: 'USDT' as Currency,
                grossAmount: parseDecimal('165.1695'),
                netAmount: parseDecimal('165.1695'),
              },
            ],
            outflows: [],
          },
        }),
      ],
      []
    );

    expect(analysis.summary.total_issues).toBe(1);
    expect(analysis.issues[0]?.gapCue).toBeUndefined();
  });

  it('should not cue same-window uncovered flows when they use the same asset id', () => {
    const solanaSelfAddress = 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm';
    const solWithdrawal = createBlockchainWithdrawal({
      id: 124,
      accountId: 7,
      txFingerprint: 'sol-withdrawal-non-swap',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2026-03-13T00:02:12.000Z',
      timestamp: Date.parse('2026-03-13T00:02:12.000Z'),
      from: solanaSelfAddress,
      to: 'SomeService1111111111111111111111111111111111',
      blockchain: {
        name: 'solana',
        transaction_hash: 'sol-withdrawal-non-swap-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:solana:native',
            assetSymbol: 'SOL' as Currency,
            grossAmount: parseDecimal('0.75'),
            netAmount: parseDecimal('0.75'),
          },
        ],
      },
    });
    const solDeposit = createBlockchainDeposit({
      id: 125,
      accountId: 7,
      txFingerprint: 'sol-deposit-non-swap',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2026-03-13T00:02:43.000Z',
      timestamp: Date.parse('2026-03-13T00:02:43.000Z'),
      from: 'SomeService1111111111111111111111111111111111',
      to: solanaSelfAddress,
      blockchain: {
        name: 'solana',
        transaction_hash: 'sol-deposit-non-swap-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:solana:native',
            assetSymbol: 'SOL' as Currency,
            grossAmount: parseDecimal('0.2'),
            netAmount: parseDecimal('0.2'),
          },
        ],
        outflows: [],
      },
    });

    const analysis = analyzeLinkGaps([solWithdrawal, solDeposit], []);

    expect(analysis.summary.total_issues).toBe(2);
    expect(analysis.issues.every((issue) => issue.gapCue === undefined)).toBe(true);
  });

  it('should suppress cross-chain one-sided blockchain flows for the same user when they look like a service-mediated swap', () => {
    const nearWithdrawal = createBlockchainWithdrawal({
      id: 8941,
      accountId: 86,
      txFingerprint: 'near-withdrawal',
      platformKey: 'near',
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
      platformKey: 'ethereum',
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
          profileId: 1,
        }),
        createMockAccount({
          id: 50,
          identifier: '0x15a2aa147781b08a0105d678386ea63e6ca06281',
          profileId: 1,
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
      platformKey: 'near',
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
      platformKey: 'ethereum',
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
          profileId: 1,
        }),
        createMockAccount({
          id: 50,
          identifier: '0x15a2aa147781b08a0105d678386ea63e6ca06281',
          profileId: 2,
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

  it('should ignore withdrawals for excluded assets', () => {
    const analysis = analyzeLinkGaps([createBlockchainWithdrawal()], [], {
      excludedAssetIds: new Set(['test:btc']),
    });

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
    expect(analysis.summary.assets).toHaveLength(0);
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
