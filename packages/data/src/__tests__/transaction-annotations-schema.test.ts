/* eslint-disable unicorn/no-null -- raw SQLite insert tests use explicit nulls for nullable columns */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../database.js';
import { seedAccount, seedProfile, seedTxFingerprint } from '../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../utils/test-utils.js';

describe('transaction_annotations schema', () => {
  let db: KyselyDB;

  beforeEach(async () => {
    db = await createTestDatabase();
    await seedProfile(db);
    await seedAccount(db, 1, 'exchange-api', 'kraken');
    await db
      .insertInto('transactions')
      .values({
        id: 1,
        account_id: 1,
        platform_key: 'kraken',
        platform_kind: 'exchange',
        tx_fingerprint: seedTxFingerprint('kraken', 1, 'tx-annotation-1'),
        transaction_status: 'success',
        transaction_datetime: '2025-01-01T00:00:00.000Z',
        excluded_from_accounting: false,
        created_at: new Date().toISOString(),
        updated_at: null,
      })
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('rejects empty derived_from_tx_ids_json', async () => {
    const txFingerprint = seedTxFingerprint('kraken', 1, 'tx-annotation-1');

    await expect(
      db
        .insertInto('transaction_annotations')
        .values({
          annotation_fingerprint: 'annotation:test-empty',
          account_id: 1,
          transaction_id: 1,
          tx_fingerprint: txFingerprint,
          target_scope: 'transaction',
          movement_fingerprint: null,
          kind: 'bridge_participant',
          tier: 'asserted',
          role: 'source',
          protocol_ref_id: 'wormhole',
          protocol_ref_version: null,
          group_key: null,
          detector_id: 'bridge.detector',
          derived_from_tx_ids_json: '[]',
          provenance_inputs_json: '["processor"]',
          metadata_json: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        })
        .execute()
    ).rejects.toThrow();
  });

  it('rejects non-integer derived_from_tx_ids_json items', async () => {
    const txFingerprint = seedTxFingerprint('kraken', 1, 'tx-annotation-1');

    await expect(
      db
        .insertInto('transaction_annotations')
        .values({
          annotation_fingerprint: 'annotation:test-non-integer',
          account_id: 1,
          transaction_id: 1,
          tx_fingerprint: txFingerprint,
          target_scope: 'transaction',
          movement_fingerprint: null,
          kind: 'bridge_participant',
          tier: 'asserted',
          role: 'source',
          protocol_ref_id: 'wormhole',
          protocol_ref_version: null,
          group_key: null,
          detector_id: 'bridge.detector',
          derived_from_tx_ids_json: '[1,"two"]',
          provenance_inputs_json: '["processor"]',
          metadata_json: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        })
        .execute()
    ).rejects.toThrow();
  });

  it('accepts non-empty derived_from_tx_ids_json', async () => {
    const txFingerprint = seedTxFingerprint('kraken', 1, 'tx-annotation-1');

    await db
      .insertInto('transaction_annotations')
      .values({
        annotation_fingerprint: 'annotation:test-valid',
        account_id: 1,
        transaction_id: 1,
        tx_fingerprint: txFingerprint,
        target_scope: 'transaction',
        movement_fingerprint: null,
        kind: 'bridge_participant',
        tier: 'asserted',
        role: 'source',
        protocol_ref_id: 'wormhole',
        protocol_ref_version: null,
        group_key: null,
        detector_id: 'bridge.detector',
        derived_from_tx_ids_json: '[1]',
        provenance_inputs_json: '["processor"]',
        metadata_json: null,
        created_at: new Date().toISOString(),
        updated_at: null,
      })
      .execute();

    const row = await db
      .selectFrom('transaction_annotations')
      .select(['annotation_fingerprint', 'derived_from_tx_ids_json'])
      .where('annotation_fingerprint', '=', 'annotation:test-valid')
      .executeTakeFirstOrThrow();

    expect(row).toEqual({
      annotation_fingerprint: 'annotation:test-valid',
      derived_from_tx_ids_json: '[1]',
    });
  });
});
