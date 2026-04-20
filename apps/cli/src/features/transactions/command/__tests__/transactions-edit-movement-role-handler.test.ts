import type { CreateOverrideEventOptions, OverrideEvent, Transaction } from '@exitbook/core';
import { formatMovementFingerprintRef, formatTransactionFingerprintRef } from '@exitbook/core';
import { err, ok, parseDecimal, type Currency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';
import type { TransactionEditTarget } from '../transaction-edit-target.js';
import type { ResolvedTransactionMovementSelector } from '../transaction-movement-selector.js';
import { TransactionsEditMovementRoleHandler } from '../transactions-edit-movement-role-handler.js';
import { TRANSACTION_EDIT_REPAIR_COMMAND } from '../transactions-edit-result.js';

const {
  mockMarkDownstreamProjectionsStale,
  mockMaterializeStoredTransactionMovementRoleOverrides,
  mockFindStoredMovementRoleStateByFingerprint,
} = vi.hoisted(() => ({
  mockMarkDownstreamProjectionsStale: vi.fn(),
  mockFindStoredMovementRoleStateByFingerprint: vi.fn(),
  mockMaterializeStoredTransactionMovementRoleOverrides: vi.fn(),
}));

vi.mock('@exitbook/data/overrides', async () => {
  const actual = await vi.importActual<typeof import('@exitbook/data/overrides')>('@exitbook/data/overrides');
  return {
    ...actual,
    materializeStoredTransactionMovementRoleOverrides: mockMaterializeStoredTransactionMovementRoleOverrides,
  };
});

vi.mock('@exitbook/data/projections', () => ({
  markDownstreamProjectionsStale: mockMarkDownstreamProjectionsStale,
}));

function createTransaction(): Transaction {
  return createPersistedTransaction({
    id: 123,
    accountId: 7,
    txFingerprint: '1234567890abcdef1234567890abcdef',
    platformKey: 'cardano',
    platformKind: 'blockchain',
    datetime: '2026-04-10T12:00:00.000Z',
    timestamp: Date.parse('2026-04-10T12:00:00.000Z'),
    status: 'success',
    operation: { category: 'transfer', type: 'deposit' },
    movements: {
      inflows: [
        {
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA' as Currency,
          grossAmount: parseDecimal('10.5'),
          netAmount: parseDecimal('10.5'),
        },
      ],
      outflows: [],
    },
    fees: [],
  });
}

function toEditTarget(transaction: Transaction): TransactionEditTarget {
  return {
    accountId: transaction.accountId,
    platformKey: transaction.platformKey,
    transactionId: transaction.id,
    txFingerprint: transaction.txFingerprint,
    txRef: formatTransactionFingerprintRef(transaction.txFingerprint),
  };
}

function toMovementSelection(transaction: Transaction): ResolvedTransactionMovementSelector {
  return {
    direction: 'inflow',
    movement: transaction.movements.inflows![0]!,
    movementRef: formatMovementFingerprintRef(transaction.movements.inflows![0]!.movementFingerprint),
  };
}

function createMockOverrideStore(
  initialEvents: OverrideEvent[] = []
): Pick<import('@exitbook/data/overrides').OverrideStore, 'append' | 'exists' | 'readByScopes'> {
  const events = [...initialEvents];
  return {
    append: vi.fn().mockImplementation(async (options: CreateOverrideEventOptions) => {
      const event: OverrideEvent = {
        id: `override-event-${events.length + 1}`,
        created_at: '2026-04-15T12:05:00.000Z',
        profile_key: options.profileKey,
        actor: 'user',
        source: 'cli',
        scope: options.scope,
        reason: options.reason,
        payload: options.payload,
      };
      events.push(event);
      return ok(event);
    }),
    exists: vi.fn().mockReturnValue(events.length > 0),
    readByScopes: vi.fn().mockResolvedValue(ok(events)),
  };
}

describe('TransactionsEditMovementRoleHandler', () => {
  const transaction = createTransaction();
  const target = toEditTarget(transaction);
  const movement = toMovementSelection(transaction);

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindStoredMovementRoleStateByFingerprint.mockResolvedValue(
      ok({
        baseRole: 'principal',
        overrideRole: undefined,
      })
    );
    mockMaterializeStoredTransactionMovementRoleOverrides.mockResolvedValue(ok(1));
    mockMarkDownstreamProjectionsStale.mockResolvedValue(ok(undefined));
  });

  it('saves a movement role override and invalidates downstream projections', async () => {
    const overrideStore = createMockOverrideStore();
    const handler = new TransactionsEditMovementRoleHandler(
      {
        transactions: {
          findStoredMovementRoleStateByFingerprint: mockFindStoredMovementRoleStateByFingerprint,
          tag: 'repo',
        },
      } as never,
      overrideStore
    );

    const result = await handler.setRole({
      movement,
      profileKey: 'default',
      reason: 'Reward leg should not transfer-link',
      role: 'staking_reward',
      target,
    });

    expect(assertOk(result)).toMatchObject({
      action: 'set',
      changed: true,
      movement: {
        assetSymbol: 'ADA',
        direction: 'inflow',
        movementFingerprint: movement.movement.movementFingerprint,
        movementRef: movement.movementRef,
      },
      nextEffectiveRole: 'staking_reward',
      previousEffectiveRole: 'principal',
      projectionSyncStatus: 'synchronized',
      transaction: {
        txRef: formatTransactionFingerprintRef(transaction.txFingerprint),
      },
      warnings: [],
    });
    expect(overrideStore.append).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'transaction-movement-role',
      payload: {
        type: 'transaction_movement_role_override',
        action: 'set',
        movement_fingerprint: movement.movement.movementFingerprint,
        movement_role: 'staking_reward',
      },
      reason: 'Reward leg should not transfer-link',
    });
    expect(mockMaterializeStoredTransactionMovementRoleOverrides).toHaveBeenCalledWith(
      { findStoredMovementRoleStateByFingerprint: mockFindStoredMovementRoleStateByFingerprint, tag: 'repo' },
      overrideStore,
      'default',
      { transactionIds: [123] }
    );
    expect(mockMarkDownstreamProjectionsStale).toHaveBeenCalledWith({
      accountIds: [7],
      db: {
        transactions: {
          findStoredMovementRoleStateByFingerprint: mockFindStoredMovementRoleStateByFingerprint,
          tag: 'repo',
        },
      },
      from: 'processed-transactions',
      reason: 'override:transaction-movement-role',
    });
  });

  it('returns unchanged when the effective role already matches the requested role', async () => {
    const overrideStore = createMockOverrideStore();
    mockFindStoredMovementRoleStateByFingerprint.mockResolvedValue(
      ok({
        baseRole: 'principal',
        overrideRole: 'staking_reward',
      })
    );
    const handler = new TransactionsEditMovementRoleHandler(
      {
        transactions: {
          findStoredMovementRoleStateByFingerprint: mockFindStoredMovementRoleStateByFingerprint,
          tag: 'repo',
        },
      } as never,
      overrideStore
    );

    const result = await handler.setRole({
      movement,
      profileKey: 'default',
      role: 'staking_reward',
      target,
    });

    expect(assertOk(result)).toMatchObject({
      action: 'set',
      changed: false,
      previousEffectiveRole: 'staking_reward',
      nextEffectiveRole: 'staking_reward',
      projectionSyncStatus: 'synchronized',
      movement: {
        movementRef: movement.movementRef,
      },
      warnings: [],
    });
    expect(overrideStore.append).not.toHaveBeenCalled();
    expect(mockMaterializeStoredTransactionMovementRoleOverrides).not.toHaveBeenCalled();
    expect(mockMarkDownstreamProjectionsStale).not.toHaveBeenCalled();
  });

  it('clears an existing movement role override back to the base role', async () => {
    const overrideStore = createMockOverrideStore();
    mockFindStoredMovementRoleStateByFingerprint.mockResolvedValue(
      ok({
        baseRole: 'principal',
        overrideRole: 'staking_reward',
      })
    );
    const handler = new TransactionsEditMovementRoleHandler(
      {
        transactions: {
          findStoredMovementRoleStateByFingerprint: mockFindStoredMovementRoleStateByFingerprint,
          tag: 'repo',
        },
      } as never,
      overrideStore
    );

    const result = await handler.clearRole({
      movement,
      profileKey: 'default',
      reason: 'Cleanup',
      target,
    });

    expect(assertOk(result)).toMatchObject({
      action: 'clear',
      changed: true,
      previousEffectiveRole: 'staking_reward',
      nextEffectiveRole: 'principal',
      projectionSyncStatus: 'synchronized',
      movement: {
        movementRef: movement.movementRef,
      },
      warnings: [],
    });
    expect(overrideStore.append).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'transaction-movement-role',
      payload: {
        type: 'transaction_movement_role_override',
        action: 'clear',
        movement_fingerprint: movement.movement.movementFingerprint,
      },
      reason: 'Cleanup',
    });
  });

  it('rejects incompatible outflow reward roles', async () => {
    const overrideStore = createMockOverrideStore();
    const handler = new TransactionsEditMovementRoleHandler(
      {
        transactions: {
          findStoredMovementRoleStateByFingerprint: mockFindStoredMovementRoleStateByFingerprint,
          tag: 'repo',
        },
      } as never,
      overrideStore
    );

    const result = await handler.setRole({
      movement: {
        ...movement,
        direction: 'outflow',
      },
      profileKey: 'default',
      role: 'staking_reward',
      target,
    });

    expect(assertErr(result).message).toContain('staking_reward is only valid on inflow movements');
    expect(overrideStore.append).not.toHaveBeenCalled();
  });

  it('returns partial success when movement role materialization fails after append', async () => {
    const overrideStore = createMockOverrideStore();
    mockMaterializeStoredTransactionMovementRoleOverrides.mockResolvedValue(err(new Error('materialize failed')));
    const handler = new TransactionsEditMovementRoleHandler(
      {
        transactions: {
          findStoredMovementRoleStateByFingerprint: mockFindStoredMovementRoleStateByFingerprint,
          tag: 'repo',
        },
      } as never,
      overrideStore
    );

    const result = await handler.setRole({
      movement,
      profileKey: 'default',
      role: 'staking_reward',
      target,
    });

    expect(assertOk(result)).toMatchObject({
      action: 'set',
      changed: true,
      previousEffectiveRole: 'principal',
      nextEffectiveRole: 'staking_reward',
      projectionSyncStatus: 'reprocess-required',
      repairCommand: TRANSACTION_EDIT_REPAIR_COMMAND,
      warnings: [
        'Override persisted, but transaction movement role materialization failed: Failed to materialize transaction movement role override: materialize failed',
      ],
    });
    expect(mockMarkDownstreamProjectionsStale).not.toHaveBeenCalled();
  });

  it('returns partial success when downstream projections cannot be marked stale', async () => {
    const overrideStore = createMockOverrideStore();
    mockFindStoredMovementRoleStateByFingerprint.mockResolvedValue(
      ok({
        baseRole: 'principal',
        overrideRole: 'staking_reward',
      })
    );
    mockMarkDownstreamProjectionsStale.mockResolvedValue(err(new Error('stale mark failed')));
    const handler = new TransactionsEditMovementRoleHandler(
      {
        transactions: {
          findStoredMovementRoleStateByFingerprint: mockFindStoredMovementRoleStateByFingerprint,
          tag: 'repo',
        },
      } as never,
      overrideStore
    );

    const result = await handler.clearRole({
      movement,
      profileKey: 'default',
      target,
    });

    expect(assertOk(result)).toMatchObject({
      action: 'clear',
      changed: true,
      previousEffectiveRole: 'staking_reward',
      nextEffectiveRole: 'principal',
      projectionSyncStatus: 'reprocess-required',
      repairCommand: TRANSACTION_EDIT_REPAIR_COMMAND,
      warnings: ['Override persisted, but downstream projections could not be marked stale: stale mark failed'],
    });
  });
});
