import { sql } from '@exitbook/sqlite';
import type { Kysely } from '@exitbook/sqlite';

import { ensureLedgerResetPerformanceIndexes } from './ledger-reset-performance-indexes.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Create profiles table
  await db.schema
    .createTable('profiles')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('profile_key', 'text', (col) => col.notNull())
    .addColumn('display_name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_profiles_profile_key_unique
    ON profiles (profile_key)
  `.execute(db);

  // Create accounts table
  await db.schema
    .createTable('accounts')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('profile_id', 'integer', (col) => col.notNull().references('profiles.id'))
    .addColumn('name', 'text')
    .addColumn('parent_account_id', 'integer', (col) => col.references('accounts.id'))
    .addColumn('account_type', 'text', (col) => col.notNull())
    .addColumn('platform_key', 'text', (col) => col.notNull())
    .addColumn('identifier', 'text', (col) => col.notNull()) // address/xpub for blockchain, apiKey for exchange-api, CSV directory path for exchange-csv
    .addColumn('account_fingerprint', 'text', (col) => col.notNull())
    .addColumn('provider_name', 'text')
    .addColumn('credentials', 'text') // JSON: stored provider credentials for exchange accounts
    .addColumn('last_cursor', 'text')
    .addColumn('metadata', 'text') // JSON: Account metadata (e.g., xpub derivation info)
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint(
      'accounts_account_type_valid',
      sql`account_type IN ('blockchain', 'exchange-api', 'exchange-csv')`
    )
    .addCheckConstraint('accounts_account_fingerprint_not_empty', sql`trim(account_fingerprint) <> ''`)
    .addCheckConstraint('accounts_child_name_null', sql`parent_account_id IS NULL OR name IS NULL`)
    .addCheckConstraint('accounts_credentials_json_valid', sql`credentials IS NULL OR json_valid(credentials)`)
    .addCheckConstraint('accounts_last_cursor_json_valid', sql`last_cursor IS NULL OR json_valid(last_cursor)`)
    .addCheckConstraint('accounts_metadata_json_valid', sql`metadata IS NULL OR json_valid(metadata)`)
    .execute();

  // Blockchain and child-account identity stays keyed by account type + platform + identifier.
  await sql`
    CREATE UNIQUE INDEX idx_accounts_unique_non_exchange_identity
    ON accounts (account_type, platform_key, identifier, COALESCE(profile_id, 0))
    WHERE NOT (account_type IN ('exchange-api', 'exchange-csv') AND parent_account_id IS NULL)
  `.execute(db);

  // Top-level exchange identity is profile + platform. API keys and CSV paths are
  // mutable config, not canonical identity.
  await sql`
    CREATE UNIQUE INDEX idx_accounts_unique_exchange_top_level
    ON accounts (platform_key, COALESCE(profile_id, 0))
    WHERE account_type IN ('exchange-api', 'exchange-csv') AND parent_account_id IS NULL
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX idx_accounts_top_level_name_unique
    ON accounts (COALESCE(profile_id, 0), lower(name))
    WHERE name IS NOT NULL AND parent_account_id IS NULL
  `.execute(db);

  await db.schema
    .createIndex('idx_accounts_account_fingerprint_unique')
    .on('accounts')
    .column('account_fingerprint')
    .unique()
    .execute();

  // Create index on parent_account_id for efficient child account queries (xpub hierarchies)
  await db.schema.createIndex('idx_accounts_parent_account_id').on('accounts').column('parent_account_id').execute();

  await sql`
    CREATE TRIGGER trg_accounts_child_profile_match_insert
    BEFORE INSERT ON accounts
    FOR EACH ROW
    WHEN NEW.parent_account_id IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'Child account profile must match parent account profile')
      WHERE COALESCE((SELECT profile_id FROM accounts WHERE id = NEW.parent_account_id), 0) != COALESCE(NEW.profile_id, 0);
    END
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_accounts_child_profile_match_update
    BEFORE UPDATE OF parent_account_id, profile_id ON accounts
    FOR EACH ROW
    WHEN NEW.parent_account_id IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'Child account profile must match parent account profile')
      WHERE COALESCE((SELECT profile_id FROM accounts WHERE id = NEW.parent_account_id), 0) != COALESCE(NEW.profile_id, 0);
    END
  `.execute(db);

  // Create import_sessions table
  await db.schema
    .createTable('import_sessions')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('account_id', 'integer', (col) => col.references('accounts.id').notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('started'))
    .addColumn('started_at', 'text', (col) => col.notNull())
    .addColumn('completed_at', 'text')
    .addColumn('duration_ms', 'integer')
    .addColumn('transactions_imported', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('transactions_skipped', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('error_message', 'text')
    .addColumn('error_details', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint('import_sessions_status_valid', sql`status IN ('started', 'completed', 'failed', 'cancelled')`)
    .addCheckConstraint(
      'import_sessions_error_details_json_valid',
      sql`error_details IS NULL OR json_valid(error_details)`
    )
    .execute();

  // Create index on account_id for fast lookup
  await db.schema.createIndex('idx_import_sessions_account_id').on('import_sessions').column('account_id').execute();

  // Create raw_transactions table
  await db.schema
    .createTable('raw_transactions')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('account_id', 'integer', (col) => col.notNull().references('accounts.id'))
    .addColumn('provider_name', 'text', (col) => col.notNull())
    .addColumn('event_id', 'text', (col) => col.notNull())
    .addColumn('source_address', 'text')
    .addColumn('blockchain_transaction_hash', 'text')
    .addColumn('timestamp', 'integer', (col) => col.notNull()) // Event timestamp in Unix milliseconds
    .addColumn('transaction_type_hint', 'text')
    .addColumn('provider_data', 'text', (col) => col.notNull())
    .addColumn('normalized_data', 'text', (col) => col.notNull())
    .addColumn('processing_status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('processed_at', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addCheckConstraint('raw_transactions_processing_status_valid', sql`processing_status IN ('pending', 'processed')`)
    .addCheckConstraint('raw_transactions_provider_data_json_valid', sql`json_valid(provider_data)`)
    .addCheckConstraint('raw_transactions_normalized_data_json_valid', sql`json_valid(normalized_data)`)
    .execute();

  // Create index on account_id for fast account-scoped queries
  await db.schema.createIndex('idx_raw_tx_account_id').on('raw_transactions').column('account_id').execute();

  // Create composite index on (account_id, processing_status, timestamp) for fast pending record queries ordered by time
  await db.schema
    .createIndex('idx_raw_tx_account_status_timestamp')
    .on('raw_transactions')
    .columns(['account_id', 'processing_status', 'timestamp'])
    .execute();

  // Create composite index for hash-grouped blockchain reprocessing.
  // The processing loop repeatedly asks for the next pending distinct hashes, so processing_status
  // must be part of the hash-ordered index to avoid scanning already-processed rows in large accounts.
  await sql`
    CREATE INDEX idx_raw_tx_account_status_hash
    ON raw_transactions(account_id, processing_status, blockchain_transaction_hash)
    WHERE blockchain_transaction_hash IS NOT NULL
  `.execute(db);

  // Create index on (account_id, blockchain_transaction_hash) for performance only, no deduplication
  // Only applies when blockchain_transaction_hash is not null (blockchain imports, not exchange imports)
  await sql`
    CREATE INDEX idx_raw_tx_account_blockchain_hash
    ON raw_transactions(account_id, blockchain_transaction_hash)
    WHERE blockchain_transaction_hash IS NOT NULL
  `.execute(db);

  // Create unique index on (account_id, event_id) to prevent duplicate exchange transactions per account
  await sql`
    CREATE UNIQUE INDEX idx_raw_tx_account_event_id
    ON raw_transactions(account_id, event_id)
  `.execute(db);

  // Ledger rewrite draft tables.
  // These coexist with legacy processed transaction tables until repositories and processors move.

  await db.schema
    .createTable('source_activities')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('owner_account_id', 'integer', (col) => col.notNull().references('accounts.id'))
    .addColumn('source_activity_origin', 'text', (col) => col.notNull())
    .addColumn('source_activity_stable_key', 'text', (col) => col.notNull())
    .addColumn('platform_key', 'text', (col) => col.notNull())
    .addColumn('platform_kind', 'text', (col) => col.notNull())
    .addColumn('source_activity_fingerprint', 'text', (col) => col.notNull())
    .addColumn('activity_status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('activity_datetime', 'text', (col) => col.notNull())
    .addColumn('activity_timestamp_ms', 'integer')
    .addColumn('from_address', 'text')
    .addColumn('to_address', 'text')
    .addColumn('blockchain_name', 'text')
    .addColumn('blockchain_block_height', 'integer')
    .addColumn('blockchain_transaction_hash', 'text')
    .addColumn('blockchain_is_confirmed', 'boolean')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint(
      'source_activities_origin_valid',
      sql`source_activity_origin IN ('provider_event', 'balance_snapshot', 'manual_accounting_entry')`
    )
    .addCheckConstraint('source_activities_stable_key_not_empty', sql`trim(source_activity_stable_key) <> ''`)
    .addCheckConstraint('source_activities_platform_kind_valid', sql`platform_kind IN ('blockchain', 'exchange')`)
    .addCheckConstraint(
      'source_activities_status_valid',
      sql`activity_status IN ('pending', 'success', 'failed', 'open', 'closed', 'canceled')`
    )
    .addCheckConstraint('source_activities_fingerprint_not_empty', sql`trim(source_activity_fingerprint) <> ''`)
    .addCheckConstraint('source_activities_platform_key_not_empty', sql`trim(platform_key) <> ''`)
    .addCheckConstraint('source_activities_datetime_not_empty', sql`trim(activity_datetime) <> ''`)
    .addCheckConstraint(
      'source_activities_blockchain_hash_not_empty',
      sql`blockchain_transaction_hash IS NULL OR trim(blockchain_transaction_hash) <> ''`
    )
    .execute();

  await db.schema
    .createIndex('idx_source_activities_owner_account_id')
    .on('source_activities')
    .column('owner_account_id')
    .execute();

  await db.schema
    .createIndex('idx_source_activities_fingerprint')
    .on('source_activities')
    .column('source_activity_fingerprint')
    .unique()
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_source_activities_owner_platform_origin_stable_key
    ON source_activities(owner_account_id, platform_kind, platform_key, source_activity_origin, source_activity_stable_key)
  `.execute(db);

  await db.schema
    .createTable('raw_transaction_source_activity_assignments')
    .addColumn('source_activity_id', 'integer', (col) =>
      col.notNull().references('source_activities.id').onDelete('cascade')
    )
    .addColumn('raw_transaction_id', 'integer', (col) =>
      col.notNull().references('raw_transactions.id').onDelete('cascade')
    )
    .addPrimaryKeyConstraint('pk_raw_transaction_source_activity_assignments', ['raw_transaction_id'])
    .execute();

  await db.schema
    .createIndex('idx_raw_transaction_source_activity_assignments_source_activity_id')
    .on('raw_transaction_source_activity_assignments')
    .column('source_activity_id')
    .execute();

  await db.schema
    .createTable('accounting_journals')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('source_activity_id', 'integer', (col) =>
      col.notNull().references('source_activities.id').onDelete('cascade')
    )
    .addColumn('journal_fingerprint', 'text', (col) => col.notNull())
    .addColumn('journal_stable_key', 'text', (col) => col.notNull())
    .addColumn('journal_kind', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint(
      'accounting_journals_kind_valid',
      sql`journal_kind IN ('transfer', 'trade', 'staking_reward', 'protocol_event', 'refund_rebate', 'internal_transfer', 'expense_only', 'opening_balance', 'unknown')`
    )
    .addCheckConstraint('accounting_journals_fingerprint_not_empty', sql`trim(journal_fingerprint) <> ''`)
    .addCheckConstraint('accounting_journals_stable_key_not_empty', sql`trim(journal_stable_key) <> ''`)
    .execute();

  await db.schema
    .createIndex('idx_accounting_journals_source_activity_id')
    .on('accounting_journals')
    .column('source_activity_id')
    .execute();

  await db.schema
    .createIndex('idx_accounting_journals_fingerprint')
    .on('accounting_journals')
    .column('journal_fingerprint')
    .unique()
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_accounting_journals_source_activity_journal_stable_key
    ON accounting_journals(source_activity_id, journal_stable_key)
  `.execute(db);

  await db.schema
    .createTable('accounting_journal_diagnostics')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('journal_id', 'integer', (col) => col.notNull().references('accounting_journals.id').onDelete('cascade'))
    .addColumn('diagnostic_order', 'integer', (col) => col.notNull())
    .addColumn('diagnostic_code', 'text', (col) => col.notNull())
    .addColumn('diagnostic_message', 'text', (col) => col.notNull())
    .addColumn('severity', 'text')
    .addColumn('metadata_json', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addCheckConstraint('accounting_journal_diagnostics_order_valid', sql`diagnostic_order > 0`)
    .addCheckConstraint('accounting_journal_diagnostics_code_not_empty', sql`trim(diagnostic_code) <> ''`)
    .addCheckConstraint('accounting_journal_diagnostics_message_not_empty', sql`trim(diagnostic_message) <> ''`)
    .addCheckConstraint(
      'accounting_journal_diagnostics_severity_valid',
      sql`severity IS NULL OR severity IN ('info', 'warning', 'error')`
    )
    .addCheckConstraint(
      'accounting_journal_diagnostics_metadata_json_valid',
      sql`metadata_json IS NULL OR json_valid(metadata_json)`
    )
    .execute();

  await db.schema
    .createIndex('idx_accounting_journal_diagnostics_journal_id')
    .on('accounting_journal_diagnostics')
    .column('journal_id')
    .execute();

  await db.schema
    .createIndex('idx_accounting_journal_diagnostics_code')
    .on('accounting_journal_diagnostics')
    .column('diagnostic_code')
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_accounting_journal_diagnostics_journal_order
    ON accounting_journal_diagnostics(journal_id, diagnostic_order)
  `.execute(db);

  await db.schema
    .createTable('accounting_postings')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('journal_id', 'integer', (col) => col.notNull().references('accounting_journals.id').onDelete('cascade'))
    .addColumn('posting_fingerprint', 'text', (col) => col.notNull())
    .addColumn('posting_stable_key', 'text', (col) => col.notNull())
    .addColumn('asset_id', 'text', (col) => col.notNull())
    .addColumn('asset_symbol', 'text', (col) => col.notNull())
    .addColumn('quantity', 'text', (col) => col.notNull())
    .addColumn('posting_role', 'text', (col) => col.notNull())
    .addColumn('balance_category', 'text', (col) => col.notNull())
    .addColumn('settlement', 'text')
    .addColumn('price_amount', 'text')
    .addColumn('price_currency', 'text')
    .addColumn('price_source', 'text')
    .addColumn('price_fetched_at', 'text')
    .addColumn('price_granularity', 'text')
    .addColumn('fx_rate_to_usd', 'text')
    .addColumn('fx_source', 'text')
    .addColumn('fx_timestamp', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint('accounting_postings_fingerprint_not_empty', sql`trim(posting_fingerprint) <> ''`)
    .addCheckConstraint('accounting_postings_stable_key_not_empty', sql`trim(posting_stable_key) <> ''`)
    .addCheckConstraint('accounting_postings_asset_id_not_empty', sql`trim(asset_id) <> ''`)
    .addCheckConstraint('accounting_postings_asset_symbol_not_empty', sql`trim(asset_symbol) <> ''`)
    .addCheckConstraint('accounting_postings_quantity_not_empty', sql`trim(quantity) <> ''`)
    .addCheckConstraint(
      'accounting_postings_role_valid',
      sql`posting_role IN ('principal', 'fee', 'staking_reward', 'protocol_deposit', 'protocol_refund', 'protocol_overhead', 'refund_rebate', 'opening_position')`
    )
    .addCheckConstraint(
      'accounting_postings_balance_category_valid',
      sql`balance_category IN ('liquid', 'staked', 'unbonding', 'reward_receivable')`
    )
    .addCheckConstraint(
      'accounting_postings_settlement_valid',
      sql`settlement IS NULL OR settlement IN ('on-chain', 'balance', 'external')`
    )
    .addCheckConstraint(
      'accounting_postings_fee_requires_settlement',
      sql`(posting_role = 'fee' AND settlement IS NOT NULL) OR posting_role != 'fee'`
    )
    .addCheckConstraint(
      'accounting_postings_price_all_or_nothing',
      sql`(price_amount IS NULL AND price_currency IS NULL AND price_source IS NULL AND price_fetched_at IS NULL AND price_granularity IS NULL) OR (price_amount IS NOT NULL AND price_currency IS NOT NULL AND price_source IS NOT NULL AND price_fetched_at IS NOT NULL)`
    )
    .addCheckConstraint(
      'accounting_postings_price_granularity_valid',
      sql`price_granularity IS NULL OR price_granularity IN ('exact', 'minute', 'hour', 'day')`
    )
    .execute();

  await db.schema
    .createIndex('idx_accounting_postings_journal_id')
    .on('accounting_postings')
    .column('journal_id')
    .execute();
  await db.schema
    .createIndex('idx_accounting_postings_asset_id')
    .on('accounting_postings')
    .column('asset_id')
    .execute();
  await db.schema
    .createIndex('idx_accounting_postings_fingerprint')
    .on('accounting_postings')
    .column('posting_fingerprint')
    .unique()
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_accounting_postings_journal_stable_key
    ON accounting_postings(journal_id, posting_stable_key)
  `.execute(db);

  await db.schema
    .createTable('accounting_posting_source_components')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('posting_id', 'integer', (col) => col.notNull().references('accounting_postings.id').onDelete('cascade'))
    .addColumn('source_component_fingerprint', 'text', (col) => col.notNull())
    .addColumn('source_activity_fingerprint', 'text', (col) =>
      col.notNull().references('source_activities.source_activity_fingerprint').onDelete('cascade')
    )
    .addColumn('component_kind', 'text', (col) => col.notNull())
    .addColumn('component_id', 'text', (col) => col.notNull())
    .addColumn('occurrence', 'integer')
    .addColumn('asset_id', 'text')
    .addColumn('quantity', 'text', (col) => col.notNull())
    .addCheckConstraint(
      'accounting_posting_source_components_fingerprint_not_empty',
      sql`trim(source_component_fingerprint) <> ''`
    )
    .addCheckConstraint(
      'accounting_posting_source_components_source_activity_not_empty',
      sql`trim(source_activity_fingerprint) <> ''`
    )
    .addCheckConstraint(
      'accounting_posting_source_components_component_kind_valid',
      sql`component_kind IN ('raw_event', 'exchange_fill', 'exchange_fee', 'utxo_input', 'utxo_output', 'cardano_collateral_input', 'cardano_collateral_return', 'cardano_stake_certificate', 'cardano_delegation_certificate', 'cardano_mir_certificate', 'account_delta', 'staking_reward', 'message', 'network_fee', 'balance_snapshot')`
    )
    .addCheckConstraint('accounting_posting_source_components_component_id_not_empty', sql`trim(component_id) <> ''`)
    .addCheckConstraint(
      'accounting_posting_source_components_occurrence_valid',
      sql`occurrence IS NULL OR occurrence > 0`
    )
    .addCheckConstraint('accounting_posting_source_components_quantity_not_empty', sql`trim(quantity) <> ''`)
    .addCheckConstraint(
      'accounting_posting_source_components_asset_id_not_empty',
      sql`asset_id IS NULL OR trim(asset_id) <> ''`
    )
    .execute();

  await db.schema
    .createIndex('idx_accounting_posting_source_components_posting_id')
    .on('accounting_posting_source_components')
    .column('posting_id')
    .execute();

  await db.schema
    .createIndex('idx_accounting_posting_source_components_component_fingerprint')
    .on('accounting_posting_source_components')
    .column('source_component_fingerprint')
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_accounting_posting_source_components_posting_component
    ON accounting_posting_source_components(posting_id, source_component_fingerprint)
  `.execute(db);

  await db.schema
    .createTable('accounting_journal_relationships')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('profile_id', 'integer', (col) => col.notNull().references('profiles.id'))
    .addColumn('relationship_origin', 'text', (col) => col.notNull())
    .addColumn('relationship_stable_key', 'text', (col) => col.notNull())
    .addColumn('relationship_kind', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint(
      'accounting_journal_relationships_origin_valid',
      sql`relationship_origin IN ('processor', 'ledger_linking')`
    )
    .addCheckConstraint(
      'accounting_journal_relationships_stable_key_not_empty',
      sql`trim(relationship_stable_key) <> ''`
    )
    .addCheckConstraint(
      'accounting_journal_relationships_kind_valid',
      sql`relationship_kind IN ('internal_transfer', 'external_transfer', 'same_hash_carryover', 'bridge', 'asset_migration')`
    )
    .execute();

  await db.schema
    .createIndex('idx_accounting_journal_relationships_profile_origin')
    .on('accounting_journal_relationships')
    .columns(['profile_id', 'relationship_origin'])
    .execute();

  await db.schema
    .createIndex('idx_accounting_journal_relationships_profile_stable_key')
    .on('accounting_journal_relationships')
    .columns(['profile_id', 'relationship_origin', 'relationship_stable_key'])
    .unique()
    .execute();

  await db.schema
    .createTable('accounting_journal_relationship_allocations')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('relationship_id', 'integer', (col) =>
      col.notNull().references('accounting_journal_relationships.id').onDelete('cascade')
    )
    .addColumn('allocation_side', 'text', (col) => col.notNull())
    .addColumn('allocation_quantity', 'text', (col) => col.notNull())
    .addColumn('source_activity_fingerprint', 'text', (col) => col.notNull())
    .addColumn('journal_id', 'integer', (col) => col.references('accounting_journals.id').onDelete('set null'))
    .addColumn('posting_id', 'integer', (col) => col.references('accounting_postings.id').onDelete('set null'))
    .addColumn('journal_fingerprint', 'text', (col) => col.notNull())
    .addColumn('posting_fingerprint', 'text', (col) => col.notNull())
    .addColumn('asset_id', 'text', (col) => col.notNull())
    .addColumn('asset_symbol', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint(
      'accounting_journal_relationship_allocations_side_valid',
      sql`allocation_side IN ('source', 'target')`
    )
    .addCheckConstraint(
      'accounting_journal_relationship_allocations_quantity_not_empty',
      sql`trim(allocation_quantity) <> ''`
    )
    .addCheckConstraint(
      'accounting_journal_relationship_allocations_source_activity_fingerprint_not_empty',
      sql`trim(source_activity_fingerprint) <> ''`
    )
    .addCheckConstraint(
      'accounting_journal_relationship_allocations_journal_fingerprint_not_empty',
      sql`trim(journal_fingerprint) <> ''`
    )
    .addCheckConstraint(
      'accounting_journal_relationship_allocations_posting_fingerprint_not_empty',
      sql`trim(posting_fingerprint) <> ''`
    )
    .addCheckConstraint('accounting_journal_relationship_allocations_asset_id_not_empty', sql`trim(asset_id) <> ''`)
    .addCheckConstraint(
      'accounting_journal_relationship_allocations_asset_symbol_not_empty',
      sql`trim(asset_symbol) <> ''`
    )
    .execute();

  await db.schema
    .createIndex('idx_accounting_journal_relationship_allocations_relationship_id')
    .on('accounting_journal_relationship_allocations')
    .column('relationship_id')
    .execute();

  await db.schema
    .createIndex('idx_accounting_journal_relationship_allocations_journal_id')
    .on('accounting_journal_relationship_allocations')
    .column('journal_id')
    .execute();

  await db.schema
    .createIndex('idx_accounting_journal_relationship_allocations_posting_id')
    .on('accounting_journal_relationship_allocations')
    .column('posting_id')
    .execute();

  await db.schema
    .createIndex('idx_accounting_journal_relationship_allocations_activity')
    .on('accounting_journal_relationship_allocations')
    .column('source_activity_fingerprint')
    .execute();

  await db.schema
    .createIndex('idx_accounting_journal_relationship_allocations_journal_fingerprint')
    .on('accounting_journal_relationship_allocations')
    .column('journal_fingerprint')
    .execute();

  await db.schema
    .createIndex('idx_accounting_journal_relationship_allocations_posting_fingerprint')
    .on('accounting_journal_relationship_allocations')
    .column('posting_fingerprint')
    .execute();

  await db.schema
    .createIndex('idx_accounting_journal_relationship_allocations_unique_posting')
    .on('accounting_journal_relationship_allocations')
    .columns(['relationship_id', 'allocation_side', 'posting_fingerprint'])
    .unique()
    .execute();

  await ensureLedgerResetPerformanceIndexes(db);

  await db.schema
    .createTable('ledger_linking_asset_identity_assertions')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('profile_id', 'integer', (col) => col.notNull().references('profiles.id'))
    .addColumn('relationship_kind', 'text', (col) => col.notNull())
    .addColumn('asset_id_a', 'text', (col) => col.notNull())
    .addColumn('asset_id_b', 'text', (col) => col.notNull())
    .addColumn('evidence_kind', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint(
      'ledger_linking_asset_identity_assertions_relationship_kind_valid',
      sql`relationship_kind IN ('internal_transfer', 'external_transfer', 'same_hash_carryover', 'bridge', 'asset_migration')`
    )
    .addCheckConstraint(
      'ledger_linking_asset_identity_assertions_asset_ids_not_empty',
      sql`trim(asset_id_a) <> '' AND trim(asset_id_b) <> ''`
    )
    .addCheckConstraint('ledger_linking_asset_identity_assertions_asset_ids_canonical', sql`asset_id_a < asset_id_b`)
    .addCheckConstraint(
      'ledger_linking_asset_identity_assertions_evidence_kind_valid',
      sql`evidence_kind IN ('manual', 'seeded', 'exact_hash_observed')`
    )
    .execute();

  await db.schema
    .createIndex('idx_ledger_linking_asset_identity_assertions_profile_kind')
    .on('ledger_linking_asset_identity_assertions')
    .columns(['profile_id', 'relationship_kind'])
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_ledger_linking_asset_identity_assertions_unique
    ON ledger_linking_asset_identity_assertions(profile_id, relationship_kind, asset_id_a, asset_id_b)
  `.execute(db);

  await db.schema
    .createTable('accounting_overrides')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('profile_id', 'integer', (col) => col.notNull().references('profiles.id'))
    .addColumn('target_scope', 'text', (col) => col.notNull())
    .addColumn('target_journal_fingerprint', 'text')
    .addColumn('target_posting_fingerprint', 'text')
    .addColumn('override_kind', 'text', (col) => col.notNull())
    .addColumn('journal_kind', 'text')
    .addColumn('posting_role', 'text')
    .addColumn('settlement', 'text')
    .addColumn('stale_reason', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint('accounting_overrides_target_scope_valid', sql`target_scope IN ('journal', 'posting')`)
    .addCheckConstraint(
      'accounting_overrides_target_scope_shape',
      sql`(target_scope = 'journal' AND target_journal_fingerprint IS NOT NULL AND target_posting_fingerprint IS NULL) OR (target_scope = 'posting' AND target_posting_fingerprint IS NOT NULL AND target_journal_fingerprint IS NULL)`
    )
    .addCheckConstraint(
      'accounting_overrides_target_fingerprint_not_empty',
      sql`(target_journal_fingerprint IS NULL OR trim(target_journal_fingerprint) <> '') AND (target_posting_fingerprint IS NULL OR trim(target_posting_fingerprint) <> '')`
    )
    .addCheckConstraint(
      'accounting_overrides_override_kind_valid',
      sql`override_kind IN ('journal_kind', 'posting_role', 'posting_settlement')`
    )
    .addCheckConstraint(
      'accounting_overrides_journal_kind_valid',
      sql`journal_kind IS NULL OR journal_kind IN ('transfer', 'trade', 'staking_reward', 'protocol_event', 'refund_rebate', 'internal_transfer', 'expense_only', 'opening_balance', 'unknown')`
    )
    .addCheckConstraint(
      'accounting_overrides_posting_role_valid',
      sql`posting_role IS NULL OR posting_role IN ('principal', 'fee', 'staking_reward', 'protocol_deposit', 'protocol_refund', 'protocol_overhead', 'refund_rebate', 'opening_position')`
    )
    .addCheckConstraint(
      'accounting_overrides_settlement_valid',
      sql`settlement IS NULL OR settlement IN ('on-chain', 'balance', 'external')`
    )
    .addCheckConstraint(
      'accounting_overrides_payload_shape',
      sql`(override_kind = 'journal_kind' AND journal_kind IS NOT NULL AND posting_role IS NULL) OR (override_kind = 'posting_role' AND posting_role IS NOT NULL AND journal_kind IS NULL) OR (override_kind = 'posting_settlement' AND journal_kind IS NULL AND posting_role IS NULL)`
    )
    .execute();

  await db.schema
    .createIndex('idx_accounting_overrides_profile_id')
    .on('accounting_overrides')
    .column('profile_id')
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_accounting_overrides_journal_target_kind
    ON accounting_overrides(profile_id, target_journal_fingerprint, override_kind)
    WHERE target_scope = 'journal'
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX idx_accounting_overrides_posting_target_kind
    ON accounting_overrides(profile_id, target_posting_fingerprint, override_kind)
    WHERE target_scope = 'posting'
  `.execute(db);

  // Create transactions table
  await db.schema
    .createTable('transactions')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('account_id', 'integer', (col) => col.notNull().references('accounts.id'))
    .addColumn('platform_key', 'text', (col) => col.notNull())
    .addColumn('platform_kind', 'text', (col) => col.notNull())
    .addColumn('tx_fingerprint', 'text', (col) => col.notNull())
    .addColumn('transaction_status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('transaction_datetime', 'text', (col) => col.notNull())
    .addColumn('from_address', 'text')
    .addColumn('to_address', 'text')
    .addColumn('diagnostics_json', 'text') // Array<TransactionDiagnostic>
    .addColumn('user_notes_json', 'text') // Array<UserNote>
    .addColumn('excluded_from_accounting', 'integer', (col) => col.notNull().defaultTo(0))
    // Structured movements - REMOVED (normalized to transaction_movements table)
    // Structured fees - REMOVED (normalized to transaction_movements table)
    // Operation classification
    .addColumn('operation_category', 'text')
    .addColumn('operation_type', 'text')
    // Blockchain metadata
    .addColumn('blockchain_name', 'text')
    .addColumn('blockchain_block_height', 'integer')
    .addColumn('blockchain_transaction_hash', 'text')
    .addColumn('blockchain_is_confirmed', 'boolean')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint('transactions_platform_kind_valid', sql`platform_kind IN ('blockchain', 'exchange')`)
    .addCheckConstraint(
      'transactions_status_valid',
      sql`transaction_status IN ('pending', 'success', 'failed', 'open', 'closed', 'canceled')`
    )
    .addCheckConstraint(
      'transactions_operation_category_valid',
      sql`operation_category IS NULL OR operation_category IN ('trade', 'transfer', 'staking', 'defi', 'fee', 'governance')`
    )
    .addCheckConstraint(
      'transactions_operation_type_valid',
      sql`operation_type IS NULL OR operation_type IN ('buy', 'sell', 'deposit', 'withdrawal', 'stake', 'unstake', 'reward', 'swap', 'fee', 'batch', 'transfer', 'refund', 'vote', 'proposal', 'airdrop')`
    )
    .addCheckConstraint(
      'transactions_diagnostics_json_valid',
      sql`diagnostics_json IS NULL OR json_valid(diagnostics_json)`
    )
    .addCheckConstraint(
      'transactions_user_notes_json_valid',
      sql`user_notes_json IS NULL OR json_valid(user_notes_json)`
    )
    // REMOVED: movements_inflows, movements_outflows, fees check constraints (normalized to transaction_movements)
    .execute();

  // Create index on account_id for fast account-scoped queries
  await db.schema.createIndex('idx_transactions_account_id').on('transactions').column('account_id').execute();

  // Create unique index on tx_fingerprint to enforce canonical processed transaction identity
  await db.schema
    .createIndex('idx_transactions_tx_fingerprint')
    .on('transactions')
    .column('tx_fingerprint')
    .unique()
    .execute();

  // Create unique index on (account_id, blockchain_transaction_hash) to prevent duplicate blockchain transactions per account
  // Only applies when blockchain_transaction_hash is not null (blockchain transactions, not exchange transactions)
  await sql`
    CREATE UNIQUE INDEX idx_transactions_account_blockchain_hash
    ON transactions(account_id, blockchain_transaction_hash)
    WHERE blockchain_transaction_hash IS NOT NULL
  `.execute(db);

  // Create index for accounting exclusions (for fast filtering of scam tokens, test data, etc.)
  await db.schema
    .createIndex('idx_transactions_excluded_from_accounting')
    .on('transactions')
    .column('excluded_from_accounting')
    .execute();

  // Create transaction_raw_bindings table - lineage from processed transactions back to raw source rows
  await db.schema
    .createTable('transaction_raw_bindings')
    .addColumn('transaction_id', 'integer', (col) => col.notNull().references('transactions.id').onDelete('cascade'))
    .addColumn('raw_transaction_id', 'integer', (col) =>
      col.notNull().references('raw_transactions.id').onDelete('cascade')
    )
    .addPrimaryKeyConstraint('pk_transaction_raw_bindings', ['transaction_id', 'raw_transaction_id'])
    .execute();

  await db.schema
    .createIndex('idx_transaction_raw_bindings_raw_transaction_id')
    .on('transaction_raw_bindings')
    .column('raw_transaction_id')
    .execute();

  // Create transaction_movements table - normalized storage for asset movements and fees
  await db.schema
    .createTable('transaction_movements')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('transaction_id', 'integer', (col) => col.notNull().references('transactions.id').onDelete('cascade'))
    .addColumn('movement_type', 'text', (col) => col.notNull())
    .addColumn('movement_fingerprint', 'text', (col) => col.notNull())
    .addColumn('asset_id', 'text', (col) => col.notNull())
    .addColumn('asset_symbol', 'text', (col) => col.notNull())
    .addColumn('movement_role', 'text') // NULL for fee rows
    .addColumn('movement_role_override', 'text') // NULL unless a durable manual override is materialized
    // Amount fields
    .addColumn('gross_amount', 'text') // NULL for fee rows
    .addColumn('net_amount', 'text') // NULL for fee rows
    .addColumn('fee_amount', 'text') // NULL for inflow/outflow rows
    // Fee-specific fields
    .addColumn('fee_scope', 'text') // NULL for inflow/outflow rows
    .addColumn('fee_settlement', 'text') // NULL for inflow/outflow rows
    // Price metadata
    .addColumn('price_amount', 'text')
    .addColumn('price_currency', 'text')
    .addColumn('price_source', 'text')
    .addColumn('price_fetched_at', 'text')
    .addColumn('price_granularity', 'text')
    .addColumn('fx_rate_to_usd', 'text')
    .addColumn('fx_source', 'text')
    .addColumn('fx_timestamp', 'text')
    .addCheckConstraint('transaction_movements_type_valid', sql`movement_type IN ('inflow', 'outflow', 'fee')`)
    .addCheckConstraint(
      'transaction_movements_role_valid',
      sql`movement_role IS NULL OR movement_role IN ('principal', 'staking_reward', 'protocol_overhead', 'refund_rebate')`
    )
    .addCheckConstraint(
      'transaction_movements_role_override_valid',
      sql`movement_role_override IS NULL OR movement_role_override IN ('principal', 'staking_reward', 'protocol_overhead', 'refund_rebate')`
    )
    .addCheckConstraint(
      'transaction_movements_fee_role_fields',
      sql`(movement_type = 'fee' AND movement_role IS NULL AND movement_role_override IS NULL) OR movement_type IN ('inflow', 'outflow')`
    )
    .addCheckConstraint(
      'transaction_movements_fee_scope_valid',
      sql`fee_scope IS NULL OR fee_scope IN ('network', 'platform', 'spread', 'tax', 'other')`
    )
    .addCheckConstraint(
      'transaction_movements_fee_settlement_valid',
      sql`fee_settlement IS NULL OR fee_settlement IN ('on-chain', 'balance', 'external')`
    )
    .addCheckConstraint(
      'transaction_movements_inflow_outflow_amounts',
      sql`(movement_type IN ('inflow', 'outflow') AND gross_amount IS NOT NULL) OR movement_type = 'fee'`
    )
    .addCheckConstraint(
      'transaction_movements_fee_fields',
      sql`(movement_type = 'fee' AND fee_amount IS NOT NULL AND fee_scope IS NOT NULL AND fee_settlement IS NOT NULL) OR movement_type IN ('inflow', 'outflow')`
    )
    .addCheckConstraint(
      'transaction_movements_price_all_or_nothing',
      sql`(price_amount IS NULL AND price_currency IS NULL AND price_source IS NULL AND price_fetched_at IS NULL AND price_granularity IS NULL) OR (price_amount IS NOT NULL AND price_currency IS NOT NULL AND price_source IS NOT NULL AND price_fetched_at IS NOT NULL)`
    )
    .execute();

  // Create index on transaction_id for efficient joins (non-unique for batch loading)
  await db.schema
    .createIndex('idx_transaction_movements_transaction_id')
    .on('transaction_movements')
    .column('transaction_id')
    .execute();

  // Create unique index on movement_fingerprint to enforce canonical processed movement identity
  await db.schema
    .createIndex('idx_transaction_movements_movement_fingerprint')
    .on('transaction_movements')
    .column('movement_fingerprint')
    .unique()
    .execute();

  // Token metadata cache tables moved to token-metadata.db.

  // Create transaction_links table
  await db.schema
    .createTable('transaction_links')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('source_transaction_id', 'integer', (col) => col.notNull().references('transactions.id'))
    .addColumn('target_transaction_id', 'integer', (col) => col.notNull().references('transactions.id'))
    .addColumn('asset', 'text', (col) => col.notNull())
    .addColumn('source_asset_id', 'text', (col) => col.notNull())
    .addColumn('target_asset_id', 'text', (col) => col.notNull())
    .addColumn('source_amount', 'text', (col) => col.notNull())
    .addColumn('target_amount', 'text', (col) => col.notNull())
    .addColumn('implied_fee_amount', 'text')
    .addColumn('source_movement_fingerprint', 'text', (col) => col.notNull())
    .addColumn('target_movement_fingerprint', 'text', (col) => col.notNull())
    .addColumn('link_type', 'text', (col) => col.notNull())
    .addColumn('confidence_score', 'text', (col) => col.notNull())
    .addColumn('match_criteria_json', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('reviewed_by', 'text')
    .addColumn('reviewed_at', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .addCheckConstraint(
      'transaction_links_link_type_valid',
      sql`link_type IN ('exchange_to_blockchain', 'blockchain_to_exchange', 'blockchain_to_blockchain', 'exchange_to_exchange', 'blockchain_internal')`
    )
    .addCheckConstraint(
      'transaction_links_implied_fee_amount_valid',
      sql`
        implied_fee_amount IS NULL
        OR (
          CASE
            WHEN json_valid(implied_fee_amount)
            THEN json_type(implied_fee_amount) IN ('integer', 'real')
              AND CAST(implied_fee_amount AS REAL) >= 0
            ELSE 0
          END
        )
      `
    )
    .addCheckConstraint(
      'transaction_links_confidence_score_valid',
      sql`
        CASE
          WHEN json_valid(confidence_score)
          THEN json_type(confidence_score) IN ('integer', 'real')
            AND CAST(confidence_score AS REAL) >= 0
            AND CAST(confidence_score AS REAL) <= 1
          ELSE 0
        END
      `
    )
    .addCheckConstraint('transaction_links_status_valid', sql`status IN ('suggested', 'confirmed', 'rejected')`)
    .addCheckConstraint('transaction_links_match_criteria_json_valid', sql`json_valid(match_criteria_json)`)
    .addCheckConstraint(
      'transaction_links_match_criteria_shape_valid',
      sql`
        json_type(match_criteria_json) = 'object'
        AND json_type(match_criteria_json, '$.assetMatch') IN ('true', 'false')
        AND json_type(match_criteria_json, '$.timingValid') IN ('true', 'false')
        AND json_type(match_criteria_json, '$.timingHours') IN ('integer', 'real')
        AND (
          CASE
            WHEN json_type(match_criteria_json, '$.amountSimilarity') IN ('integer', 'real')
            THEN CAST(json_extract(match_criteria_json, '$.amountSimilarity') AS REAL) >= 0
              AND CAST(json_extract(match_criteria_json, '$.amountSimilarity') AS REAL) <= 1
            WHEN json_type(match_criteria_json, '$.amountSimilarity') = 'text'
            THEN json_valid(json_extract(match_criteria_json, '$.amountSimilarity'))
              AND json_type(json_extract(match_criteria_json, '$.amountSimilarity')) IN ('integer', 'real')
              AND CAST(json_extract(match_criteria_json, '$.amountSimilarity') AS REAL) >= 0
              AND CAST(json_extract(match_criteria_json, '$.amountSimilarity') AS REAL) <= 1
            ELSE 0
          END
        )
        AND (
          json_type(match_criteria_json, '$.addressMatch') IS NULL
          OR json_type(match_criteria_json, '$.addressMatch') IN ('true', 'false')
        )
        AND (
          json_type(match_criteria_json, '$.hashMatch') IS NULL
          OR json_type(match_criteria_json, '$.hashMatch') IN ('true', 'false')
        )
      `
    )
    .addCheckConstraint(
      'transaction_links_metadata_json_valid',
      sql`metadata_json IS NULL OR json_valid(metadata_json)`
    )
    .execute();

  await sql`
    CREATE TRIGGER trg_transaction_links_profile_match_insert
    BEFORE INSERT ON transaction_links
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'Transaction link profile must match')
      WHERE COALESCE(
        (
          SELECT accounts.profile_id
          FROM transactions
          INNER JOIN accounts ON accounts.id = transactions.account_id
          WHERE transactions.id = NEW.source_transaction_id
        ),
        0
      ) != COALESCE(
        (
          SELECT accounts.profile_id
          FROM transactions
          INNER JOIN accounts ON accounts.id = transactions.account_id
          WHERE transactions.id = NEW.target_transaction_id
        ),
        0
      );
    END
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_transaction_links_profile_match_update
    BEFORE UPDATE OF source_transaction_id, target_transaction_id ON transaction_links
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'Transaction link profile must match')
      WHERE COALESCE(
        (
          SELECT accounts.profile_id
          FROM transactions
          INNER JOIN accounts ON accounts.id = transactions.account_id
          WHERE transactions.id = NEW.source_transaction_id
        ),
        0
      ) != COALESCE(
        (
          SELECT accounts.profile_id
          FROM transactions
          INNER JOIN accounts ON accounts.id = transactions.account_id
          WHERE transactions.id = NEW.target_transaction_id
        ),
        0
      );
    END
  `.execute(db);

  // Create indexes for transaction_links
  await db.schema
    .createIndex('idx_tx_links_platform_key')
    .on('transaction_links')
    .column('source_transaction_id')
    .execute();

  await db.schema
    .createIndex('idx_tx_links_target_id')
    .on('transaction_links')
    .column('target_transaction_id')
    .execute();

  await db.schema.createIndex('idx_tx_links_status').on('transaction_links').column('status').execute();

  // Create composite index for source link lookup (used by LinkIndex for O(1) lookups)
  await db.schema
    .createIndex('idx_tx_links_source_lookup')
    .on('transaction_links')
    .columns(['source_transaction_id', 'asset', 'source_amount'])
    .execute();

  // Create composite index for target link lookup (used by LinkIndex)
  await db.schema
    .createIndex('idx_tx_links_target_lookup')
    .on('transaction_links')
    .columns(['target_transaction_id', 'asset'])
    .execute();

  // Projection state table - generalized lifecycle tracking for persisted derived datasets
  await sql`
    CREATE TABLE projection_state (
      projection_id        TEXT NOT NULL,
      scope_key            TEXT NOT NULL DEFAULT '__global__',
      status               TEXT NOT NULL DEFAULT 'stale'
                                 CHECK(status IN ('fresh', 'stale', 'building', 'failed')),
      last_built_at        TEXT,
      last_invalidated_at  TEXT,
      invalidated_by       TEXT,
      metadata_json        TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
      PRIMARY KEY (projection_id, scope_key)
    )
  `.execute(db);

  await sql`
    CREATE TABLE cost_basis_snapshots (
      scope_key                    TEXT PRIMARY KEY,
      snapshot_id                  TEXT NOT NULL,
      storage_schema_version       INTEGER NOT NULL,
      calculation_engine_version   INTEGER NOT NULL,
      artifact_kind                TEXT NOT NULL CHECK(artifact_kind IN ('standard', 'canada')),
      links_built_at               TEXT NOT NULL,
      asset_review_built_at        TEXT NOT NULL,
      prices_last_mutated_at       TEXT,
      exclusion_fingerprint        TEXT NOT NULL,
      calculation_id               TEXT NOT NULL,
      jurisdiction                 TEXT NOT NULL,
      method                       TEXT NOT NULL,
      tax_year                     INTEGER NOT NULL,
      display_currency             TEXT NOT NULL,
      start_date                   TEXT NOT NULL,
      end_date                     TEXT NOT NULL,
      artifact_json                TEXT NOT NULL CHECK(json_valid(artifact_json)),
      debug_json                   TEXT NOT NULL CHECK(json_valid(debug_json)),
      created_at                   TEXT NOT NULL,
      updated_at                   TEXT NOT NULL
    )
  `.execute(db);

  await db.schema
    .createIndex('idx_cost_basis_snapshots_scope')
    .on('cost_basis_snapshots')
    .column('scope_key')
    .execute();

  await db.schema
    .createIndex('idx_cost_basis_snapshots_snapshot_id')
    .on('cost_basis_snapshots')
    .column('snapshot_id')
    .execute();

  await sql`
    CREATE TABLE cost_basis_failure_snapshots (
      scope_key                    TEXT NOT NULL,
      consumer                     TEXT NOT NULL CHECK(consumer IN ('cost-basis', 'portfolio')),
      snapshot_id                  TEXT NOT NULL,
      links_status                 TEXT NOT NULL CHECK(links_status IN ('fresh', 'stale', 'building', 'failed', 'missing')),
      links_built_at               TEXT,
      asset_review_status          TEXT NOT NULL CHECK(asset_review_status IN ('fresh', 'stale', 'building', 'failed', 'missing')),
      asset_review_built_at        TEXT,
      prices_last_mutated_at       TEXT,
      exclusion_fingerprint        TEXT NOT NULL,
      jurisdiction                 TEXT NOT NULL,
      method                       TEXT NOT NULL,
      tax_year                     INTEGER NOT NULL,
      display_currency             TEXT NOT NULL,
      start_date                   TEXT NOT NULL,
      end_date                     TEXT NOT NULL,
      error_name                   TEXT NOT NULL,
      error_message                TEXT NOT NULL,
      error_stack                  TEXT,
      debug_json                   TEXT NOT NULL CHECK(json_valid(debug_json)),
      created_at                   TEXT NOT NULL,
      updated_at                   TEXT NOT NULL,
      PRIMARY KEY (scope_key, consumer)
    )
  `.execute(db);

  await db.schema
    .createIndex('idx_cost_basis_failure_snapshots_snapshot_id')
    .on('cost_basis_failure_snapshots')
    .column('snapshot_id')
    .execute();

  await db.schema
    .createTable('balance_snapshots')
    .addColumn('scope_account_id', 'integer', (col) => col.primaryKey().references('accounts.id'))
    .addColumn('calculated_at', 'text')
    .addColumn('last_refresh_at', 'text')
    .addColumn('verification_status', 'text', (col) => col.notNull().defaultTo('never-run'))
    .addColumn('coverage_status', 'text')
    .addColumn('coverage_confidence', 'text')
    .addColumn('requested_address_count', 'integer')
    .addColumn('successful_address_count', 'integer')
    .addColumn('failed_address_count', 'integer')
    .addColumn('total_asset_count', 'integer')
    .addColumn('parsed_asset_count', 'integer')
    .addColumn('failed_asset_count', 'integer')
    .addColumn('match_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('warning_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('mismatch_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('status_reason', 'text')
    .addColumn('suggestion', 'text')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint(
      'balance_snapshots_verification_status_valid',
      sql`verification_status IN ('never-run', 'match', 'warning', 'mismatch', 'unavailable')`
    )
    .addCheckConstraint(
      'balance_snapshots_coverage_status_valid',
      sql`coverage_status IS NULL OR coverage_status IN ('complete', 'partial')`
    )
    .addCheckConstraint(
      'balance_snapshots_coverage_confidence_valid',
      sql`coverage_confidence IS NULL OR coverage_confidence IN ('high', 'medium', 'low')`
    )
    .execute();

  await db.schema
    .createTable('balance_snapshot_assets')
    .addColumn('scope_account_id', 'integer', (col) =>
      col.notNull().references('balance_snapshots.scope_account_id').onDelete('cascade')
    )
    .addColumn('asset_id', 'text', (col) => col.notNull())
    .addColumn('asset_symbol', 'text', (col) => col.notNull())
    .addColumn('balance_category', 'text', (col) => col.notNull().defaultTo('liquid'))
    .addColumn('calculated_balance', 'text', (col) => col.notNull())
    .addColumn('live_balance', 'text')
    .addColumn('difference', 'text')
    .addColumn('comparison_status', 'text')
    .addColumn('excluded_from_accounting', 'integer', (col) => col.notNull().defaultTo(0))
    .addPrimaryKeyConstraint('balance_snapshot_assets_pk', ['scope_account_id', 'asset_id', 'balance_category'])
    .addCheckConstraint(
      'balance_snapshot_assets_category_valid',
      sql`balance_category IN ('liquid', 'staked', 'unbonding', 'reward_receivable')`
    )
    .addCheckConstraint(
      'balance_snapshot_assets_comparison_status_valid',
      sql`comparison_status IS NULL OR comparison_status IN ('match', 'warning', 'mismatch', 'unavailable')`
    )
    .execute();

  await db.schema
    .createIndex('idx_balance_snapshot_assets_asset_id')
    .on('balance_snapshot_assets')
    .column('asset_id')
    .execute();

  await db.schema
    .createIndex('idx_balance_snapshot_assets_symbol')
    .on('balance_snapshot_assets')
    .column('asset_symbol')
    .execute();

  await db.schema
    .createTable('asset_review_state')
    .addColumn('profile_id', 'integer', (col) => col.notNull().references('profiles.id').onDelete('cascade'))
    .addColumn('asset_id', 'text', (col) => col.notNull())
    .addColumn('review_status', 'text', (col) => col.notNull())
    .addColumn('reference_status', 'text', (col) => col.notNull())
    .addColumn('warning_summary', 'text')
    .addColumn('evidence_fingerprint', 'text', (col) => col.notNull())
    .addColumn('confirmed_evidence_fingerprint', 'text')
    .addColumn('confirmation_is_stale', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('accounting_blocked', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('computed_at', 'text', (col) => col.notNull())
    .addCheckConstraint(
      'asset_review_state_review_status_valid',
      sql`review_status IN ('clear', 'needs-review', 'reviewed')`
    )
    .addCheckConstraint(
      'asset_review_state_reference_status_valid',
      sql`reference_status IN ('matched', 'unmatched', 'unknown')`
    )
    .addPrimaryKeyConstraint('asset_review_state_pk', ['profile_id', 'asset_id'])
    .execute();

  await db.schema
    .createIndex('idx_asset_review_state_profile_review_status')
    .on('asset_review_state')
    .columns(['profile_id', 'review_status'])
    .execute();

  await db.schema
    .createIndex('idx_asset_review_state_profile_accounting_blocked')
    .on('asset_review_state')
    .columns(['profile_id', 'accounting_blocked'])
    .execute();

  await db.schema
    .createTable('asset_review_evidence')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('profile_id', 'integer', (col) => col.notNull().references('profiles.id').onDelete('cascade'))
    .addColumn('asset_id', 'text', (col) => col.notNull())
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('severity', 'text', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .addCheckConstraint(
      'asset_review_evidence_kind_valid',
      sql`kind IN ('provider-spam-flag', 'scam-diagnostic', 'suspicious-airdrop-diagnostic', 'same-symbol-ambiguity', 'unmatched-reference')`
    )
    .addCheckConstraint('asset_review_evidence_severity_valid', sql`severity IN ('warning', 'error')`)
    .addCheckConstraint(
      'asset_review_evidence_metadata_json_valid',
      sql`metadata_json IS NULL OR json_valid(metadata_json)`
    )
    .addForeignKeyConstraint(
      'asset_review_evidence_profile_asset_fk',
      ['profile_id', 'asset_id'],
      'asset_review_state',
      ['profile_id', 'asset_id'],
      (cb) => cb.onDelete('cascade')
    )
    .execute();

  await db.schema
    .createIndex('idx_asset_review_evidence_profile_asset_position')
    .on('asset_review_evidence')
    .columns(['profile_id', 'asset_id', 'position'])
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_asset_review_evidence_profile_asset_id')
    .on('asset_review_evidence')
    .columns(['profile_id', 'asset_id'])
    .execute();

  await db.schema.createIndex('idx_asset_review_evidence_kind').on('asset_review_evidence').column('kind').execute();

  await db.schema
    .createTable('accounting_issue_scopes')
    .addColumn('scope_key', 'text', (col) => col.primaryKey())
    .addColumn('scope_kind', 'text', (col) => col.notNull())
    .addColumn('profile_id', 'integer', (col) => col.notNull().references('profiles.id').onDelete('cascade'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('open_issue_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('blocking_issue_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .addCheckConstraint('accounting_issue_scopes_scope_kind_valid', sql`scope_kind IN ('profile', 'cost-basis')`)
    .addCheckConstraint('accounting_issue_scopes_status_valid', sql`status IN ('ready', 'has-open-issues', 'failed')`)
    .addCheckConstraint('accounting_issue_scopes_open_issue_count_non_negative', sql`open_issue_count >= 0`)
    .addCheckConstraint('accounting_issue_scopes_blocking_issue_count_non_negative', sql`blocking_issue_count >= 0`)
    .addCheckConstraint(
      'accounting_issue_scopes_metadata_json_valid',
      sql`metadata_json IS NULL OR json_valid(metadata_json)`
    )
    .execute();

  await db.schema
    .createIndex('idx_accounting_issue_scopes_profile_id')
    .on('accounting_issue_scopes')
    .column('profile_id')
    .execute();

  await db.schema
    .createTable('accounting_issue_rows')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('scope_key', 'text', (col) =>
      col.notNull().references('accounting_issue_scopes.scope_key').onDelete('cascade')
    )
    .addColumn('issue_key', 'text', (col) => col.notNull())
    .addColumn('family', 'text', (col) => col.notNull())
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('severity', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('summary', 'text', (col) => col.notNull())
    .addColumn('first_seen_at', 'text', (col) => col.notNull())
    .addColumn('last_seen_at', 'text', (col) => col.notNull())
    .addColumn('closed_at', 'text')
    .addColumn('closed_reason', 'text')
    .addColumn('detail_json', 'text', (col) => col.notNull())
    .addColumn('evidence_json', 'text', (col) => col.notNull())
    .addColumn('next_actions_json', 'text', (col) => col.notNull())
    .addCheckConstraint(
      'accounting_issue_rows_family_valid',
      sql`family IN ('transfer_gap', 'asset_review_blocker', 'missing_price', 'tax_readiness', 'execution_failure')`
    )
    .addCheckConstraint(
      'accounting_issue_rows_code_valid',
      sql`code IN (
        'LINK_GAP',
        'ASSET_REVIEW_BLOCKER',
        'MISSING_PRICE_DATA',
        'FX_FALLBACK_USED',
        'UNRESOLVED_ASSET_REVIEW',
        'UNKNOWN_TRANSACTION_CLASSIFICATION',
        'UNCERTAIN_PROCEEDS_ALLOCATION',
        'INCOMPLETE_TRANSFER_LINKING',
        'WORKFLOW_EXECUTION_FAILED'
      )`
    )
    .addCheckConstraint('accounting_issue_rows_severity_valid', sql`severity IN ('warning', 'blocked')`)
    .addCheckConstraint('accounting_issue_rows_status_valid', sql`status IN ('open', 'closed')`)
    .addCheckConstraint(
      'accounting_issue_rows_closed_reason_valid',
      sql`closed_reason IS NULL OR closed_reason IN ('disappeared')`
    )
    .addCheckConstraint('accounting_issue_rows_detail_json_valid', sql`json_valid(detail_json)`)
    .addCheckConstraint('accounting_issue_rows_evidence_json_valid', sql`json_valid(evidence_json)`)
    .addCheckConstraint('accounting_issue_rows_next_actions_json_valid', sql`json_valid(next_actions_json)`)
    .execute();

  await db.schema
    .createIndex('idx_accounting_issue_rows_scope_status')
    .on('accounting_issue_rows')
    .columns(['scope_key', 'status'])
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_accounting_issue_rows_open_scope_issue_key
    ON accounting_issue_rows (scope_key, issue_key)
    WHERE status = 'open'
  `.execute(db);

  // Transaction annotations — persisted interpretation layer. See
  // docs/dev/transaction-interpretation-architecture-2026-04-20.md.
  await db.schema
    .createTable('transaction_annotations')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('annotation_fingerprint', 'text', (col) => col.notNull())
    .addColumn('account_id', 'integer', (col) => col.notNull().references('accounts.id').onDelete('cascade'))
    .addColumn('transaction_id', 'integer', (col) => col.notNull().references('transactions.id').onDelete('cascade'))
    .addColumn('tx_fingerprint', 'text', (col) => col.notNull())
    .addColumn('target_scope', 'text', (col) => col.notNull())
    .addColumn('movement_fingerprint', 'text')
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('tier', 'text', (col) => col.notNull())
    .addColumn('role', 'text')
    .addColumn('protocol_ref_id', 'text')
    .addColumn('protocol_ref_version', 'text')
    .addColumn('group_key', 'text')
    .addColumn('detector_id', 'text', (col) => col.notNull())
    .addColumn('derived_from_tx_ids_json', 'text', (col) => col.notNull())
    .addColumn('provenance_inputs_json', 'text', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint('transaction_annotations_target_scope_valid', sql`target_scope IN ('transaction', 'movement')`)
    .addCheckConstraint(
      'transaction_annotations_movement_fingerprint_required',
      sql`(target_scope = 'movement' AND movement_fingerprint IS NOT NULL)
          OR (target_scope = 'transaction' AND movement_fingerprint IS NULL)`
    )
    .addCheckConstraint(
      'transaction_annotations_kind_valid',
      sql`kind IN (
        'bridge_participant',
        'asset_migration_participant',
        'staking_reward',
        'wrap',
        'unwrap',
        'protocol_deposit',
        'protocol_withdrawal',
        'airdrop_claim'
      )`
    )
    .addCheckConstraint('transaction_annotations_tier_valid', sql`tier IN ('asserted', 'heuristic')`)
    .addCheckConstraint(
      'transaction_annotations_role_valid',
      sql`role IS NULL OR role IN ('source', 'target', 'claim', 'deposit', 'withdrawal')`
    )
    .addCheckConstraint(
      'transaction_annotations_protocol_version_requires_id',
      sql`protocol_ref_version IS NULL OR protocol_ref_id IS NOT NULL`
    )
    .addCheckConstraint(
      'transaction_annotations_derived_from_tx_ids_json_valid',
      sql`json_valid(derived_from_tx_ids_json)
          AND json_type(derived_from_tx_ids_json) = 'array'
          AND json_array_length(derived_from_tx_ids_json) > 0`
    )
    .addCheckConstraint('transaction_annotations_provenance_inputs_json_valid', sql`json_valid(provenance_inputs_json)`)
    .addCheckConstraint(
      'transaction_annotations_metadata_json_valid',
      sql`metadata_json IS NULL OR json_valid(metadata_json)`
    )
    .execute();

  await db.schema
    .createIndex('idx_transaction_annotations_fingerprint_unique')
    .on('transaction_annotations')
    .column('annotation_fingerprint')
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_transaction_annotations_account_kind_tier')
    .on('transaction_annotations')
    .columns(['account_id', 'kind', 'tier'])
    .execute();

  await db.schema
    .createIndex('idx_transaction_annotations_account_protocol')
    .on('transaction_annotations')
    .columns(['account_id', 'protocol_ref_id', 'protocol_ref_version'])
    .execute();

  await db.schema
    .createIndex('idx_transaction_annotations_account_group')
    .on('transaction_annotations')
    .columns(['account_id', 'group_key'])
    .execute();

  await db.schema
    .createIndex('idx_transaction_annotations_detector')
    .on('transaction_annotations')
    .column('detector_id')
    .execute();

  await db.schema
    .createIndex('idx_transaction_annotations_transaction')
    .on('transaction_annotations')
    .column('transaction_id')
    .execute();

  await sql`
    CREATE TRIGGER trg_transaction_annotations_derived_from_tx_ids_items_insert
    BEFORE INSERT ON transaction_annotations
    FOR EACH ROW
    WHEN json_valid(NEW.derived_from_tx_ids_json)
      AND json_type(NEW.derived_from_tx_ids_json) = 'array'
      AND EXISTS (
        SELECT 1
        FROM json_each(NEW.derived_from_tx_ids_json)
        WHERE json_each.type != 'integer'
          OR CAST(json_each.value AS INTEGER) <= 0
      )
    BEGIN
      SELECT RAISE(ABORT, 'transaction_annotations derived_from_tx_ids_json must contain only positive integers');
    END
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_transaction_annotations_derived_from_tx_ids_items_update
    BEFORE UPDATE OF derived_from_tx_ids_json ON transaction_annotations
    FOR EACH ROW
    WHEN json_valid(NEW.derived_from_tx_ids_json)
      AND json_type(NEW.derived_from_tx_ids_json) = 'array'
      AND EXISTS (
        SELECT 1
        FROM json_each(NEW.derived_from_tx_ids_json)
        WHERE json_each.type != 'integer'
          OR CAST(json_each.value AS INTEGER) <= 0
      )
    BEGIN
      SELECT RAISE(ABORT, 'transaction_annotations derived_from_tx_ids_json must contain only positive integers');
    END
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('transaction_annotations').ifExists().execute();
  await db.schema.dropTable('accounting_issue_rows').ifExists().execute();
  await db.schema.dropTable('accounting_issue_scopes').ifExists().execute();
  await db.schema.dropTable('asset_review_evidence').ifExists().execute();
  await db.schema.dropTable('asset_review_state').ifExists().execute();
  await db.schema.dropTable('balance_snapshot_assets').ifExists().execute();
  await db.schema.dropTable('balance_snapshots').ifExists().execute();
  await db.schema.dropTable('cost_basis_failure_snapshots').ifExists().execute();
  await db.schema.dropTable('cost_basis_snapshots').ifExists().execute();
  await db.schema.dropTable('projection_state').execute();
  await db.schema.dropTable('accounting_overrides').ifExists().execute();
  await db.schema.dropTable('ledger_linking_asset_identity_assertions').ifExists().execute();
  await db.schema.dropTable('accounting_journal_relationship_allocations').ifExists().execute();
  await db.schema.dropTable('accounting_journal_relationships').ifExists().execute();
  await db.schema.dropTable('accounting_posting_source_components').ifExists().execute();
  await db.schema.dropTable('accounting_postings').ifExists().execute();
  await db.schema.dropTable('accounting_journal_diagnostics').ifExists().execute();
  await db.schema.dropTable('accounting_journals').ifExists().execute();
  // Drop transaction_movements BEFORE transactions (FK constraint)
  await db.schema.dropTable('transaction_movements').execute();
  await db.schema.dropTable('raw_transaction_source_activity_assignments').ifExists().execute();
  await db.schema.dropTable('transaction_raw_bindings').execute();
  // Drop transaction linking table
  await db.schema.dropTable('transaction_links').execute();
  // Drop token metadata tables
  await db.schema.dropTable('symbol_index').ifExists().execute();
  await db.schema.dropTable('token_metadata').ifExists().execute();
  // Drop transaction-related tables
  await db.schema.dropTable('transactions').execute();
  await db.schema.dropTable('source_activities').ifExists().execute();
  await db.schema.dropTable('raw_transactions').execute();
  await db.schema.dropTable('import_sessions').execute();
  // Drop accounts and profiles tables
  await db.schema.dropTable('accounts').execute();
  await db.schema.dropTable('profiles').execute();
}
