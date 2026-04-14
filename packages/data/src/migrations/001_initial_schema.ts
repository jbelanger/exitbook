import { sql } from '@exitbook/sqlite';
import type { Kysely } from '@exitbook/sqlite';

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
    .addColumn('calculated_balance', 'text', (col) => col.notNull())
    .addColumn('live_balance', 'text')
    .addColumn('difference', 'text')
    .addColumn('comparison_status', 'text')
    .addColumn('excluded_from_accounting', 'integer', (col) => col.notNull().defaultTo(0))
    .addPrimaryKeyConstraint('balance_snapshot_assets_pk', ['scope_account_id', 'asset_id'])
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
    .addColumn('acknowledged_at', 'text')
    .addColumn('first_seen_at', 'text', (col) => col.notNull())
    .addColumn('last_seen_at', 'text', (col) => col.notNull())
    .addColumn('closed_at', 'text')
    .addColumn('closed_reason', 'text')
    .addColumn('detail_json', 'text', (col) => col.notNull())
    .addColumn('evidence_json', 'text', (col) => col.notNull())
    .addColumn('next_actions_json', 'text', (col) => col.notNull())
    .addCheckConstraint(
      'accounting_issue_rows_family_valid',
      sql`family IN ('transfer_gap', 'asset_review_blocker', 'tax_readiness')`
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
        'INCOMPLETE_TRANSFER_LINKING'
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
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('accounting_issue_rows').ifExists().execute();
  await db.schema.dropTable('accounting_issue_scopes').ifExists().execute();
  await db.schema.dropTable('asset_review_evidence').ifExists().execute();
  await db.schema.dropTable('asset_review_state').ifExists().execute();
  await db.schema.dropTable('balance_snapshot_assets').ifExists().execute();
  await db.schema.dropTable('balance_snapshots').ifExists().execute();
  await db.schema.dropTable('cost_basis_failure_snapshots').ifExists().execute();
  await db.schema.dropTable('cost_basis_snapshots').ifExists().execute();
  await db.schema.dropTable('projection_state').execute();
  // Drop transaction_movements BEFORE transactions (FK constraint)
  await db.schema.dropTable('transaction_movements').execute();
  // Drop transaction linking table
  await db.schema.dropTable('transaction_links').execute();
  // Drop token metadata tables
  await db.schema.dropTable('symbol_index').ifExists().execute();
  await db.schema.dropTable('token_metadata').ifExists().execute();
  // Drop transaction-related tables
  await db.schema.dropTable('transactions').execute();
  await db.schema.dropTable('raw_transactions').execute();
  await db.schema.dropTable('import_sessions').execute();
  // Drop accounts and profiles tables
  await db.schema.dropTable('accounts').execute();
  await db.schema.dropTable('profiles').execute();
}
