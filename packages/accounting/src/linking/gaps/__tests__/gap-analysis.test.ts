/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
import {
  POSSIBLE_ASSET_MIGRATION_DIAGNOSTIC_CODE,
  type Account,
  type AssetReviewSummary,
  type Transaction,
  type TransactionDraft,
  type TransactionLink,
} from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';
import { describe, expect, it } from 'vitest';

import { createPriceAtTxTime, materializeTestTransaction } from '../../../__tests__/test-utils.js';
import { analyzeLinkGaps, applyAssetReviewGapCues, applyResolvedLinkGapVisibility } from '../gap-analysis.js';
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

  const withPossibleAssetMigrationDiagnostic = (transaction: Transaction, migrationGroupKey: string): Transaction => ({
    ...transaction,
    diagnostics: [
      {
        code: POSSIBLE_ASSET_MIGRATION_DIAGNOSTIC_CODE,
        severity: 'info',
        message: 'possible migration',
        metadata: {
          migrationGroupKey,
          providerSubtype: 'spotfromfutures',
        },
      },
    ],
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

  const createAssetReviewSummary = (overrides: Partial<AssetReviewSummary> = {}): AssetReviewSummary => ({
    assetId: overrides.assetId ?? 'test:btc',
    reviewStatus: overrides.reviewStatus ?? 'needs-review',
    referenceStatus: overrides.referenceStatus ?? 'unmatched',
    evidenceFingerprint: overrides.evidenceFingerprint ?? 'asset-review-evidence',
    confirmationIsStale: overrides.confirmationIsStale ?? false,
    accountingBlocked: overrides.accountingBlocked ?? false,
    confirmedEvidenceFingerprint: overrides.confirmedEvidenceFingerprint,
    warningSummary: overrides.warningSummary,
    evidence: overrides.evidence ?? [
      {
        kind: 'unmatched-reference',
        severity: 'warning',
        message: "Provider 'coingecko' could not match this token to a canonical asset",
      },
    ],
  });

  const createBridgeAnnotation = (params: {
    counterpartTxFingerprint?: string | undefined;
    counterpartTxId?: number | undefined;
    role: 'source' | 'target';
    tier: 'asserted' | 'heuristic';
    transaction: Transaction;
  }): TransactionAnnotation => ({
    annotationFingerprint: `annotation:${params.transaction.txFingerprint}:${params.tier}:${params.role}`,
    accountId: params.transaction.accountId,
    transactionId: params.transaction.id,
    txFingerprint: params.transaction.txFingerprint,
    kind: 'bridge_participant',
    tier: params.tier,
    target: { scope: 'transaction' },
    ...(params.tier === 'asserted' ? { protocolRef: { id: 'wormhole' } } : {}),
    role: params.role,
    detectorId: params.tier === 'asserted' ? 'bridge-participant' : 'heuristic-bridge-participant',
    derivedFromTxIds:
      params.tier === 'heuristic' && params.counterpartTxId !== undefined
        ? ([
            Math.min(params.transaction.id, params.counterpartTxId),
            Math.max(params.transaction.id, params.counterpartTxId),
          ] as const)
        : ([params.transaction.id] as const),
    provenanceInputs: params.tier === 'asserted' ? ['processor', 'diagnostic'] : ['timing', 'address_pattern'],
    ...(params.counterpartTxFingerprint === undefined
      ? {}
      : { metadata: { counterpartTxFingerprint: params.counterpartTxFingerprint } }),
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

  it('should add an unmatched-reference cue when asset review still flags the asset', () => {
    const analysis = analyzeLinkGaps([createBlockchainDeposit()], []);
    const issue = analysis.issues[0]!;

    const cuedAnalysis = applyAssetReviewGapCues(analysis, [
      createAssetReviewSummary({
        assetId: issue.assetId,
      }),
    ]);

    expect(cuedAnalysis.issues[0]?.gapCue).toBe('unmatched_reference');
  });

  it('should preserve stronger gap cues when adding unmatched-reference asset review context', () => {
    const analysis = analyzeLinkGaps([createBlockchainDeposit()], []);
    const issue = analysis.issues[0]!;

    const cuedAnalysis = applyAssetReviewGapCues(
      {
        ...analysis,
        issues: [
          {
            ...issue,
            gapCue: 'likely_dust',
          },
        ],
      },
      [
        createAssetReviewSummary({
          assetId: issue.assetId,
        }),
      ]
    );

    expect(cuedAnalysis.issues[0]?.gapCue).toBe('likely_dust');
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

  it('should suppress fully explained staking-reward target residuals from open inflow gaps', () => {
    const transactions: Transaction[] = [
      createBlockchainDeposit({
        id: 32,
        txFingerprint: 'cardano-explained-residual-target',
        platformKey: 'kucoin',
        platformKind: 'exchange',
        movements: {
          inflows: [
            {
              assetId: 'exchange:kucoin:ada',
              assetSymbol: 'ADA' as Currency,
              grossAmount: parseDecimal('2679.718442'),
              netAmount: parseDecimal('2679.718442'),
            },
          ],
          outflows: [],
        },
      }),
    ];

    const links: TransactionLink[] = [
      createMockLink({
        id: 2,
        sourceTransactionId: 100,
        targetTransactionId: 32,
        assetSymbol: 'ADA',
        sourceAssetId: 'blockchain:cardano:native',
        targetAssetId: 'exchange:kucoin:ada',
        sourceAmount: '2669.193991',
        targetAmount: '2669.193991',
        linkType: 'blockchain_to_exchange',
        confidenceScore: '1',
        metadata: {
          partialMatch: true,
          fullSourceAmount: '2669.193991',
          fullTargetAmount: '2679.718442',
          consumedAmount: '2669.193991',
          targetExcessAllowed: true,
          targetExcess: '10.524451',
          targetExcessPct: '0.393',
          explainedTargetResidualAmount: '10.524451',
          explainedTargetResidualRole: 'staking_reward',
        },
      }),
    ];

    const analysis = analyzeLinkGaps(transactions, links);

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
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

  it('should suppress gap issues for off-platform cash movements', () => {
    const analysis = analyzeLinkGaps(
      [
        createExchangeWithdrawal({
          id: 26,
          txFingerprint: 'coinbase-fiat-withdrawal-gap',
          platformKey: 'coinbase',
          diagnostics: [
            {
              code: 'off_platform_cash_movement',
              message: 'Coinbase fiat withdrawal was classified as an off-platform cash movement.',
              severity: 'info',
            },
          ],
          movements: {
            inflows: [],
            outflows: [
              {
                assetId: 'exchange:coinbase:cad',
                assetSymbol: 'CAD' as Currency,
                grossAmount: parseDecimal('500'),
                netAmount: parseDecimal('500'),
              },
            ],
          },
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

  it('should suppress gap issues for one-sided trade residuals classified as refund rebates', () => {
    const analysis = analyzeLinkGaps(
      [
        createMockTransaction({
          id: 29_1,
          txFingerprint: 'kraken-one-sided-trade-residual',
          platformKey: 'kraken',
          platformKind: 'exchange',
          operation: {
            category: 'trade',
            type: 'buy',
          },
          diagnostics: [
            {
              code: 'classification_uncertain',
              message: 'Kraken one-sided trade residual was classified as a non-transfer trade residual.',
              severity: 'info',
              metadata: {
                providerSubtype: 'tradespot',
                residualRole: 'refund_rebate',
              },
            },
          ],
          movements: {
            inflows: [
              {
                assetId: 'exchange:kraken:fet',
                assetSymbol: 'FET' as Currency,
                grossAmount: parseDecimal('0.00000488'),
                netAmount: parseDecimal('0.00000488'),
                movementRole: 'refund_rebate',
              },
            ],
            outflows: [],
          },
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

  it('should attach a context hint for exchange deposit address credits', () => {
    const analysis = analyzeLinkGaps(
      [
        createBlockchainDeposit({
          id: 33,
          txFingerprint: 'kucoin-exchange-deposit-credit-gap',
          platformKey: 'kucoin',
          platformKind: 'exchange',
          blockchain: {
            name: 'SOL',
            transaction_hash: 'kucoin-exchange-deposit-credit-gap',
            is_confirmed: true,
          },
          diagnostics: [
            {
              code: 'exchange_deposit_address_credit',
              message:
                'KuCoin export records an on-chain credit into the platform deposit address; raw exchange data does not prove whether the sender was external or exchange-managed.',
              severity: 'info',
            },
          ],
          movements: {
            inflows: [
              {
                assetId: 'exchange:kucoin:ray',
                assetSymbol: 'RAY' as Currency,
                grossAmount: parseDecimal('68.9027'),
                netAmount: parseDecimal('68.9027'),
              },
            ],
            outflows: [],
          },
        }),
      ],
      []
    );

    expect(analysis.summary.total_issues).toBe(1);
    expect(analysis.issues[0]?.contextHint).toStrictEqual({
      kind: 'diagnostic',
      code: 'exchange_deposit_address_credit',
      label: 'credit into exchange deposit address',
      message:
        'KuCoin export records an on-chain credit into the platform deposit address; raw exchange data does not prove whether the sender was external or exchange-managed.',
    });
  });

  it('should attach an annotation-backed context hint for bridge participants', () => {
    const bridgeDeposit = createBlockchainDeposit({
      id: 34,
      accountId: 21,
      txFingerprint: 'wormhole-bridge-deposit',
      platformKey: 'arbitrum',
      platformKind: 'blockchain',
      blockchain: {
        name: 'arbitrum',
        transaction_hash: 'wormhole-bridge-deposit',
        is_confirmed: true,
      },
    });

    const analysis = analyzeLinkGaps([bridgeDeposit], [], {
      transactionAnnotations: [
        createBridgeAnnotation({
          transaction: bridgeDeposit,
          tier: 'asserted',
          role: 'target',
        }),
      ],
    });

    expect(analysis.summary.total_issues).toBe(1);
    expect(analysis.issues[0]?.contextHint).toStrictEqual({
      kind: 'annotation',
      code: 'bridge_participant',
      label: 'bridge participant (wormhole)',
      message: 'Transaction carries asserted bridge interpretation for protocol wormhole.',
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

  it('should cue very low-value one-sided blockchain flows as likely dust when tx-time pricing is available', () => {
    const analysis = analyzeLinkGaps(
      [
        createBlockchainDeposit({
          id: 114,
          txFingerprint: 'likely-dust-solana-inflow',
          platformKey: 'solana',
          platformKind: 'blockchain',
          datetime: '2026-03-13T00:02:43.000Z',
          timestamp: Date.parse('2026-03-13T00:02:43.000Z'),
          from: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5Nt7nQkbF',
          to: 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm',
          blockchain: {
            name: 'solana',
            transaction_hash: 'likely-dust-solana-inflow-hash',
            is_confirmed: true,
          },
          movements: {
            inflows: [
              {
                assetId: 'blockchain:solana:native',
                assetSymbol: 'SOL' as Currency,
                grossAmount: parseDecimal('0.05'),
                netAmount: parseDecimal('0.05'),
                priceAtTxTime: createPriceAtTxTime('120'),
              },
            ],
            outflows: [],
          },
        }),
      ],
      []
    );

    expect(analysis.summary.total_issues).toBe(1);
    expect(analysis.issues[0]?.gapCue).toBe('likely_dust');
  });

  it('should not cue likely dust when the one-sided blockchain flow has no tx-time price', () => {
    const analysis = analyzeLinkGaps(
      [
        createBlockchainDeposit({
          id: 115,
          txFingerprint: 'likely-dust-solana-inflow-no-price',
          platformKey: 'solana',
          platformKind: 'blockchain',
          datetime: '2026-03-13T00:05:43.000Z',
          timestamp: Date.parse('2026-03-13T00:05:43.000Z'),
          from: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5Nt7nQkbF',
          to: 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm',
          blockchain: {
            name: 'solana',
            transaction_hash: 'likely-dust-solana-inflow-no-price-hash',
            is_confirmed: true,
          },
          movements: {
            inflows: [
              {
                assetId: 'blockchain:solana:native',
                assetSymbol: 'SOL' as Currency,
                grossAmount: parseDecimal('0.05'),
                netAmount: parseDecimal('0.05'),
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

  it('should cue explicit unsolicited dust fan-outs as likely dust even without tx-time pricing', () => {
    const analysis = analyzeLinkGaps(
      [
        createBlockchainDeposit({
          id: 116,
          txFingerprint: 'solana-unsolicited-dust-fanout',
          platformKey: 'solana',
          platformKind: 'blockchain',
          datetime: '2026-04-13T16:22:38.000Z',
          timestamp: Date.parse('2026-04-13T16:22:38.000Z'),
          from: 'QVtWcAX3R7Cr51VhAxFSYntoCAmTQzK8Hf4R1TrKNQ4',
          to: 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm',
          blockchain: {
            name: 'solana',
            transaction_hash: 'solana-unsolicited-dust-fanout-hash',
            is_confirmed: true,
          },
          diagnostics: [
            {
              code: 'unsolicited_dust_fanout',
              message:
                'Tiny inbound SOL transfer appears in a multi-recipient system-program fan-out; likely unsolicited dust.',
              severity: 'info',
            },
          ],
          movements: {
            inflows: [
              {
                assetId: 'blockchain:solana:native',
                assetSymbol: 'SOL' as Currency,
                grossAmount: parseDecimal('0.000010001'),
                netAmount: parseDecimal('0.000010001'),
              },
            ],
            outflows: [],
          },
        }),
      ],
      []
    );

    expect(analysis.summary.total_issues).toBe(1);
    expect(analysis.issues[0]?.gapCue).toBe('likely_dust');
    expect(analysis.issues[0]?.contextHint?.code).toBe('unsolicited_dust_fanout');
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

  it('should not cue native-funding plus token-outflow clusters without a non-native inflow', () => {
    const solanaSelfAddress = '6kXAgKWAhKa7anV9b79tnsoULD1muVuRuk4qeD4T3xQn';
    const solDeposit = createBlockchainDeposit({
      id: 126,
      accountId: 8,
      txFingerprint: 'sol-deposit-setup-cluster',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2024-05-24T04:03:55.000Z',
      timestamp: Date.parse('2024-05-24T04:03:55.000Z'),
      from: 'HjsUD6HyUVvyLJG9n4LqX9jMZpM15Xji5iP2SbyeW1vR',
      to: solanaSelfAddress,
      blockchain: {
        name: 'solana',
        transaction_hash: 'sol-deposit-setup-cluster-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:solana:native',
            assetSymbol: 'SOL' as Currency,
            grossAmount: parseDecimal('0.023281532'),
            netAmount: parseDecimal('0.023281532'),
          },
        ],
        outflows: [],
      },
    });

    const mixedWithdrawal = createBlockchainWithdrawal({
      id: 127,
      accountId: 8,
      txFingerprint: 'usdc-withdrawal-setup-cluster',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2024-05-24T04:05:03.000Z',
      timestamp: Date.parse('2024-05-24T04:05:03.000Z'),
      from: solanaSelfAddress,
      to: 'FazwyNxhv2Cmz3w7XRWGWGUS2Tsz7vHnsSKNbxR3biE',
      blockchain: {
        name: 'solana',
        transaction_hash: 'usdc-withdrawal-setup-cluster-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:solana:native',
            assetSymbol: 'SOL' as Currency,
            grossAmount: parseDecimal('0.00203928'),
            netAmount: parseDecimal('0.00203928'),
          },
          {
            assetId: 'blockchain:solana:usdc',
            assetSymbol: 'USDC' as Currency,
            grossAmount: parseDecimal('150'),
            netAmount: parseDecimal('150'),
          },
        ],
      },
    });

    const analysis = analyzeLinkGaps([solDeposit, mixedWithdrawal], []);

    expect(analysis.summary.total_issues).toBe(3);
    expect(analysis.issues.every((issue) => issue.gapCue === undefined)).toBe(true);
  });

  it('should cue exact-amount same-profile cross-chain pairs as likely cross-chain migrations', () => {
    const renderWithdrawal = createBlockchainWithdrawal({
      id: 401,
      accountId: 11,
      txFingerprint: 'render-ethereum-withdrawal',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:36:47.000Z',
      timestamp: Date.parse('2024-07-30T22:36:47.000Z'),
      from: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
      to: '0x3ee18b2214aff97000d974cf647e7c347e8fa585',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'render-ethereum-withdrawal-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:render',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('80.61'),
            netAmount: parseDecimal('80.61'),
          },
        ],
      },
    });

    const renderDeposit = createBlockchainDeposit({
      id: 402,
      accountId: 15,
      txFingerprint: 'render-solana-deposit',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:53:40.000Z',
      timestamp: Date.parse('2024-07-30T22:53:40.000Z'),
      from: 'AYm4Knn6Sw1f52Eq42ujQ2ez5Xb7iBJeviprFCA7ADCy',
      to: 'GRyBys8cE2rLiaqvAYEAWL3U3dkmifY8TKXWX2tdioj4',
      blockchain: {
        name: 'solana',
        transaction_hash: 'render-solana-deposit-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:solana:render',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('80.61'),
            netAmount: parseDecimal('80.61'),
          },
        ],
        outflows: [],
      },
    });

    const analysis = analyzeLinkGaps([renderWithdrawal, renderDeposit], [], {
      accounts: [
        createMockAccount({
          id: 11,
          identifier: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
          profileId: 1,
        }),
        createMockAccount({
          id: 15,
          identifier: 'GRyBys8cE2rLiaqvAYEAWL3U3dkmifY8TKXWX2tdioj4',
          profileId: 1,
        }),
      ],
    });

    expect(analysis.summary.total_issues).toBe(2);
    expect(analysis.issues.map((issue) => issue.gapCue)).toStrictEqual([
      'likely_cross_chain_migration',
      'likely_cross_chain_migration',
    ]);
    expect(analysis.issues.map((issue) => issue.gapCueCounterpartTxFingerprint)).toStrictEqual([
      'render-ethereum-withdrawal',
      'render-solana-deposit',
    ]);
  });

  it('should cue near-equal same-profile cross-chain pairs as likely cross-chain migrations', () => {
    const renderWithdrawal = createBlockchainWithdrawal({
      id: 414,
      accountId: 11,
      txFingerprint: 'render-ethereum-withdrawal-near-equal',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:14:11.000Z',
      timestamp: Date.parse('2024-07-30T22:14:11.000Z'),
      from: '0x15a2000000000000000000000000000000000000',
      to: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'render-ethereum-withdrawal-near-equal-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:render',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('80.617423'),
            netAmount: parseDecimal('80.617423'),
          },
        ],
      },
    });

    const renderDeposit = createBlockchainDeposit({
      id: 415,
      accountId: 15,
      txFingerprint: 'render-solana-deposit-near-equal',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:53:40.000Z',
      timestamp: Date.parse('2024-07-30T22:53:40.000Z'),
      from: 'AYm4Knn6Sw1f52Eq42ujQ2ez5Xb7iBJeviprFCA7ADCy',
      to: 'GRyBys8cE2rLiaqvAYEAWL3U3dkmifY8TKXWX2tdioj4',
      blockchain: {
        name: 'solana',
        transaction_hash: 'render-solana-deposit-near-equal-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:solana:render',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('80.61'),
            netAmount: parseDecimal('80.61'),
          },
        ],
        outflows: [],
      },
    });

    const analysis = analyzeLinkGaps([renderWithdrawal, renderDeposit], [], {
      accounts: [
        createMockAccount({
          id: 11,
          identifier: '0x15a2000000000000000000000000000000000000',
          profileId: 1,
        }),
        createMockAccount({
          id: 15,
          identifier: 'GRyBys8cE2rLiaqvAYEAWL3U3dkmifY8TKXWX2tdioj4',
          profileId: 1,
        }),
      ],
    });

    expect(analysis.summary.total_issues).toBe(2);
    expect(analysis.issues.map((issue) => issue.gapCue)).toStrictEqual([
      'likely_cross_chain_migration',
      'likely_cross_chain_migration',
    ]);
    expect(analysis.issues.map((issue) => issue.gapCueCounterpartTxFingerprint)).toStrictEqual([
      'render-ethereum-withdrawal-near-equal',
      'render-solana-deposit-near-equal',
    ]);
  });

  it('should cue same-owner native cross-chain pairs with partial receipt as likely cross-chain bridges', () => {
    const ethereumWithdrawal = createBlockchainWithdrawal({
      id: 410,
      accountId: 21,
      txFingerprint: 'eth-bridge-withdrawal',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-08-15T18:10:00.000Z',
      timestamp: Date.parse('2024-08-15T18:10:00.000Z'),
      from: '0x15a2000000000000000000000000000000000000',
      to: '0xrouter000000000000000000000000000000000001',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'eth-bridge-withdrawal-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:native',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('1.005'),
            netAmount: parseDecimal('1.005'),
          },
        ],
      },
    });

    const arbitrumDeposit = createBlockchainDeposit({
      id: 411,
      accountId: 22,
      txFingerprint: 'arb-bridge-deposit',
      platformKey: 'arbitrum',
      platformKind: 'blockchain',
      datetime: '2024-08-15T18:18:00.000Z',
      timestamp: Date.parse('2024-08-15T18:18:00.000Z'),
      from: '0xrouter000000000000000000000000000000000002',
      to: '0x15a2000000000000000000000000000000000000',
      blockchain: {
        name: 'arbitrum',
        transaction_hash: 'arb-bridge-deposit-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:arbitrum:native',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('0.998'),
            netAmount: parseDecimal('0.998'),
          },
        ],
        outflows: [],
      },
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    });

    const analysis = analyzeLinkGaps([ethereumWithdrawal, arbitrumDeposit], [], {
      accounts: [
        createMockAccount({
          id: 21,
          identifier: '0x15a2000000000000000000000000000000000000',
          profileId: 1,
        }),
        createMockAccount({
          id: 22,
          identifier: '0x15a2000000000000000000000000000000000000',
          profileId: 1,
        }),
      ],
      transactionAnnotations: [
        createBridgeAnnotation({
          transaction: ethereumWithdrawal,
          tier: 'heuristic',
          role: 'source',
          counterpartTxFingerprint: arbitrumDeposit.txFingerprint,
          counterpartTxId: arbitrumDeposit.id,
        }),
        createBridgeAnnotation({
          transaction: arbitrumDeposit,
          tier: 'heuristic',
          role: 'target',
          counterpartTxFingerprint: ethereumWithdrawal.txFingerprint,
          counterpartTxId: ethereumWithdrawal.id,
        }),
      ],
    });

    expect(analysis.summary.total_issues).toBe(2);
    expect(analysis.issues.map((issue) => issue.gapCue)).toStrictEqual([
      'likely_cross_chain_bridge',
      'likely_cross_chain_bridge',
    ]);
    expect(analysis.issues.map((issue) => issue.gapCueCounterpartTxFingerprint)).toStrictEqual([
      'eth-bridge-withdrawal',
      'arb-bridge-deposit',
    ]);
  });

  it('should leave bridge-like pairs uncued when bridge annotations are absent', () => {
    const ethereumWithdrawal = createBlockchainWithdrawal({
      id: 511,
      accountId: 21,
      txFingerprint: 'eth-bridge-withdrawal-unannotated',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-08-15T18:10:00.000Z',
      timestamp: Date.parse('2024-08-15T18:10:00.000Z'),
      from: '0x15a2000000000000000000000000000000000000',
      to: '0xrouter000000000000000000000000000000000001',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'eth-bridge-withdrawal-unannotated-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:native',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('1.005'),
            netAmount: parseDecimal('1.005'),
          },
        ],
      },
    });

    const arbitrumDeposit = createBlockchainDeposit({
      id: 512,
      accountId: 22,
      txFingerprint: 'arb-bridge-deposit-unannotated',
      platformKey: 'arbitrum',
      platformKind: 'blockchain',
      datetime: '2024-08-15T18:18:00.000Z',
      timestamp: Date.parse('2024-08-15T18:18:00.000Z'),
      from: '0xrouter000000000000000000000000000000000002',
      to: '0x15a2000000000000000000000000000000000000',
      blockchain: {
        name: 'arbitrum',
        transaction_hash: 'arb-bridge-deposit-unannotated-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:arbitrum:native',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('0.998'),
            netAmount: parseDecimal('0.998'),
          },
        ],
        outflows: [],
      },
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    });

    const analysis = analyzeLinkGaps([ethereumWithdrawal, arbitrumDeposit], [], {
      accounts: [
        createMockAccount({
          id: 21,
          identifier: '0x15a2000000000000000000000000000000000000',
          profileId: 1,
        }),
        createMockAccount({
          id: 22,
          identifier: '0x15a2000000000000000000000000000000000000',
          profileId: 1,
        }),
      ],
    });

    expect(analysis.summary.total_issues).toBe(2);
    expect(analysis.issues.every((issue) => issue.gapCue === undefined)).toBe(true);
    expect(analysis.issues.every((issue) => issue.gapCueCounterpartTxFingerprint === undefined)).toBe(true);
  });

  it('should leave same-wallet near-equal inflow then outflow pairs uncued without stronger evidence', () => {
    const usdtDeposit = createBlockchainDeposit({
      id: 412,
      accountId: 30,
      txFingerprint: 'eth-usdt-receipt',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-12-10T19:09:23.000Z',
      timestamp: Date.parse('2024-12-10T19:09:23.000Z'),
      from: '0xd91efec7e42f80156d1d9f660a69847188950747',
      to: '0x15a2000000000000000000000000000000000000',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'eth-usdt-receipt-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:usdt',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('344.581546'),
            netAmount: parseDecimal('344.581546'),
          },
        ],
        outflows: [],
      },
    });

    const usdtForward = createBlockchainWithdrawal({
      id: 413,
      accountId: 30,
      txFingerprint: 'eth-usdt-forward',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-12-10T20:54:35.000Z',
      timestamp: Date.parse('2024-12-10T20:54:35.000Z'),
      from: '0x15a2000000000000000000000000000000000000',
      to: '0xf43f737b917e883773762e84619e35ea74e320e8',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'eth-usdt-forward-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:usdt',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('344.5815'),
            netAmount: parseDecimal('344.5815'),
          },
        ],
      },
    });

    const analysis = analyzeLinkGaps([usdtDeposit, usdtForward], [], {
      accounts: [
        createMockAccount({
          id: 30,
          identifier: '0x15a2000000000000000000000000000000000000',
          profileId: 1,
        }),
      ],
    });

    expect(analysis.summary.total_issues).toBe(2);
    expect(analysis.issues.every((issue) => issue.gapCue === undefined)).toBe(true);
    expect(analysis.issues.every((issue) => issue.gapCueCounterpartTxFingerprint === undefined)).toBe(true);
  });

  it('should cue a unique native funding plus token receipt pair as a likely correlated service swap and leave the later token withdrawal uncued', () => {
    const ethFunding = createBlockchainWithdrawal({
      id: 414,
      accountId: 30,
      txFingerprint: 'eth-service-funding',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-12-10T19:00:59.000Z',
      timestamp: Date.parse('2024-12-10T19:00:59.000Z'),
      from: '0x15a2000000000000000000000000000000000000',
      to: '0xf43f737b917e883773762e84619e35ea74e320e8',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'eth-service-funding-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:native',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('0.1'),
            netAmount: parseDecimal('0.1'),
          },
        ],
      },
    });

    const usdtDeposit = createBlockchainDeposit({
      id: 415,
      accountId: 30,
      txFingerprint: 'eth-usdt-service-receipt',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-12-10T19:09:23.000Z',
      timestamp: Date.parse('2024-12-10T19:09:23.000Z'),
      from: '0xd91efec7e42f80156d1d9f660a69847188950747',
      to: '0x15a2000000000000000000000000000000000000',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'eth-usdt-service-receipt-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:usdt',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('344.581546'),
            netAmount: parseDecimal('344.581546'),
          },
        ],
        outflows: [],
      },
    });

    const usdtForward = createBlockchainWithdrawal({
      id: 416,
      accountId: 30,
      txFingerprint: 'eth-usdt-service-forward',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-12-10T20:54:35.000Z',
      timestamp: Date.parse('2024-12-10T20:54:35.000Z'),
      from: '0x15a2000000000000000000000000000000000000',
      to: '0xf43f737b917e883773762e84619e35ea74e320e8',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'eth-usdt-service-forward-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:usdt',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('344.5815'),
            netAmount: parseDecimal('344.5815'),
          },
        ],
      },
    });

    const analysis = analyzeLinkGaps([ethFunding, usdtDeposit, usdtForward], [], {
      accounts: [
        createMockAccount({
          id: 30,
          identifier: '0x15a2000000000000000000000000000000000000',
          profileId: 1,
        }),
      ],
    });

    expect(analysis.summary.total_issues).toBe(3);
    expect(
      Object.fromEntries(
        analysis.issues.map((issue) => [
          issue.txFingerprint,
          {
            gapCue: issue.gapCue,
            gapCueCounterpartTxFingerprint: issue.gapCueCounterpartTxFingerprint,
          },
        ])
      )
    ).toStrictEqual({
      'eth-service-funding': {
        gapCue: 'likely_correlated_service_swap',
        gapCueCounterpartTxFingerprint: 'eth-usdt-service-receipt',
      },
      'eth-usdt-service-forward': {
        gapCue: undefined,
        gapCueCounterpartTxFingerprint: undefined,
      },
      'eth-usdt-service-receipt': {
        gapCue: 'likely_correlated_service_swap',
        gapCueCounterpartTxFingerprint: 'eth-service-funding',
      },
    });
  });

  it('should leave token receipt and later withdrawal uncued when multiple native fundings could explain the same token receipt', () => {
    const firstFunding = createBlockchainWithdrawal({
      id: 417,
      accountId: 30,
      txFingerprint: 'eth-service-funding-first',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-12-10T18:58:00.000Z',
      timestamp: Date.parse('2024-12-10T18:58:00.000Z'),
      from: '0x15a2000000000000000000000000000000000000',
      to: '0xf43f737b917e883773762e84619e35ea74e320e8',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'eth-service-funding-first-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:native',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('0.05'),
            netAmount: parseDecimal('0.05'),
          },
        ],
      },
    });

    const secondFunding = createBlockchainWithdrawal({
      id: 418,
      accountId: 30,
      txFingerprint: 'eth-service-funding-second',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-12-10T19:00:59.000Z',
      timestamp: Date.parse('2024-12-10T19:00:59.000Z'),
      from: '0x15a2000000000000000000000000000000000000',
      to: '0xf43f737b917e883773762e84619e35ea74e320e8',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'eth-service-funding-second-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:native',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('0.1'),
            netAmount: parseDecimal('0.1'),
          },
        ],
      },
    });

    const usdtDeposit = createBlockchainDeposit({
      id: 419,
      accountId: 30,
      txFingerprint: 'eth-usdt-service-receipt-ambiguous',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-12-10T19:09:23.000Z',
      timestamp: Date.parse('2024-12-10T19:09:23.000Z'),
      from: '0xd91efec7e42f80156d1d9f660a69847188950747',
      to: '0x15a2000000000000000000000000000000000000',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'eth-usdt-service-receipt-ambiguous-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:usdt',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('344.581546'),
            netAmount: parseDecimal('344.581546'),
          },
        ],
        outflows: [],
      },
    });

    const usdtForward = createBlockchainWithdrawal({
      id: 420,
      accountId: 30,
      txFingerprint: 'eth-usdt-service-forward-ambiguous',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-12-10T20:54:35.000Z',
      timestamp: Date.parse('2024-12-10T20:54:35.000Z'),
      from: '0x15a2000000000000000000000000000000000000',
      to: '0xf43f737b917e883773762e84619e35ea74e320e8',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'eth-usdt-service-forward-ambiguous-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:usdt',
            assetSymbol: 'USDT' as Currency,
            grossAmount: parseDecimal('344.5815'),
            netAmount: parseDecimal('344.5815'),
          },
        ],
      },
    });

    const analysis = analyzeLinkGaps([firstFunding, secondFunding, usdtDeposit, usdtForward], [], {
      accounts: [
        createMockAccount({
          id: 30,
          identifier: '0x15a2000000000000000000000000000000000000',
          profileId: 1,
        }),
      ],
    });

    expect(analysis.summary.total_issues).toBe(4);
    expect(Object.fromEntries(analysis.issues.map((issue) => [issue.txFingerprint, issue.gapCue]))).toStrictEqual({
      'eth-service-funding-first': undefined,
      'eth-service-funding-second': undefined,
      'eth-usdt-service-forward-ambiguous': undefined,
      'eth-usdt-service-receipt-ambiguous': undefined,
    });
  });

  it('should not cue same-asset cross-chain pairs across different profiles', () => {
    const renderWithdrawal = createBlockchainWithdrawal({
      id: 403,
      accountId: 11,
      txFingerprint: 'render-ethereum-withdrawal-different-profile',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:36:47.000Z',
      timestamp: Date.parse('2024-07-30T22:36:47.000Z'),
      from: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
      to: '0x3ee18b2214aff97000d974cf647e7c347e8fa585',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'render-ethereum-withdrawal-different-profile-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:render',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('80.61'),
            netAmount: parseDecimal('80.61'),
          },
        ],
      },
    });

    const renderDeposit = createBlockchainDeposit({
      id: 404,
      accountId: 15,
      txFingerprint: 'render-solana-deposit-different-profile',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:53:40.000Z',
      timestamp: Date.parse('2024-07-30T22:53:40.000Z'),
      from: 'AYm4Knn6Sw1f52Eq42ujQ2ez5Xb7iBJeviprFCA7ADCy',
      to: 'GRyBys8cE2rLiaqvAYEAWL3U3dkmifY8TKXWX2tdioj4',
      blockchain: {
        name: 'solana',
        transaction_hash: 'render-solana-deposit-different-profile-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:solana:render',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('80.61'),
            netAmount: parseDecimal('80.61'),
          },
        ],
        outflows: [],
      },
    });

    const analysis = analyzeLinkGaps([renderWithdrawal, renderDeposit], [], {
      accounts: [
        createMockAccount({
          id: 11,
          identifier: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
          profileId: 1,
        }),
        createMockAccount({
          id: 15,
          identifier: 'GRyBys8cE2rLiaqvAYEAWL3U3dkmifY8TKXWX2tdioj4',
          profileId: 2,
        }),
      ],
    });

    expect(analysis.summary.total_issues).toBe(2);
    expect(analysis.issues.every((issue) => issue.gapCue === undefined)).toBe(true);
  });

  it('should not cue ambiguous same-amount cross-chain candidates when one side has multiple matches', () => {
    const renderWithdrawal = createBlockchainWithdrawal({
      id: 405,
      accountId: 11,
      txFingerprint: 'render-ethereum-withdrawal-ambiguous',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:36:47.000Z',
      timestamp: Date.parse('2024-07-30T22:36:47.000Z'),
      from: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
      to: '0x3ee18b2214aff97000d974cf647e7c347e8fa585',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'render-ethereum-withdrawal-ambiguous-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:render',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('80.61'),
            netAmount: parseDecimal('80.61'),
          },
        ],
      },
    });

    const solanaDeposit = createBlockchainDeposit({
      id: 406,
      accountId: 15,
      txFingerprint: 'render-solana-deposit-ambiguous',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:53:40.000Z',
      timestamp: Date.parse('2024-07-30T22:53:40.000Z'),
      from: 'AYm4Knn6Sw1f52Eq42ujQ2ez5Xb7iBJeviprFCA7ADCy',
      to: 'GRyBys8cE2rLiaqvAYEAWL3U3dkmifY8TKXWX2tdioj4',
      blockchain: {
        name: 'solana',
        transaction_hash: 'render-solana-deposit-ambiguous-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:solana:render',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('80.61'),
            netAmount: parseDecimal('80.61'),
          },
        ],
        outflows: [],
      },
    });

    const polygonDeposit = createBlockchainDeposit({
      id: 407,
      accountId: 16,
      txFingerprint: 'render-polygon-deposit-ambiguous',
      platformKey: 'polygon',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:54:10.000Z',
      timestamp: Date.parse('2024-07-30T22:54:10.000Z'),
      from: '0xrouter000000000000000000000000000000000001',
      to: '0x9999999999999999999999999999999999999999',
      blockchain: {
        name: 'polygon',
        transaction_hash: 'render-polygon-deposit-ambiguous-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:polygon:render',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('80.61'),
            netAmount: parseDecimal('80.61'),
          },
        ],
        outflows: [],
      },
    });

    const analysis = analyzeLinkGaps([renderWithdrawal, solanaDeposit, polygonDeposit], [], {
      accounts: [
        createMockAccount({
          id: 11,
          identifier: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
          profileId: 1,
        }),
        createMockAccount({
          id: 15,
          identifier: 'GRyBys8cE2rLiaqvAYEAWL3U3dkmifY8TKXWX2tdioj4',
          profileId: 1,
        }),
        createMockAccount({
          id: 16,
          identifier: '0x9999999999999999999999999999999999999999',
          profileId: 1,
        }),
      ],
    });

    expect(analysis.summary.total_issues).toBe(3);
    expect(analysis.issues.every((issue) => issue.gapCue === undefined)).toBe(true);
  });

  it('should not cue same-symbol cross-chain pairs when the amounts differ', () => {
    const renderWithdrawal = createBlockchainWithdrawal({
      id: 408,
      accountId: 11,
      txFingerprint: 'render-ethereum-withdrawal-different-amount',
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:36:47.000Z',
      timestamp: Date.parse('2024-07-30T22:36:47.000Z'),
      from: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
      to: '0x3ee18b2214aff97000d974cf647e7c347e8fa585',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'render-ethereum-withdrawal-different-amount-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:ethereum:render',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('80.61'),
            netAmount: parseDecimal('80.61'),
          },
        ],
      },
    });

    const renderDeposit = createBlockchainDeposit({
      id: 409,
      accountId: 15,
      txFingerprint: 'render-solana-deposit-different-amount',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2024-07-30T22:53:40.000Z',
      timestamp: Date.parse('2024-07-30T22:53:40.000Z'),
      from: 'AYm4Knn6Sw1f52Eq42ujQ2ez5Xb7iBJeviprFCA7ADCy',
      to: 'GRyBys8cE2rLiaqvAYEAWL3U3dkmifY8TKXWX2tdioj4',
      blockchain: {
        name: 'solana',
        transaction_hash: 'render-solana-deposit-different-amount-hash',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:solana:render',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('80.4'),
            netAmount: parseDecimal('80.4'),
          },
        ],
        outflows: [],
      },
    });

    const analysis = analyzeLinkGaps([renderWithdrawal, renderDeposit], [], {
      accounts: [
        createMockAccount({
          id: 11,
          identifier: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
          profileId: 1,
        }),
        createMockAccount({
          id: 15,
          identifier: 'GRyBys8cE2rLiaqvAYEAWL3U3dkmifY8TKXWX2tdioj4',
          profileId: 1,
        }),
      ],
    });

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

  it('adds a likely asset migration cue when a migration-marked exchange counterpart exists', () => {
    const withdrawal = withPossibleAssetMigrationDiagnostic(
      createExchangeWithdrawal({
        id: 32,
        txFingerprint: 'kraken-rndr-outflow',
        movements: {
          inflows: [],
          outflows: [
            {
              assetId: 'exchange:kraken:rndr',
              assetSymbol: 'RNDR' as Currency,
              grossAmount: parseDecimal('64.98757287'),
              netAmount: parseDecimal('64.98757287'),
            },
          ],
        },
      }),
      'migration-group-rndr'
    );
    const deposit = withPossibleAssetMigrationDiagnostic(
      createMockTransaction({
        id: 33,
        txFingerprint: 'kraken-render-inflow',
        platformKey: 'kraken',
        platformKind: 'exchange',
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
        movements: {
          inflows: [
            {
              assetId: 'exchange:kraken:render',
              assetSymbol: 'RENDER' as Currency,
              grossAmount: parseDecimal('64.987572'),
              netAmount: parseDecimal('64.987572'),
            },
          ],
          outflows: [],
        },
      }),
      'migration-group-render'
    );

    const analysis = analyzeLinkGaps([withdrawal, deposit], []);

    expect(analysis.summary.total_issues).toBe(2);
    expect(analysis.summary.unmatched_outflows).toBe(1);
    expect(analysis.summary.uncovered_inflows).toBe(1);
    expect(analysis.issues).toContainEqual(
      expect.objectContaining({
        assetId: 'exchange:kraken:rndr',
        contextHint: expect.objectContaining({
          code: POSSIBLE_ASSET_MIGRATION_DIAGNOSTIC_CODE,
        }),
        gapCue: 'likely_asset_migration',
        gapCueCounterpartTxFingerprint: 'kraken-render-inflow',
      })
    );
    expect(analysis.issues).toContainEqual(
      expect.objectContaining({
        assetId: 'exchange:kraken:render',
        direction: 'inflow',
        contextHint: expect.objectContaining({
          code: POSSIBLE_ASSET_MIGRATION_DIAGNOSTIC_CODE,
        }),
        gapCue: 'likely_asset_migration',
        gapCueCounterpartTxFingerprint: 'kraken-rndr-outflow',
      })
    );
  });

  it('flags exchange inflows without blockchain metadata when they are unresolved acquisitions', () => {
    const analysis = analyzeLinkGaps(
      [
        createMockTransaction({
          id: 34,
          txFingerprint: 'kraken-render-credit',
          platformKey: 'kraken',
          platformKind: 'exchange',
          operation: {
            category: 'transfer',
            type: 'deposit',
          },
          movements: {
            inflows: [
              {
                assetId: 'exchange:kraken:render',
                assetSymbol: 'RENDER' as Currency,
                grossAmount: parseDecimal('64.987572'),
                netAmount: parseDecimal('64.987572'),
              },
            ],
            outflows: [],
          },
        }),
      ],
      []
    );

    expect(analysis.summary.total_issues).toBe(1);
    expect(analysis.summary.uncovered_inflows).toBe(1);
    expect(analysis.summary.unmatched_outflows).toBe(0);
    expect(analysis.issues[0]).toMatchObject({
      direction: 'inflow',
      assetId: 'exchange:kraken:render',
      platformKey: 'kraken',
    });
  });

  it('suppresses one-sided fiat exchange inflows from gaps', () => {
    const analysis = analyzeLinkGaps(
      [
        createMockTransaction({
          id: 35,
          txFingerprint: 'kraken-cad-credit',
          platformKey: 'kraken',
          platformKind: 'exchange',
          operation: {
            category: 'transfer',
            type: 'deposit',
          },
          movements: {
            inflows: [
              {
                assetId: 'exchange:kraken:cad',
                assetSymbol: 'CAD' as Currency,
                grossAmount: parseDecimal('1000'),
                netAmount: parseDecimal('1000'),
              },
            ],
            outflows: [],
          },
        }),
      ],
      []
    );

    expect(analysis.summary.total_issues).toBe(0);
    expect(analysis.summary.uncovered_inflows).toBe(0);
    expect(analysis.summary.unmatched_outflows).toBe(0);
    expect(analysis.issues).toHaveLength(0);
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
