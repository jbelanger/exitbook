import type { OverrideEvent } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  readTransactionUserNoteOverrides,
  replayTransactionUserNoteOverrides,
} from '../transaction-user-note-replay.js';

function createTransactionNoteEvent(txFingerprint: string, overrides?: Partial<OverrideEvent>): OverrideEvent {
  const action =
    overrides?.payload?.type === 'transaction_user_note_override' ? (overrides.payload.action ?? 'set') : 'set';

  return {
    id: overrides?.id ?? `note:${txFingerprint}:${action}`,
    created_at: overrides?.created_at ?? '2026-03-15T12:00:00.000Z',
    profile_key: overrides?.profile_key ?? 'default',
    actor: overrides?.actor ?? 'user',
    source: overrides?.source ?? 'cli',
    scope: overrides?.scope ?? 'transaction-user-note',
    reason: overrides?.reason,
    payload:
      overrides?.payload ??
      ({
        type: 'transaction_user_note_override',
        action: 'set',
        tx_fingerprint: txFingerprint,
        message: 'Manual reminder',
      } satisfies OverrideEvent['payload']),
  };
}

describe('transaction user note replay', () => {
  it('keeps the latest note per transaction fingerprint', () => {
    const firstFingerprint = 'a'.repeat(64);
    const secondFingerprint = 'b'.repeat(64);
    const result = replayTransactionUserNoteOverrides([
      createTransactionNoteEvent(firstFingerprint),
      createTransactionNoteEvent(secondFingerprint, {
        payload: {
          type: 'transaction_user_note_override',
          action: 'set',
          tx_fingerprint: secondFingerprint,
          message: 'Salary payment',
        },
      }),
      createTransactionNoteEvent(firstFingerprint, {
        payload: {
          type: 'transaction_user_note_override',
          action: 'set',
          tx_fingerprint: firstFingerprint,
          message: 'Updated reminder',
        },
      }),
    ]);

    const userNoteByFingerprint = assertOk(result);
    expect(userNoteByFingerprint.get(firstFingerprint)).toEqual({
      message: 'Updated reminder',
      createdAt: '2026-03-15T12:00:00.000Z',
      author: 'user',
    });
    expect(userNoteByFingerprint.get(secondFingerprint)).toEqual({
      message: 'Salary payment',
      createdAt: '2026-03-15T12:00:00.000Z',
      author: 'user',
    });
  });

  it('clears a previously-set note when a clear event is replayed', () => {
    const txFingerprint = 'c'.repeat(64);
    const result = replayTransactionUserNoteOverrides([
      createTransactionNoteEvent(txFingerprint),
      createTransactionNoteEvent(txFingerprint, {
        payload: {
          type: 'transaction_user_note_override',
          action: 'clear',
          tx_fingerprint: txFingerprint,
        },
      }),
    ]);

    const userNoteByFingerprint = assertOk(result);
    expect(userNoteByFingerprint.has(txFingerprint)).toBe(false);
  });

  it('fails replay when a non-transaction-user-note scope is provided', () => {
    const result = replayTransactionUserNoteOverrides([
      {
        id: 'asset:1',
        created_at: '2026-03-15T12:00:00.000Z',
        profile_key: 'default',
        actor: 'user',
        source: 'cli',
        scope: 'asset-exclude',
        payload: {
          type: 'asset_exclude',
          asset_id: 'blockchain:ethereum:0xabc',
        },
      },
    ]);

    expect(assertErr(result).message).toContain("Only 'transaction-user-note' is allowed");
  });

  it('reads transaction user note overrides from the store when the database exists', async () => {
    const txFingerprint = 'd'.repeat(64);
    const overrideStore = {
      exists: vi.fn().mockReturnValue(true),
      readByScopes: vi.fn().mockResolvedValue(
        ok([
          createTransactionNoteEvent(txFingerprint, {
            payload: {
              type: 'transaction_user_note_override',
              action: 'set',
              tx_fingerprint: txFingerprint,
              message: 'Memoized note',
            },
          }),
        ])
      ),
    };

    const result = await readTransactionUserNoteOverrides(overrideStore, 'default');

    const userNoteByFingerprint = assertOk(result);
    expect(overrideStore.readByScopes).toHaveBeenCalledWith('default', ['transaction-user-note']);
    expect(userNoteByFingerprint.get(txFingerprint)).toEqual({
      message: 'Memoized note',
      createdAt: '2026-03-15T12:00:00.000Z',
      author: 'user',
    });
  });

  it('returns an empty map when the override store is missing', async () => {
    const overrideStore = {
      exists: vi.fn().mockReturnValue(false),
      readByScopes: vi.fn(),
    };

    const result = await readTransactionUserNoteOverrides(overrideStore, 'default');

    expect(assertOk(result).size).toBe(0);
    expect(overrideStore.readByScopes).not.toHaveBeenCalled();
  });
});
