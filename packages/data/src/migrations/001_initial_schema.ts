import { sql, type Kysely } from 'kysely';

import type { KyselyDB } from '../storage/database.js';

export async function up(db: Kysely<KyselyDB>): Promise<void> {
  // Create users table
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  // Create accounts table
  await db.schema
    .createTable('accounts')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('user_id', 'integer', (col) => col.references('users.id'))
    .addColumn('parent_account_id', 'integer', (col) => col.references('accounts.id'))
    .addColumn('account_type', 'text', (col) => col.notNull())
    .addColumn('source_name', 'text', (col) => col.notNull())
    .addColumn('identifier', 'text', (col) => col.notNull()) // address/xpub for blockchain, apiKey for exchange-api, CSV directory path for exchange-csv
    .addColumn('provider_name', 'text')
    .addColumn('credentials', 'text') // JSON: ExchangeCredentials for exchange-api accounts only
    .addColumn('last_cursor', 'text')
    .addColumn('last_balance_check_at', 'text')
    .addColumn('verification_metadata', 'text')
    .addColumn('metadata', 'text') // JSON: Account metadata (e.g., xpub derivation info)
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .addCheckConstraint(
      'accounts_account_type_valid',
      sql`account_type IN ('blockchain', 'exchange-api', 'exchange-csv')`
    )
    .addCheckConstraint('accounts_credentials_json_valid', sql`credentials IS NULL OR json_valid(credentials)`)
    .addCheckConstraint('accounts_last_cursor_json_valid', sql`last_cursor IS NULL OR json_valid(last_cursor)`)
    .addCheckConstraint(
      'accounts_verification_metadata_json_valid',
      sql`verification_metadata IS NULL OR json_valid(verification_metadata)`
    )
    .addCheckConstraint('accounts_metadata_json_valid', sql`metadata IS NULL OR json_valid(metadata)`)
    .execute();

  // Create unique index on accounts to prevent duplicate accounts
  // Using raw SQL because the index includes expressions (COALESCE for nullable user_id)
  await sql`
    CREATE UNIQUE INDEX idx_accounts_unique
    ON accounts (account_type, source_name, identifier, COALESCE(user_id, 0))
  `.execute(db);

  // Create index on parent_account_id for efficient child account queries (xpub hierarchies)
  await db.schema.createIndex('idx_accounts_parent_account_id').on('accounts').column('parent_account_id').execute();

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
    .addColumn('source_name', 'text', (col) => col.notNull())
    .addColumn('source_type', 'text', (col) => col.notNull())
    .addColumn('external_id', 'text')
    .addColumn('transaction_status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('transaction_datetime', 'text', (col) => col.notNull())
    .addColumn('from_address', 'text')
    .addColumn('to_address', 'text')
    .addColumn('notes_json', 'text') // Array<TransactionNote>
    .addColumn('is_spam', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('excluded_from_accounting', 'integer', (col) => col.notNull().defaultTo(0))
    // Structured movements
    .addColumn('movements_inflows', 'text')
    .addColumn('movements_outflows', 'text')
    // Structured fees
    .addColumn('fees', 'text') // Stores fees array: Array<FeeMovement>
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
    .addCheckConstraint('transactions_source_type_valid', sql`source_type IN ('blockchain', 'exchange')`)
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
    .addCheckConstraint('transactions_notes_json_valid', sql`notes_json IS NULL OR json_valid(notes_json)`)
    .addCheckConstraint(
      'transactions_movements_inflows_json_valid',
      sql`movements_inflows IS NULL OR json_valid(movements_inflows)`
    )
    .addCheckConstraint(
      'transactions_movements_outflows_json_valid',
      sql`movements_outflows IS NULL OR json_valid(movements_outflows)`
    )
    .addCheckConstraint('transactions_fees_json_valid', sql`fees IS NULL OR json_valid(fees)`)
    .execute();

  // Create index on account_id for fast account-scoped queries
  await db.schema.createIndex('idx_transactions_account_id').on('transactions').column('account_id').execute();

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

  // Create token_metadata table
  await db.schema
    .createTable('token_metadata')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('blockchain', 'text', (col) => col.notNull())
    .addColumn('contract_address', 'text', (col) => col.notNull())
    .addColumn('symbol', 'text')
    .addColumn('name', 'text')
    .addColumn('decimals', 'integer')
    .addColumn('logo_url', 'text')
    // Professional spam detection (Moralis, Helius, etc.) - SQLite uses INTEGER for booleans (0/1)
    .addColumn('possible_spam', 'integer')
    .addColumn('verified_contract', 'integer')
    // Additional metadata for pattern-based detection (fallback)
    .addColumn('description', 'text')
    .addColumn('external_url', 'text')
    // Additional useful fields from providers
    .addColumn('total_supply', 'text')
    .addColumn('created_at_provider', 'text')
    .addColumn('block_number', 'integer')
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('refreshed_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  // Create unique index on (blockchain, contract_address)
  await db.schema
    .createIndex('idx_token_metadata_blockchain_contract')
    .on('token_metadata')
    .columns(['blockchain', 'contract_address'])
    .unique()
    .execute();

  // Create index for staleness checks
  await db.schema.createIndex('idx_token_metadata_refreshed_at').on('token_metadata').column('refreshed_at').execute();

  // Create symbol_index table for reverse lookups
  await db.schema
    .createTable('symbol_index')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('blockchain', 'text', (col) => col.notNull())
    .addColumn('symbol', 'text', (col) => col.notNull())
    .addColumn('contract_address', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  // Create index for fast symbol lookups
  await db.schema
    .createIndex('idx_symbol_index_blockchain_symbol')
    .on('symbol_index')
    .columns(['blockchain', 'symbol'])
    .execute();

  // Create index for fast contract lookups
  await db.schema.createIndex('idx_symbol_index_contract').on('symbol_index').column('contract_address').execute();

  // Create transaction_links table
  await db.schema
    .createTable('transaction_links')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('source_transaction_id', 'integer', (col) => col.notNull().references('transactions.id'))
    .addColumn('target_transaction_id', 'integer', (col) => col.notNull().references('transactions.id'))
    .addColumn('asset', 'text', (col) => col.notNull())
    .addColumn('source_amount', 'text', (col) => col.notNull())
    .addColumn('target_amount', 'text', (col) => col.notNull())
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
      sql`link_type IN ('exchange_to_blockchain', 'blockchain_to_blockchain', 'exchange_to_exchange', 'blockchain_internal')`
    )
    .addCheckConstraint('transaction_links_status_valid', sql`status IN ('suggested', 'confirmed', 'rejected')`)
    .addCheckConstraint('transaction_links_match_criteria_json_valid', sql`json_valid(match_criteria_json)`)
    .addCheckConstraint(
      'transaction_links_metadata_json_valid',
      sql`metadata_json IS NULL OR json_valid(metadata_json)`
    )
    .execute();

  // Create indexes for transaction_links
  await db.schema
    .createIndex('idx_tx_links_source_name')
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
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Drop transaction linking table
  await db.schema.dropTable('transaction_links').execute();
  // Drop token metadata tables
  await db.schema.dropTable('symbol_index').execute();
  await db.schema.dropTable('token_metadata').execute();
  // Drop transaction-related tables
  await db.schema.dropTable('transactions').execute();
  await db.schema.dropTable('raw_transactions').execute();
  await db.schema.dropTable('import_sessions').execute();
  // Drop accounts and users tables
  await db.schema.dropTable('accounts').execute();
  await db.schema.dropTable('users').execute();
}
