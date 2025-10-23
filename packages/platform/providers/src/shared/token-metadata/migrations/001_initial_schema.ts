import { sql, type Kysely } from 'kysely';

import type { TokenMetadataDatabase } from '../database-schema.js';

export async function up(db: Kysely<TokenMetadataDatabase>): Promise<void> {
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
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  // Create unique index on (blockchain, contract_address)
  await db.schema
    .createIndex('idx_token_metadata_blockchain_contract')
    .on('token_metadata')
    .columns(['blockchain', 'contract_address'])
    .unique()
    .execute();

  // Create index for staleness checks
  await db.schema.createIndex('idx_token_metadata_updated_at').on('token_metadata').column('updated_at').execute();

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
}

export async function down(db: Kysely<TokenMetadataDatabase>): Promise<void> {
  await db.schema.dropTable('symbol_index').execute();
  await db.schema.dropTable('token_metadata').execute();
}
