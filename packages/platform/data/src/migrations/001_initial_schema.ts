import { sql, type Kysely } from 'kysely';

import type { KyselyDB } from '../storage/database.ts';

export async function up(db: Kysely<KyselyDB>): Promise<void> {
  // Create wallet_addresses table
  await db.schema
    .createTable('wallet_addresses')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('address', 'text', (col) => col.notNull())
    .addColumn('blockchain', 'text', (col) => col.notNull())
    .addColumn('address_type', 'text', (col) => col.notNull().defaultTo('unknown'))
    .addColumn('label', 'text')
    .addColumn('notes', 'text')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .execute();

  // Create import_sessions table
  await db.schema
    .createTable('import_sessions')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('source_id', 'text', (col) => col.notNull())
    .addColumn('source_type', 'text', (col) => col.notNull())
    .addColumn('provider_id', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('started'))
    .addColumn('started_at', 'text', (col) => col.notNull())
    .addColumn('completed_at', 'text')
    .addColumn('duration_ms', 'integer')
    .addColumn('transactions_imported', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('transactions_failed', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('error_message', 'text')
    .addColumn('error_details', 'text')
    .addColumn('import_params', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('import_result_metadata', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('last_balance_check_at', 'text')
    .addColumn('verification_metadata', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .execute();

  // Create external_transaction_data table
  await db.schema
    .createTable('external_transaction_data')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('import_session_id', 'integer', (col) => col.notNull().references('import_sessions.id'))
    .addColumn('provider_id', 'text')
    .addColumn('external_id', 'text')
    .addColumn('cursor', 'text')
    .addColumn('raw_data', 'text', (col) => col.notNull())
    .addColumn('normalized_data', 'text')
    .addColumn('processing_status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('processed_at', 'text')
    .addColumn('processing_error', 'text')
    .addColumn('metadata', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  // Create unique index on (import_session_id, external_id) to prevent duplicates
  await db.schema
    .createIndex('idx_external_tx_session_external_id')
    .on('external_transaction_data')
    .columns(['import_session_id', 'external_id'])
    .unique()
    .execute();

  // Create import_session_errors table
  await db.schema
    .createTable('import_session_errors')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('import_session_id', 'integer', (col) => col.notNull().references('import_sessions.id'))
    .addColumn('error_type', 'text', (col) => col.notNull())
    .addColumn('error_message', 'text', (col) => col.notNull())
    .addColumn('error_details', 'text')
    .addColumn('failed_item_data', 'text')
    .addColumn('occurred_at', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  // Create index on import_session_id for faster lookups
  await db.schema
    .createIndex('idx_import_session_errors_session_id')
    .on('import_session_errors')
    .column('import_session_id')
    .execute();

  // Create transactions table
  await db.schema
    .createTable('transactions')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('import_session_id', 'integer', (col) => col.notNull().references('import_sessions.id'))
    .addColumn('wallet_address_id', 'integer', (col) => col.references('wallet_addresses.id'))
    .addColumn('source_id', 'text', (col) => col.notNull())
    .addColumn('source_type', 'text', (col) => col.notNull())
    .addColumn('external_id', 'text')
    .addColumn('transaction_status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('transaction_datetime', 'text', (col) => col.notNull())
    .addColumn('from_address', 'text')
    .addColumn('to_address', 'text')
    .addColumn('price', 'text')
    .addColumn('price_currency', 'text')
    .addColumn('verified', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('note_type', 'text')
    .addColumn('note_severity', 'text')
    .addColumn('note_message', 'text')
    .addColumn('note_metadata', 'text')
    .addColumn('raw_normalized_data', 'text', (col) => col.notNull())
    // Structured movements
    .addColumn('movements_inflows', 'text')
    .addColumn('movements_outflows', 'text')
    .addColumn('movements_primary_asset', 'text')
    .addColumn('movements_primary_amount', 'text')
    .addColumn('movements_primary_currency', 'text')
    .addColumn('movements_primary_direction', 'text')
    // Structured fees
    .addColumn('fees_network', 'text')
    .addColumn('fees_platform', 'text')
    .addColumn('fees_total', 'text')
    // Enhanced operation classification
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

  // Create unique index on (source_id, external_id) to prevent duplicate transactions
  await db.schema
    .createIndex('idx_transactions_source_external_id')
    .on('transactions')
    .columns(['source_id', 'external_id'])
    .unique()
    .execute();

  // Create transaction_links table
  await db.schema
    .createTable('transaction_links')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('source_transaction_id', 'integer', (col) => col.notNull().references('transactions.id'))
    .addColumn('target_transaction_id', 'integer', (col) => col.notNull().references('transactions.id'))
    .addColumn('link_type', 'text', (col) => col.notNull())
    .addColumn('confidence_score', 'text', (col) => col.notNull())
    .addColumn('match_criteria_json', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('reviewed_by', 'text')
    .addColumn('reviewed_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .execute();

  // Create indexes for transaction_links
  await db.schema
    .createIndex('idx_tx_links_source_id')
    .on('transaction_links')
    .column('source_transaction_id')
    .execute();

  await db.schema
    .createIndex('idx_tx_links_target_id')
    .on('transaction_links')
    .column('target_transaction_id')
    .execute();

  await db.schema.createIndex('idx_tx_links_status').on('transaction_links').column('status').execute();

  // Create cost_basis_calculations table
  await db.schema
    .createTable('cost_basis_calculations')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('calculation_date', 'integer', (col) => col.notNull())
    .addColumn('config_json', 'text', (col) => col.notNull())
    .addColumn('start_date', 'integer')
    .addColumn('end_date', 'integer')
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
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('completed_at', 'integer')
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
    .addColumn('acquisition_date', 'integer', (col) => col.notNull())
    .addColumn('method', 'text', (col) => col.notNull())
    .addColumn('remaining_quantity', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .execute();

  // Create indexes for acquisition_lots
  await db.schema.createIndex('idx_lots_asset').on('acquisition_lots').column('asset').execute();

  await db.schema.createIndex('idx_lots_calc_id').on('acquisition_lots').column('calculation_id').execute();

  await db.schema.createIndex('idx_lots_status').on('acquisition_lots').column('status').execute();

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
    .addColumn('disposal_date', 'integer', (col) => col.notNull())
    .addColumn('holding_period_days', 'integer', (col) => col.notNull())
    .addColumn('tax_treatment_category', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
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
  await db.schema.dropTable('acquisition_lots').execute();
  await db.schema.dropTable('cost_basis_calculations').execute();
  // Drop transaction linking table
  await db.schema.dropTable('transaction_links').execute();
  // Drop transaction-related tables
  await db.schema.dropTable('transactions').execute();
  await db.schema.dropTable('import_session_errors').execute();
  await db.schema.dropTable('external_transaction_data').execute();
  await db.schema.dropTable('import_sessions').execute();
  await db.schema.dropTable('wallet_addresses').execute();
}
