import { sql, type Kysely } from 'kysely';

import type { TokenMetadataDatabase } from '../schema.js';

export async function up(db: Kysely<TokenMetadataDatabase>): Promise<void> {
  await db.schema
    .createTable('token_metadata')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('blockchain', 'text', (col) => col.notNull())
    .addColumn('contract_address', 'text', (col) => col.notNull())
    .addColumn('symbol', 'text')
    .addColumn('name', 'text')
    .addColumn('decimals', 'integer')
    .addColumn('logo_url', 'text')
    .addColumn('possible_spam', 'integer')
    .addColumn('verified_contract', 'integer')
    .addColumn('description', 'text')
    .addColumn('external_url', 'text')
    .addColumn('total_supply', 'text')
    .addColumn('created_at_provider', 'text')
    .addColumn('block_number', 'integer')
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('refreshed_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex('idx_token_metadata_blockchain_contract')
    .on('token_metadata')
    .columns(['blockchain', 'contract_address'])
    .unique()
    .execute();

  await db.schema.createIndex('idx_token_metadata_refreshed_at').on('token_metadata').column('refreshed_at').execute();

  await db.schema
    .createTable('symbol_index')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('blockchain', 'text', (col) => col.notNull())
    .addColumn('symbol', 'text', (col) => col.notNull())
    .addColumn('contract_address', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex('idx_symbol_index_blockchain_symbol')
    .on('symbol_index')
    .columns(['blockchain', 'symbol'])
    .execute();

  await db.schema.createIndex('idx_symbol_index_contract').on('symbol_index').column('contract_address').execute();
}

export async function down(db: Kysely<TokenMetadataDatabase>): Promise<void> {
  await db.schema.dropTable('symbol_index').execute();
  await db.schema.dropTable('token_metadata').execute();
}
