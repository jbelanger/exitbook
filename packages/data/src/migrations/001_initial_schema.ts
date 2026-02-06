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

  // Create cost_basis_calculations table
  await db.schema
    .createTable('cost_basis_calculations')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('calculation_date', 'text', (col) => col.notNull())
    .addColumn('config_json', 'text', (col) => col.notNull())
    .addColumn('start_date', 'text')
    .addColumn('end_date', 'text')
    .addColumn('total_proceeds', 'text', (col) => col.notNull())
    .addColumn('total_cost_basis', 'text', (col) => col.notNull())
    .addColumn('total_gain_loss', 'text', (col) => col.notNull())
    .addColumn('total_taxable_gain_loss', 'text', (col) => col.notNull())
    .addColumn('assets_processed', 'text', (col) => col.notNull())
    .addColumn('transactions_processed', 'integer', (col) => col.notNull())
    .addColumn('lots_created', 'integer', (col) => col.notNull())
    .addColumn('disposals_processed', 'integer', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('completed_at', 'text')
    .addColumn('metadata_json', 'text')
    .execute();

  // Create acquisition_lots table
  await db.schema
    .createTable('acquisition_lots')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('calculation_id', 'text', (col) => col.notNull().references('cost_basis_calculations.id'))
    .addColumn('acquisition_transaction_id', 'integer', (col) => col.notNull().references('transactions.id'))
    .addColumn('asset', 'text', (col) => col.notNull())
    .addColumn('quantity', 'text', (col) => col.notNull())
    .addColumn('cost_basis_per_unit', 'text', (col) => col.notNull())
    .addColumn('total_cost_basis', 'text', (col) => col.notNull())
    .addColumn('acquisition_date', 'text', (col) => col.notNull())
    .addColumn('method', 'text', (col) => col.notNull())
    .addColumn('remaining_quantity', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .execute();

  // Create indexes for acquisition_lots
  await db.schema.createIndex('idx_lots_asset').on('acquisition_lots').column('asset').execute();

  await db.schema.createIndex('idx_lots_calc_id').on('acquisition_lots').column('calculation_id').execute();

  await db.schema.createIndex('idx_lots_status').on('acquisition_lots').column('status').execute();

  // Create lot_transfers table
  await db.schema
    .createTable('lot_transfers')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('calculation_id', 'text', (col) =>
      col.notNull().references('cost_basis_calculations.id').onDelete('cascade')
    )
    .addColumn('source_lot_id', 'text', (col) => col.notNull().references('acquisition_lots.id'))
    .addColumn('link_id', 'text', (col) => col.notNull().references('transaction_links.id'))
    .addColumn('quantity_transferred', 'text', (col) => col.notNull())
    .addColumn('cost_basis_per_unit', 'text', (col) => col.notNull())
    .addColumn('source_transaction_id', 'integer', (col) => col.notNull().references('transactions.id'))
    .addColumn('target_transaction_id', 'integer', (col) => col.notNull().references('transactions.id'))
    .addColumn('metadata_json', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addCheckConstraint('lot_transfers_quantity_positive', sql`CAST(quantity_transferred AS REAL) > 0`)
    .execute();

  // Create indexes for lot_transfers
  await db.schema.createIndex('idx_lot_transfers_link').on('lot_transfers').column('link_id').execute();

  await db.schema.createIndex('idx_lot_transfers_calculation').on('lot_transfers').column('calculation_id').execute();

  await db.schema.createIndex('idx_lot_transfers_source_lot').on('lot_transfers').column('source_lot_id').execute();

  // Create lot_disposals table
  await db.schema
    .createTable('lot_disposals')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('lot_id', 'text', (col) => col.notNull().references('acquisition_lots.id'))
    .addColumn('disposal_transaction_id', 'integer', (col) => col.notNull().references('transactions.id'))
    .addColumn('quantity_disposed', 'text', (col) => col.notNull())
    .addColumn('proceeds_per_unit', 'text', (col) => col.notNull())
    .addColumn('total_proceeds', 'text', (col) => col.notNull())
    .addColumn('cost_basis_per_unit', 'text', (col) => col.notNull())
    .addColumn('total_cost_basis', 'text', (col) => col.notNull())
    .addColumn('gain_loss', 'text', (col) => col.notNull())
    .addColumn('disposal_date', 'text', (col) => col.notNull())
    .addColumn('holding_period_days', 'integer', (col) => col.notNull())
    .addColumn('tax_treatment_category', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .execute();

  // Create indexes for lot_disposals
  await db.schema.createIndex('idx_disposals_lot_id').on('lot_disposals').column('lot_id').execute();

  await db.schema
    .createIndex('idx_disposals_transaction_id')
    .on('lot_disposals')
    .column('disposal_transaction_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Drop accounting tables first (due to foreign keys)
  await db.schema.dropTable('lot_disposals').execute();
  await db.schema.dropTable('lot_transfers').execute();
  await db.schema.dropTable('acquisition_lots').execute();
  await db.schema.dropTable('cost_basis_calculations').execute();
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
  await db.schema.dropIndex('idx_accounts_parent_account_id').execute();
  await db.schema.dropTable('accounts').execute();
  await db.schema.dropTable('users').execute();
}
