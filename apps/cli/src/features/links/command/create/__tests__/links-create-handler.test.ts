/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
import { ok } from '@exitbook/foundation';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createConfirmableTransferFixture, createMockLink } from '../../../__tests__/test-utils.js';

const {
  mockAppendLinkOverrideEvent,
  mockBuildAccountingLayerFromTransactions,
  mockBuildManualLinkOverrideMetadata,
  mockGetDefaultReviewer,
  mockPrepareManualLinkFromTransactions,
  mockValidateTransferProposalConfirmability,
} = vi.hoisted(() => ({
  mockAppendLinkOverrideEvent: vi.fn(),
  mockBuildAccountingLayerFromTransactions: vi.fn(),
  mockBuildManualLinkOverrideMetadata: vi.fn(),
  mockGetDefaultReviewer: vi.fn(),
  mockPrepareManualLinkFromTransactions: vi.fn(),
  mockValidateTransferProposalConfirmability: vi.fn(),
}));

vi.mock('@exitbook/accounting/accounting-layer', () => ({
  buildAccountingLayerFromTransactions: mockBuildAccountingLayerFromTransactions,
}));

vi.mock('@exitbook/accounting/linking', () => ({
  buildManualLinkOverrideMetadata: mockBuildManualLinkOverrideMetadata,
  prepareManualLinkFromTransactions: mockPrepareManualLinkFromTransactions,
  validateTransferProposalConfirmability: mockValidateTransferProposalConfirmability,
}));

vi.mock('../../review/link-review-policy.js', () => ({
  getDefaultReviewer: mockGetDefaultReviewer,
}));

vi.mock('../../review/links-override-append.js', () => ({
  appendLinkOverrideEvent: mockAppendLinkOverrideEvent,
}));

import { ManualLinkCreateHandler } from '../links-create-handler.js';

function createPreparedManualLink() {
  const fixture = createConfirmableTransferFixture({ sourceAmount: '80.61', targetAmount: '80.61' });

  return {
    link: {
      sourceTransactionId: fixture.link.sourceTransactionId,
      targetTransactionId: fixture.link.targetTransactionId,
      assetSymbol: fixture.link.assetSymbol,
      sourceAssetId: fixture.link.sourceAssetId,
      targetAssetId: fixture.link.targetAssetId,
      sourceAmount: fixture.link.sourceAmount,
      targetAmount: fixture.link.targetAmount,
      sourceMovementFingerprint: fixture.link.sourceMovementFingerprint,
      targetMovementFingerprint: fixture.link.targetMovementFingerprint,
      linkType: fixture.link.linkType,
      confidenceScore: fixture.link.confidenceScore,
      impliedFeeAmount: fixture.link.impliedFeeAmount,
      matchCriteria: fixture.link.matchCriteria,
      status: 'confirmed' as const,
      reviewedBy: 'cli-user',
      reviewedAt: new Date('2026-04-10T12:00:00.000Z'),
      createdAt: new Date('2026-04-10T12:00:00.000Z'),
      updatedAt: new Date('2026-04-10T12:00:00.000Z'),
      metadata: fixture.link.metadata,
    },
    sourceMovement: fixture.sourceTransaction.movements.outflows![0]!,
    sourceTransaction: fixture.sourceTransaction,
    targetMovement: fixture.targetTransaction.movements.inflows![0]!,
    targetTransaction: fixture.targetTransaction,
  };
}

function createDatabase(
  prepared = createPreparedManualLink(),
  existingLinks = [] as ReturnType<typeof createMockLink>[]
) {
  const transactionLinks = {
    create: vi.fn(),
    findAll: vi.fn().mockResolvedValue(ok(existingLinks)),
    updateStatuses: vi.fn(),
  };
  const transactions = {
    findAll: vi.fn().mockResolvedValue(ok([prepared.sourceTransaction, prepared.targetTransaction])),
    findByFingerprintRef: vi.fn().mockImplementation(async (_profileId: number, fingerprintRef: string) => {
      if (prepared.sourceTransaction.txFingerprint.startsWith(fingerprintRef)) {
        return ok(prepared.sourceTransaction);
      }

      if (prepared.targetTransaction.txFingerprint.startsWith(fingerprintRef)) {
        return ok(prepared.targetTransaction);
      }

      return ok(undefined);
    }),
    findById: vi.fn().mockImplementation(async (transactionId: number) => {
      if (transactionId === prepared.sourceTransaction.id) {
        return ok(prepared.sourceTransaction);
      }

      if (transactionId === prepared.targetTransaction.id) {
        return ok(prepared.targetTransaction);
      }

      return ok(undefined);
    }),
  };

  return {
    executeInTransaction: vi.fn(async (fn: (tx: { transactionLinks: typeof transactionLinks }) => Promise<unknown>) =>
      fn({ transactionLinks })
    ),
    transactionLinks,
    transactions,
  };
}

describe('ManualLinkCreateHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultReviewer.mockReturnValue('cli-user');
    mockBuildAccountingLayerFromTransactions.mockReturnValue(ok({ accountingTransactionViews: [] }));
    mockValidateTransferProposalConfirmability.mockReturnValue(ok(undefined));
    mockBuildManualLinkOverrideMetadata.mockImplementation((overrideId: string, overrideLinkType: string) => ({
      overrideId,
      overrideLinkType,
      linkProvenance: 'manual',
    }));
    mockAppendLinkOverrideEvent.mockResolvedValue(ok({ id: 'override-1' }));
  });

  it('creates a new confirmed manual link and stores the override metadata on the row', async () => {
    const prepared = createPreparedManualLink();
    const database = createDatabase(prepared);
    database.transactionLinks.create.mockResolvedValue(ok(91));
    mockPrepareManualLinkFromTransactions.mockReturnValue(ok(prepared));
    const handler = new ManualLinkCreateHandler(database as never, 1, 'default', { tag: 'override-store' } as never);

    const result = await handler.create({
      assetSymbol: prepared.link.assetSymbol,
      sourceSelector: prepared.sourceTransaction.txFingerprint.slice(0, 10),
      targetSelector: prepared.targetTransaction.txFingerprint.slice(0, 10),
      reason: 'Token migration',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      action: 'created',
      changed: true,
      assetSymbol: prepared.link.assetSymbol,
      linkId: 91,
      reason: 'Token migration',
    });
    expect(mockAppendLinkOverrideEvent).toHaveBeenCalledWith(
      expect.any(Object),
      { tag: 'override-store' },
      'default',
      prepared.link,
      'Token migration'
    );
    expect(database.transactionLinks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          overrideId: 'override-1',
          overrideLinkType: 'transfer',
          linkProvenance: 'manual',
        }),
      })
    );
    expect(database.transactionLinks.updateStatuses).not.toHaveBeenCalled();
  });

  it('confirms an existing exact link instead of creating a duplicate row', async () => {
    const prepared = createPreparedManualLink();
    const existingLink = {
      ...createMockLink(55, { status: 'suggested' }),
      sourceTransactionId: prepared.link.sourceTransactionId,
      targetTransactionId: prepared.link.targetTransactionId,
      assetSymbol: prepared.link.assetSymbol,
      sourceAssetId: prepared.link.sourceAssetId,
      targetAssetId: prepared.link.targetAssetId,
      sourceAmount: prepared.link.sourceAmount,
      targetAmount: prepared.link.targetAmount,
      sourceMovementFingerprint: prepared.link.sourceMovementFingerprint,
      targetMovementFingerprint: prepared.link.targetMovementFingerprint,
      linkType: prepared.link.linkType,
    };
    const database = createDatabase(prepared, [existingLink]);
    database.transactionLinks.updateStatuses.mockResolvedValue(ok(1));
    mockPrepareManualLinkFromTransactions.mockReturnValue(ok(prepared));
    const handler = new ManualLinkCreateHandler(database as never, 1, 'default', { tag: 'override-store' } as never);

    const result = await handler.create({
      assetSymbol: prepared.link.assetSymbol,
      sourceSelector: prepared.sourceTransaction.txFingerprint.slice(0, 10),
      targetSelector: prepared.targetTransaction.txFingerprint.slice(0, 10),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      action: 'confirmed-existing',
      changed: true,
      existingStatusBefore: 'suggested',
      linkId: 55,
    });
    expect(database.transactionLinks.updateStatuses).toHaveBeenCalledWith(
      [55],
      'confirmed',
      'cli-user',
      expect.any(Map)
    );
    const metadataMap = database.transactionLinks.updateStatuses.mock.calls[0]?.[3] as Map<
      number,
      { linkProvenance?: string; overrideId?: string; overrideLinkType?: string }
    >;
    expect(metadataMap.get(55)).toMatchObject({
      linkProvenance: 'user',
      overrideId: 'override-1',
      overrideLinkType: 'transfer',
    });
    expect(database.transactionLinks.create).not.toHaveBeenCalled();
  });

  it('returns unchanged when the exact link is already confirmed', async () => {
    const prepared = createPreparedManualLink();
    const existingLink = {
      ...createMockLink(55, { status: 'confirmed', reviewedBy: 'reviewer' }),
      sourceTransactionId: prepared.link.sourceTransactionId,
      targetTransactionId: prepared.link.targetTransactionId,
      assetSymbol: prepared.link.assetSymbol,
      sourceAssetId: prepared.link.sourceAssetId,
      targetAssetId: prepared.link.targetAssetId,
      sourceAmount: prepared.link.sourceAmount,
      targetAmount: prepared.link.targetAmount,
      sourceMovementFingerprint: prepared.link.sourceMovementFingerprint,
      targetMovementFingerprint: prepared.link.targetMovementFingerprint,
      linkType: prepared.link.linkType,
    };
    const database = createDatabase(prepared, [existingLink]);
    mockPrepareManualLinkFromTransactions.mockReturnValue(ok(prepared));
    const handler = new ManualLinkCreateHandler(database as never, 1, 'default', { tag: 'override-store' } as never);

    const result = await handler.create({
      assetSymbol: prepared.link.assetSymbol,
      sourceSelector: prepared.sourceTransaction.txFingerprint.slice(0, 10),
      targetSelector: prepared.targetTransaction.txFingerprint.slice(0, 10),
      reason: 'should-not-write',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      action: 'already-confirmed',
      changed: false,
      linkId: 55,
    });
    expect(mockValidateTransferProposalConfirmability).not.toHaveBeenCalled();
    expect(mockAppendLinkOverrideEvent).not.toHaveBeenCalled();
    expect(database.transactionLinks.updateStatuses).not.toHaveBeenCalled();
    expect(database.transactionLinks.create).not.toHaveBeenCalled();
  });

  it('fails when multiple existing rows already share the same exact movement identity', async () => {
    const prepared = createPreparedManualLink();
    const firstLink = {
      ...createMockLink(55, { status: 'suggested' }),
      sourceTransactionId: prepared.link.sourceTransactionId,
      targetTransactionId: prepared.link.targetTransactionId,
      assetSymbol: prepared.link.assetSymbol,
      sourceAssetId: prepared.link.sourceAssetId,
      targetAssetId: prepared.link.targetAssetId,
      sourceAmount: prepared.link.sourceAmount,
      targetAmount: prepared.link.targetAmount,
      sourceMovementFingerprint: prepared.link.sourceMovementFingerprint,
      targetMovementFingerprint: prepared.link.targetMovementFingerprint,
      linkType: prepared.link.linkType,
    };
    const secondLink = { ...firstLink, id: 56 };
    const database = createDatabase(prepared, [firstLink, secondLink]);
    mockPrepareManualLinkFromTransactions.mockReturnValue(ok(prepared));
    const handler = new ManualLinkCreateHandler(database as never, 1, 'default', { tag: 'override-store' } as never);

    const result = await handler.create({
      assetSymbol: prepared.link.assetSymbol,
      sourceSelector: prepared.sourceTransaction.txFingerprint.slice(0, 10),
      targetSelector: prepared.targetTransaction.txFingerprint.slice(0, 10),
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected error result');
    }

    expect(result.error.message).toContain('Multiple existing links already share the same exact movement identity');
  });
});
