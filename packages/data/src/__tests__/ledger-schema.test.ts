/* eslint-disable unicorn/no-null -- raw SQLite insert tests use explicit nulls for nullable columns */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../database.js';
import { seedAccount, seedProfile } from '../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../utils/test-utils.js';

describe('ledger schema draft', () => {
  let db: KyselyDB;

  beforeEach(async () => {
    db = await createTestDatabase();
    await seedProfile(db);
    await seedAccount(db, 1, 'blockchain', 'cardano');
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('persists the draft ledger table chain', async () => {
    await db
      .insertInto('raw_transactions')
      .values({
        id: 1,
        account_id: 1,
        provider_name: 'cardano-provider',
        event_id: 'raw:1',
        blockchain_transaction_hash: 'txhash-1',
        timestamp: 1713830400000,
        source_address: 'addr_test1source',
        transaction_type_hint: 'transfer',
        provider_data: '{}',
        normalized_data: '{}',
        processing_status: 'pending',
        processed_at: null,
        created_at: '2026-04-23T00:00:00.000Z',
      })
      .execute();

    await db
      .insertInto('source_activities')
      .values({
        id: 1,
        account_id: 1,
        platform_key: 'cardano',
        platform_kind: 'blockchain',
        source_activity_fingerprint: 'source_activity:v1:1',
        activity_status: 'success',
        activity_datetime: '2026-04-23T00:00:00.000Z',
        activity_timestamp_ms: 1713830400000,
        from_address: 'addr_test1source',
        to_address: 'addr_test1target',
        blockchain_name: 'cardano',
        blockchain_block_height: 123,
        blockchain_transaction_hash: 'txhash-1',
        blockchain_is_confirmed: true,
        created_at: '2026-04-23T00:00:00.000Z',
        updated_at: null,
      })
      .execute();

    await db
      .insertInto('raw_transaction_source_activity_assignments')
      .values({
        source_activity_id: 1,
        raw_transaction_id: 1,
      })
      .execute();

    await db
      .insertInto('accounting_journals')
      .values([
        {
          id: 1,
          source_activity_id: 1,
          journal_fingerprint: 'ledger_journal:v1:source',
          journal_stable_key: 'journal:source',
          journal_kind: 'transfer',
          created_at: '2026-04-23T00:00:00.000Z',
          updated_at: null,
        },
        {
          id: 2,
          source_activity_id: 1,
          journal_fingerprint: 'ledger_journal:v1:target',
          journal_stable_key: 'journal:target',
          journal_kind: 'internal_transfer',
          created_at: '2026-04-23T00:00:00.000Z',
          updated_at: null,
        },
      ])
      .execute();

    await db
      .insertInto('accounting_postings')
      .values([
        {
          id: 1,
          journal_id: 1,
          posting_fingerprint: 'ledger_posting:v1:source',
          posting_stable_key: 'posting:source',
          asset_id: 'blockchain:cardano:native',
          asset_symbol: 'ADA',
          quantity: '-10',
          posting_role: 'principal',
          settlement: null,
          price_amount: null,
          price_currency: null,
          price_source: null,
          price_fetched_at: null,
          price_granularity: null,
          fx_rate_to_usd: null,
          fx_source: null,
          fx_timestamp: null,
          created_at: '2026-04-23T00:00:00.000Z',
          updated_at: null,
        },
        {
          id: 2,
          journal_id: 2,
          posting_fingerprint: 'ledger_posting:v1:target',
          posting_stable_key: 'posting:target',
          asset_id: 'blockchain:cardano:native',
          asset_symbol: 'ADA',
          quantity: '10',
          posting_role: 'principal',
          settlement: null,
          price_amount: null,
          price_currency: null,
          price_source: null,
          price_fetched_at: null,
          price_granularity: null,
          fx_rate_to_usd: null,
          fx_source: null,
          fx_timestamp: null,
          created_at: '2026-04-23T00:00:00.000Z',
          updated_at: null,
        },
      ])
      .execute();

    await db
      .insertInto('accounting_posting_source_components')
      .values([
        {
          posting_id: 1,
          source_component_fingerprint: 'ledger_source_component:v1:source',
          source_activity_fingerprint: 'source_activity:v1:1',
          component_kind: 'utxo_input',
          component_id: 'component:source',
          occurrence: 1,
          asset_id: 'blockchain:cardano:native',
          quantity: '10',
        },
        {
          posting_id: 2,
          source_component_fingerprint: 'ledger_source_component:v1:target',
          source_activity_fingerprint: 'source_activity:v1:1',
          component_kind: 'utxo_output',
          component_id: 'component:target',
          occurrence: 1,
          asset_id: 'blockchain:cardano:native',
          quantity: '10',
        },
      ])
      .execute();

    await db
      .insertInto('accounting_journal_relationships')
      .values({
        source_journal_id: 1,
        target_journal_id: 2,
        source_posting_id: 1,
        target_posting_id: 2,
        relationship_stable_key: 'relationship:1',
        relationship_kind: 'internal_transfer',
        created_at: '2026-04-23T00:00:00.000Z',
        updated_at: null,
      })
      .execute();

    await db
      .insertInto('accounting_overrides')
      .values({
        profile_id: 1,
        target_scope: 'posting',
        target_journal_fingerprint: null,
        target_posting_fingerprint: 'ledger_posting:v1:source',
        override_kind: 'posting_role',
        journal_kind: null,
        posting_role: 'protocol_overhead',
        settlement: null,
        stale_reason: null,
        created_at: '2026-04-23T00:00:00.000Z',
        updated_at: null,
      })
      .execute();

    const counts = await Promise.all([
      db
        .selectFrom('source_activities')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('accounting_journals')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('accounting_postings')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('accounting_posting_source_components')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('accounting_journal_relationships')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('accounting_overrides')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
    ]);

    expect(counts.map((row) => row.count)).toEqual([1, 2, 2, 2, 1, 1]);
  });

  it('rejects fee postings without settlement', async () => {
    await db
      .insertInto('source_activities')
      .values({
        id: 1,
        account_id: 1,
        platform_key: 'cardano',
        platform_kind: 'blockchain',
        source_activity_fingerprint: 'source_activity:v1:fee-test',
        activity_status: 'success',
        activity_datetime: '2026-04-23T00:00:00.000Z',
        activity_timestamp_ms: 1713830400000,
        from_address: null,
        to_address: null,
        blockchain_name: 'cardano',
        blockchain_block_height: 123,
        blockchain_transaction_hash: 'txhash-fee',
        blockchain_is_confirmed: true,
        created_at: '2026-04-23T00:00:00.000Z',
        updated_at: null,
      })
      .execute();

    await db
      .insertInto('accounting_journals')
      .values({
        id: 1,
        source_activity_id: 1,
        journal_fingerprint: 'ledger_journal:v1:fee-test',
        journal_stable_key: 'journal:fee-test',
        journal_kind: 'expense_only',
        created_at: '2026-04-23T00:00:00.000Z',
        updated_at: null,
      })
      .execute();

    await expect(
      db
        .insertInto('accounting_postings')
        .values({
          journal_id: 1,
          posting_fingerprint: 'ledger_posting:v1:fee-test',
          posting_stable_key: 'posting:fee-test',
          asset_id: 'blockchain:cardano:native',
          asset_symbol: 'ADA',
          quantity: '-1',
          posting_role: 'fee',
          settlement: null,
          price_amount: null,
          price_currency: null,
          price_source: null,
          price_fetched_at: null,
          price_granularity: null,
          fx_rate_to_usd: null,
          fx_source: null,
          fx_timestamp: null,
          created_at: '2026-04-23T00:00:00.000Z',
          updated_at: null,
        })
        .execute()
    ).rejects.toThrow();
  });
});
