import type { OverrideEvent } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  readTransactionMovementRoleOverrides,
  replayTransactionMovementRoleOverrides,
} from '../transaction-movement-role-replay.js';

function createMovementRoleEvent(movementFingerprint: string, overrides?: Partial<OverrideEvent>): OverrideEvent {
  const action =
    overrides?.payload?.type === 'transaction_movement_role_override' ? (overrides.payload.action ?? 'set') : 'set';

  return {
    id: overrides?.id ?? `movement-role:${movementFingerprint}:${action}`,
    created_at: overrides?.created_at ?? '2026-03-15T12:00:00.000Z',
    profile_key: overrides?.profile_key ?? 'default',
    actor: overrides?.actor ?? 'user',
    source: overrides?.source ?? 'cli',
    scope: overrides?.scope ?? 'transaction-movement-role',
    reason: overrides?.reason,
    payload:
      overrides?.payload ??
      ({
        type: 'transaction_movement_role_override',
        action: 'set',
        movement_fingerprint: movementFingerprint,
        movement_role: 'staking_reward',
      } satisfies OverrideEvent['payload']),
  };
}

describe('transaction movement role replay', () => {
  it('keeps the latest movement role per movement fingerprint', () => {
    const firstFingerprint = 'movement:a'.repeat(1);
    const secondFingerprint = 'movement:b'.repeat(1);
    const result = replayTransactionMovementRoleOverrides([
      createMovementRoleEvent(firstFingerprint),
      createMovementRoleEvent(secondFingerprint, {
        payload: {
          type: 'transaction_movement_role_override',
          action: 'set',
          movement_fingerprint: secondFingerprint,
          movement_role: 'protocol_overhead',
        },
      }),
      createMovementRoleEvent(firstFingerprint, {
        payload: {
          type: 'transaction_movement_role_override',
          action: 'set',
          movement_fingerprint: firstFingerprint,
          movement_role: 'principal',
        },
      }),
    ]);

    const movementRoleByFingerprint = assertOk(result);
    expect(movementRoleByFingerprint.get(firstFingerprint)).toBe('principal');
    expect(movementRoleByFingerprint.get(secondFingerprint)).toBe('protocol_overhead');
  });

  it('clears a previously-set role when a clear event is replayed', () => {
    const movementFingerprint = 'movement:test-clear:1';
    const result = replayTransactionMovementRoleOverrides([
      createMovementRoleEvent(movementFingerprint),
      createMovementRoleEvent(movementFingerprint, {
        payload: {
          type: 'transaction_movement_role_override',
          action: 'clear',
          movement_fingerprint: movementFingerprint,
        },
      }),
    ]);

    const movementRoleByFingerprint = assertOk(result);
    expect(movementRoleByFingerprint.has(movementFingerprint)).toBe(false);
  });

  it('fails replay when a non-transaction-movement-role scope is provided', () => {
    const result = replayTransactionMovementRoleOverrides([
      {
        id: 'note:1',
        created_at: '2026-03-15T12:00:00.000Z',
        profile_key: 'default',
        actor: 'user',
        source: 'cli',
        scope: 'transaction-user-note',
        payload: {
          type: 'transaction_user_note_override',
          action: 'set',
          tx_fingerprint: 'a'.repeat(64),
          message: 'Manual reminder',
        },
      },
    ]);

    expect(assertErr(result).message).toContain("Only 'transaction-movement-role' is allowed");
  });

  it('reads transaction movement role overrides from the store when the database exists', async () => {
    const movementFingerprint = 'movement:read-test:1';
    const overrideStore = {
      exists: vi.fn().mockReturnValue(true),
      readByScopes: vi.fn().mockResolvedValue(
        ok([
          createMovementRoleEvent(movementFingerprint, {
            payload: {
              type: 'transaction_movement_role_override',
              action: 'set',
              movement_fingerprint: movementFingerprint,
              movement_role: 'refund_rebate',
            },
          }),
        ])
      ),
    };

    const result = await readTransactionMovementRoleOverrides(overrideStore, 'default');

    const movementRoleByFingerprint = assertOk(result);
    expect(overrideStore.readByScopes).toHaveBeenCalledWith('default', ['transaction-movement-role']);
    expect(movementRoleByFingerprint.get(movementFingerprint)).toBe('refund_rebate');
  });

  it('returns an empty map when the override store is missing', async () => {
    const overrideStore = {
      exists: vi.fn().mockReturnValue(false),
      readByScopes: vi.fn(),
    };

    const result = await readTransactionMovementRoleOverrides(overrideStore, 'default');

    expect(assertOk(result).size).toBe(0);
    expect(overrideStore.readByScopes).not.toHaveBeenCalled();
  });
});
