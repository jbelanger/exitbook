import type { Kysely } from 'kysely';

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
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('datetime("now")'))
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
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('datetime("now")'))
    .addColumn('updated_at', 'text')
    .execute();

  // Create external_transaction_data table
  await db.schema
    .createTable('external_transaction_data')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('import_session_id', 'integer', (col) => col.notNull().references('import_sessions.id'))
    .addColumn('provider_id', 'text')
    .addColumn('raw_data', 'text', (col) => col.notNull())
    .addColumn('processing_status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('processed_at', 'text')
    .addColumn('processing_error', 'text')
    .addColumn('metadata', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('datetime("now")'))
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
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('datetime("now")'))
    .addColumn('updated_at', 'text')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('transactions').execute();
  await db.schema.dropTable('external_transaction_data').execute();
  await db.schema.dropTable('import_sessions').execute();
  await db.schema.dropTable('wallet_addresses').execute();
}
