import { ok, type OverrideEvent } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { readTransactionNoteOverrides, replayTransactionNoteOverrides } from '../transaction-note-replay.js';

function createTransactionNoteEvent(txFingerprint: string, overrides?: Partial<OverrideEvent>): OverrideEvent {
  const action = overrides?.payload?.type === 'transaction_note_override' ? (overrides.payload.action ?? 'set') : 'set';

  return {
    id: overrides?.id ?? `note:${txFingerprint}:${action}`,
    created_at: overrides?.created_at ?? '2026-03-15T12:00:00.000Z',
    actor: overrides?.actor ?? 'user',
    source: overrides?.source ?? 'cli',
    scope: overrides?.scope ?? 'transaction-note',
    reason: overrides?.reason,
    payload:
      overrides?.payload ??
      ({
        type: 'transaction_note_override',
        action: 'set',
        tx_fingerprint: txFingerprint,
        message: 'Manual reminder',
      } satisfies OverrideEvent['payload']),
  };
}

describe('transaction note replay', () => {
  it('keeps the latest note per transaction fingerprint', () => {
    const firstFingerprint = 'a'.repeat(64);
    const secondFingerprint = 'b'.repeat(64);
    const result = replayTransactionNoteOverrides([
      createTransactionNoteEvent(firstFingerprint),
      createTransactionNoteEvent(secondFingerprint, {
        payload: {
          type: 'transaction_note_override',
          action: 'set',
          tx_fingerprint: secondFingerprint,
          message: 'Salary payment',
        },
      }),
      createTransactionNoteEvent(firstFingerprint, {
        payload: {
          type: 'transaction_note_override',
          action: 'set',
          tx_fingerprint: firstFingerprint,
          message: 'Updated reminder',
        },
      }),
    ]);

    const notesByFingerprint = assertOk(result);
    expect(notesByFingerprint.get(firstFingerprint)).toBe('Updated reminder');
    expect(notesByFingerprint.get(secondFingerprint)).toBe('Salary payment');
  });

  it('clears a previously-set note when a clear event is replayed', () => {
    const txFingerprint = 'c'.repeat(64);
    const result = replayTransactionNoteOverrides([
      createTransactionNoteEvent(txFingerprint),
      createTransactionNoteEvent(txFingerprint, {
        payload: {
          type: 'transaction_note_override',
          action: 'clear',
          tx_fingerprint: txFingerprint,
        },
      }),
    ]);

    const notesByFingerprint = assertOk(result);
    expect(notesByFingerprint.has(txFingerprint)).toBe(false);
  });

  it('fails replay when a non-transaction-note scope is provided', () => {
    const result = replayTransactionNoteOverrides([
      {
        id: 'asset:1',
        created_at: '2026-03-15T12:00:00.000Z',
        actor: 'user',
        source: 'cli',
        scope: 'asset-exclude',
        payload: {
          type: 'asset_exclude',
          asset_id: 'blockchain:ethereum:0xabc',
        },
      },
    ]);

    expect(assertErr(result).message).toContain("Only 'transaction-note' is allowed");
  });

  it('reads transaction note overrides from the store when the database exists', async () => {
    const txFingerprint = 'd'.repeat(64);
    const overrideStore = {
      exists: vi.fn().mockReturnValue(true),
      readByScopes: vi.fn().mockResolvedValue(
        ok([
          createTransactionNoteEvent(txFingerprint, {
            payload: {
              type: 'transaction_note_override',
              action: 'set',
              tx_fingerprint: txFingerprint,
              message: 'Memoized note',
            },
          }),
        ])
      ),
    };

    const result = await readTransactionNoteOverrides(overrideStore);

    const notesByFingerprint = assertOk(result);
    expect(overrideStore.readByScopes).toHaveBeenCalledWith(['transaction-note']);
    expect(notesByFingerprint.get(txFingerprint)).toBe('Memoized note');
  });

  it('returns an empty map when the override store is missing', async () => {
    const overrideStore = {
      exists: vi.fn().mockReturnValue(false),
      readByScopes: vi.fn(),
    };

    const result = await readTransactionNoteOverrides(overrideStore);

    expect(assertOk(result).size).toBe(0);
    expect(overrideStore.readByScopes).not.toHaveBeenCalled();
  });
});
