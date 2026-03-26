import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataSession } from '../../data-session.js';
import type { KyselyDB } from '../../database.js';
import { buildProcessingPorts } from '../../ingestion/processing-ports.js';
import {
  seedAccount,
  seedImportSession,
  seedTxFingerprint,
  seedProfile,
} from '../../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../../utils/test-utils.js';

describe('buildProcessingPorts', () => {
  let db: KyselyDB;
  let ctx: DataSession;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataSession(db);
    await seedProfile(db);
    await seedAccount(db, 1, 'exchange-api', 'kraken');
    await seedImportSession(db, 1, 1);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('exposes transaction note materialization through processing ports', async () => {
    await db
      .insertInto('transactions')
      .values({
        id: 1,
        account_id: 1,
        platform_key: 'kraken',
        source_type: 'exchange',
        tx_fingerprint: seedTxFingerprint('kraken', 1, 'tx-1'),
        transaction_status: 'success',
        transaction_datetime: '2025-01-01T00:00:00.000Z',
        is_spam: false,
        excluded_from_accounting: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    const txFingerprint = seedTxFingerprint('kraken', 1, 'tx-1');

    const overrideStore = {
      exists: vi.fn().mockReturnValue(true),
      readByScopes: vi.fn().mockResolvedValue(
        ok([
          {
            id: 'override-1',
            created_at: '2026-03-15T12:00:00.000Z',
            actor: 'user',
            source: 'cli',
            scope: 'transaction-note',
            payload: {
              type: 'transaction_note_override',
              action: 'set',
              tx_fingerprint: txFingerprint,
              message: 'Remember this withdrawal',
            },
          },
        ])
      ),
    };

    const ports = buildProcessingPorts(ctx, {
      rebuildAssetReviewProjection: vi.fn().mockResolvedValue(ok(undefined)),
      overrideStore,
    });

    const updatedCount = assertOk(await ports.transactionNotes.materializeStoredNotes({ transactionIds: [1] }));
    expect(updatedCount).toBe(1);

    const row = await db
      .selectFrom('transactions')
      .select(['notes_json'])
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    expect(JSON.parse((row.notes_json as string | null) ?? '[]')).toEqual([
      {
        type: 'user_note',
        message: 'Remember this withdrawal',
        metadata: {
          actor: 'user',
          source: 'override-store',
        },
      },
    ]);
  });
});
