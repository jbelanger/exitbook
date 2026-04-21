/* eslint-disable @typescript-eslint/no-unsafe-assignment -- handler tests intentionally mock runtime boundaries and matcher helpers. */
import { ok } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createMockLink } from '../../../__tests__/test-utils.js';

const {
  mockAppendLinkOverrideEvents,
  mockBuildAccountingModelFromTransactions,
  mockBuildManualLinkOverrideMetadata,
  mockGetDefaultReviewer,
  mockPrepareGroupedManualLinksFromTransactions,
  mockValidateTransferProposalConfirmability,
} = vi.hoisted(() => ({
  mockAppendLinkOverrideEvents: vi.fn(),
  mockBuildAccountingModelFromTransactions: vi.fn(),
  mockBuildManualLinkOverrideMetadata: vi.fn(),
  mockGetDefaultReviewer: vi.fn(),
  mockPrepareGroupedManualLinksFromTransactions: vi.fn(),
  mockValidateTransferProposalConfirmability: vi.fn(),
}));

vi.mock('@exitbook/accounting/accounting-model', () => ({
  buildAccountingModelFromTransactions: mockBuildAccountingModelFromTransactions,
}));

vi.mock('@exitbook/accounting/linking', () => ({
  buildManualLinkOverrideMetadata: mockBuildManualLinkOverrideMetadata,
  prepareGroupedManualLinksFromTransactions: mockPrepareGroupedManualLinksFromTransactions,
  validateTransferProposalConfirmability: mockValidateTransferProposalConfirmability,
}));

vi.mock('../../review/link-review-policy.js', () => ({
  getDefaultReviewer: mockGetDefaultReviewer,
}));

vi.mock('../../review/links-override-append.js', () => ({
  appendLinkOverrideEvents: mockAppendLinkOverrideEvents,
}));

import { ManualGroupedLinkCreateHandler } from '../links-create-grouped-handler.js';

function createLinkableMovement(
  transactionId: number,
  direction: 'in' | 'out',
  amount: string,
  movementFingerprint: string,
  assetId: string
) {
  return {
    id: transactionId * 10 + (direction === 'out' ? 1 : 2),
    transactionId,
    accountId: transactionId,
    platformKey: transactionId === 3 ? 'kucoin' : 'cardano',
    platformKind: transactionId === 3 ? 'exchange' : 'blockchain',
    assetId,
    assetSymbol: 'ADA',
    direction,
    amount: parseDecimal(amount),
    timestamp: new Date('2026-04-14T12:00:00.000Z'),
    isInternal: false,
    excluded: false,
    movementFingerprint,
  };
}

function createPreparedGroupedManualLinks() {
  const reviewedAt = new Date('2026-04-14T12:00:00.000Z');
  const targetMovement = createLinkableMovement(3, 'in', '25', 'movement:target:3:in', 'exchange:kucoin:ada');

  const sourceTransactionA = {
    id: 1,
    accountId: 1,
    txFingerprint: '78a82e8482aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    platformKey: 'cardano',
    platformKind: 'blockchain',
  };
  const sourceTransactionB = {
    id: 2,
    accountId: 2,
    txFingerprint: 'd0c794045dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    platformKey: 'cardano',
    platformKind: 'blockchain',
  };
  const targetTransaction = {
    id: 3,
    accountId: 3,
    txFingerprint: '38adc7a548cccccccccccccccccccccccccccccccccccccccccccccccccccc',
    platformKey: 'kucoin',
    platformKind: 'exchange',
  };

  return {
    shape: 'many-to-one' as const,
    entries: [
      {
        link: {
          sourceTransactionId: 1,
          targetTransactionId: 3,
          assetSymbol: 'ADA' as never,
          sourceAssetId: 'blockchain:cardano:ada',
          targetAssetId: 'exchange:kucoin:ada',
          sourceAmount: parseDecimal('10'),
          targetAmount: parseDecimal('10'),
          sourceMovementFingerprint: 'movement:source:1:out',
          targetMovementFingerprint: 'movement:target:3:in',
          linkType: 'blockchain_to_exchange' as const,
          confidenceScore: parseDecimal('1'),
          impliedFeeAmount: undefined,
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0'),
            timingValid: true,
            timingHours: 0,
          },
          status: 'confirmed' as const,
          reviewedBy: 'cli-user',
          reviewedAt,
          createdAt: reviewedAt,
          updatedAt: reviewedAt,
          metadata: {
            partialMatch: true,
            fullSourceAmount: '10',
            fullTargetAmount: '25',
            consumedAmount: '10',
          },
        },
        sourceMovement: createLinkableMovement(1, 'out', '10', 'movement:source:1:out', 'blockchain:cardano:ada'),
        sourceTransaction: sourceTransactionA,
        targetMovement,
        targetTransaction,
      },
      {
        link: {
          sourceTransactionId: 2,
          targetTransactionId: 3,
          assetSymbol: 'ADA' as never,
          sourceAssetId: 'blockchain:cardano:ada',
          targetAssetId: 'exchange:kucoin:ada',
          sourceAmount: parseDecimal('15'),
          targetAmount: parseDecimal('15'),
          sourceMovementFingerprint: 'movement:source:2:out',
          targetMovementFingerprint: 'movement:target:3:in',
          linkType: 'blockchain_to_exchange' as const,
          confidenceScore: parseDecimal('1'),
          impliedFeeAmount: undefined,
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0'),
            timingValid: true,
            timingHours: 0,
          },
          status: 'confirmed' as const,
          reviewedBy: 'cli-user',
          reviewedAt,
          createdAt: reviewedAt,
          updatedAt: reviewedAt,
          metadata: {
            partialMatch: true,
            fullSourceAmount: '15',
            fullTargetAmount: '25',
            consumedAmount: '15',
          },
        },
        sourceMovement: createLinkableMovement(2, 'out', '15', 'movement:source:2:out', 'blockchain:cardano:ada'),
        sourceTransaction: sourceTransactionB,
        targetMovement,
        targetTransaction,
      },
    ],
  };
}

function withExplainedTargetResidual(
  prepared: ReturnType<typeof createPreparedGroupedManualLinks>,
  amount: string,
  role: 'protocol_overhead' | 'refund_rebate' | 'staking_reward'
) {
  return {
    ...prepared,
    entries: prepared.entries.map((entry) => ({
      ...entry,
      link: {
        ...entry.link,
        metadata: {
          ...(entry.link.metadata ?? {}),
          explainedTargetResidualAmount: amount,
          explainedTargetResidualRole: role,
        },
      },
    })),
  };
}

function createDatabase(
  prepared = createPreparedGroupedManualLinks(),
  existingLinks = [] as ReturnType<typeof createMockLink>[]
) {
  const transactionLinks = {
    create: vi.fn(),
    findAll: vi.fn().mockResolvedValue(ok(existingLinks)),
    updateStatuses: vi.fn(),
  };
  const transactions = {
    findAll: vi
      .fn()
      .mockResolvedValue(
        ok(prepared.entries.map((entry) => entry.sourceTransaction).concat([prepared.entries[0]!.targetTransaction]))
      ),
    findByFingerprintRef: vi.fn().mockImplementation(async (_profileId: number, fingerprintRef: string) => {
      const candidates = [
        prepared.entries[0]!.sourceTransaction,
        prepared.entries[1]!.sourceTransaction,
        prepared.entries[0]!.targetTransaction,
      ];
      return ok(candidates.find((candidate) => candidate.txFingerprint.startsWith(fingerprintRef)));
    }),
    findById: vi.fn().mockImplementation(async (transactionId: number) => {
      const candidates = [
        prepared.entries[0]!.sourceTransaction,
        prepared.entries[1]!.sourceTransaction,
        prepared.entries[0]!.targetTransaction,
      ];
      return ok(candidates.find((candidate) => candidate.id === transactionId));
    }),
  };
  const transactionAnnotations = {
    readAnnotations: vi.fn().mockResolvedValue(ok([])),
  };

  return {
    executeInTransaction: vi.fn(async (fn: (tx: { transactionLinks: typeof transactionLinks }) => Promise<unknown>) =>
      fn({ transactionLinks })
    ),
    transactionAnnotations,
    transactionLinks,
    transactions,
  };
}

describe('ManualGroupedLinkCreateHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultReviewer.mockReturnValue('cli-user');
    mockBuildAccountingModelFromTransactions.mockReturnValue(ok({ accountingTransactionViews: [] }));
    mockValidateTransferProposalConfirmability.mockReturnValue(ok(undefined));
    mockBuildManualLinkOverrideMetadata.mockImplementation((overrideId: string, overrideLinkType: string) => ({
      overrideId,
      overrideLinkType,
      linkProvenance: 'manual',
    }));
    mockAppendLinkOverrideEvents.mockResolvedValue(ok([{ id: 'override-1' }, { id: 'override-2' }]));
  });

  it('creates grouped manual links and persists override events atomically', async () => {
    const prepared = withExplainedTargetResidual(createPreparedGroupedManualLinks(), '10.524451', 'staking_reward');
    const database = createDatabase(prepared);
    database.transactionLinks.create.mockResolvedValueOnce(ok(91)).mockResolvedValueOnce(ok(92));
    mockPrepareGroupedManualLinksFromTransactions.mockReturnValue(ok(prepared));
    const handler = new ManualGroupedLinkCreateHandler(database as never, 1, 'default', {
      tag: 'override-store',
    } as never);

    const result = await handler.create({
      assetSymbol: 'ADA' as never,
      explainedTargetResidual: {
        amount: '10.524451',
        role: 'staking_reward',
      },
      reason: 'Wallet consolidation',
      sourceSelectors: ['78a82e8482', 'd0c794045d'],
      targetSelectors: ['38adc7a548'],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      action: 'created',
      changed: true,
      assetSymbol: 'ADA',
      createdCount: 2,
      confirmedExistingCount: 0,
      explainedTargetResidualAmount: '10.524451',
      explainedTargetResidualRole: 'staking_reward',
      unchangedCount: 0,
      groupShape: 'many-to-one',
      sourceCount: 2,
      targetCount: 1,
      reason: 'Wallet consolidation',
    });
    expect(mockAppendLinkOverrideEvents).toHaveBeenCalledWith(
      expect.any(Object),
      { tag: 'override-store' },
      'default',
      [
        expect.objectContaining({
          metadata: expect.objectContaining({
            explainedTargetResidualAmount: '10.524451',
            explainedTargetResidualRole: 'staking_reward',
          }),
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({
            explainedTargetResidualAmount: '10.524451',
            explainedTargetResidualRole: 'staking_reward',
          }),
        }),
      ],
      'Wallet consolidation'
    );
    expect(database.transactionAnnotations.readAnnotations).toHaveBeenCalledWith({
      kinds: ['asset_migration_participant'],
      tiers: ['asserted', 'heuristic'],
      transactionIds: [1, 2, 3],
    });
    expect(mockPrepareGroupedManualLinksFromTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        explainedTargetResidual: expect.objectContaining({
          amount: expect.objectContaining({ toFixed: expect.any(Function) }),
          role: 'staking_reward',
        }),
        transactionAnnotations: [],
      }),
      expect.anything()
    );
    expect(database.transactionLinks.create).toHaveBeenCalledTimes(2);
  });

  it('confirms existing grouped rows in place and creates missing ones without mixing entry ids', async () => {
    const prepared = withExplainedTargetResidual(createPreparedGroupedManualLinks(), '10.524451', 'staking_reward');
    const existingLink = {
      ...createMockLink(55, { status: 'suggested' }),
      sourceTransactionId: prepared.entries[0]!.link.sourceTransactionId,
      targetTransactionId: prepared.entries[0]!.link.targetTransactionId,
      assetSymbol: prepared.entries[0]!.link.assetSymbol,
      sourceAssetId: prepared.entries[0]!.link.sourceAssetId,
      targetAssetId: prepared.entries[0]!.link.targetAssetId,
      sourceAmount: prepared.entries[0]!.link.sourceAmount,
      targetAmount: prepared.entries[0]!.link.targetAmount,
      sourceMovementFingerprint: prepared.entries[0]!.link.sourceMovementFingerprint,
      targetMovementFingerprint: prepared.entries[0]!.link.targetMovementFingerprint,
      linkType: prepared.entries[0]!.link.linkType,
    };
    const database = createDatabase(prepared, [existingLink]);
    database.transactionLinks.updateStatuses.mockResolvedValue(ok(1));
    database.transactionLinks.create.mockResolvedValueOnce(ok(91));
    mockPrepareGroupedManualLinksFromTransactions.mockReturnValue(ok(prepared));
    mockAppendLinkOverrideEvents.mockResolvedValue(ok([{ id: 'override-1' }, { id: 'override-2' }]));
    const handler = new ManualGroupedLinkCreateHandler(database as never, 1, 'default', {
      tag: 'override-store',
    } as never);

    const result = await handler.create({
      assetSymbol: 'ADA' as never,
      sourceSelectors: ['78a82e8482', 'd0c794045d'],
      targetSelectors: ['38adc7a548'],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      action: 'mixed',
      createdCount: 1,
      confirmedExistingCount: 1,
      unchangedCount: 0,
    });
    expect(result.value.links[0]).toMatchObject({
      action: 'confirmed-existing',
      existingStatusBefore: 'suggested',
      linkId: 55,
    });
    expect(result.value.links[1]).toMatchObject({
      action: 'created',
      linkId: 91,
    });
    expect(database.transactionLinks.updateStatuses).toHaveBeenCalledTimes(1);
    expect(database.transactionLinks.updateStatuses).toHaveBeenCalledWith(
      [55],
      'confirmed',
      'cli-user',
      new Map([
        [
          55,
          expect.objectContaining({
            explainedTargetResidualAmount: '10.524451',
            explainedTargetResidualRole: 'staking_reward',
          }),
        ],
      ])
    );
    expect(database.transactionLinks.create).toHaveBeenCalledTimes(1);
  });

  it('returns unchanged when every grouped link is already confirmed', async () => {
    const prepared = createPreparedGroupedManualLinks();
    const existingLinks = prepared.entries.map((entry, index) => ({
      ...createMockLink(60 + index, { status: 'confirmed', reviewedBy: 'reviewer' }),
      sourceTransactionId: entry.link.sourceTransactionId,
      targetTransactionId: entry.link.targetTransactionId,
      assetSymbol: entry.link.assetSymbol,
      sourceAssetId: entry.link.sourceAssetId,
      targetAssetId: entry.link.targetAssetId,
      sourceAmount: entry.link.sourceAmount,
      targetAmount: entry.link.targetAmount,
      sourceMovementFingerprint: entry.link.sourceMovementFingerprint,
      targetMovementFingerprint: entry.link.targetMovementFingerprint,
      linkType: entry.link.linkType,
    }));
    const database = createDatabase(prepared, existingLinks);
    mockPrepareGroupedManualLinksFromTransactions.mockReturnValue(ok(prepared));
    const handler = new ManualGroupedLinkCreateHandler(database as never, 1, 'default', {
      tag: 'override-store',
    } as never);

    const result = await handler.create({
      assetSymbol: 'ADA' as never,
      sourceSelectors: ['78a82e8482', 'd0c794045d'],
      targetSelectors: ['38adc7a548'],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      action: 'already-confirmed',
      changed: false,
      createdCount: 0,
      confirmedExistingCount: 0,
      unchangedCount: 2,
    });
    expect(mockAppendLinkOverrideEvents).not.toHaveBeenCalled();
    expect(database.transactionLinks.updateStatuses).not.toHaveBeenCalled();
    expect(database.transactionLinks.create).not.toHaveBeenCalled();
  });
});
