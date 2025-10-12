import { sql, type Kysely } from 'kysely';

import type { PricesDatabase } from '../schema.js';

export async function up(db: Kysely<PricesDatabase>): Promise<void> {
  // Create providers table
  await db.schema
    .createTable('providers')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('display_name', 'text', (col) => col.notNull())
    .addColumn('last_coin_list_sync', 'text')
    .addColumn('coin_list_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('metadata', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .execute();

  // Create provider_coin_mappings table
  await db.schema
    .createTable('provider_coin_mappings')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('provider_id', 'integer', (col) => col.notNull().references('providers.id').onDelete('cascade'))
    .addColumn('symbol', 'text', (col) => col.notNull())
    .addColumn('coin_id', 'text', (col) => col.notNull())
    .addColumn('coin_name', 'text', (col) => col.notNull())
    .addColumn('priority', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .execute();

  // Create unique index on (provider_id, symbol, coin_id)
  await db.schema
    .createIndex('idx_provider_coin_mappings_provider_symbol_coin')
    .on('provider_coin_mappings')
    .columns(['provider_id', 'symbol', 'coin_id'])
    .unique()
    .execute();

  // Create index for fast symbol lookups
  await db.schema
    .createIndex('idx_provider_coin_mappings_provider_symbol')
    .on('provider_coin_mappings')
    .columns(['provider_id', 'symbol'])
    .execute();

  // Create prices table
  await db.schema
    .createTable('prices')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('asset_symbol', 'text', (col) => col.notNull())
    .addColumn('currency', 'text', (col) => col.notNull())
    .addColumn('timestamp', 'text', (col) => col.notNull())
    .addColumn('price', 'text', (col) => col.notNull())
    .addColumn('source_provider', 'text', (col) => col.notNull())
    .addColumn('provider_coin_id', 'text')
    .addColumn('fetched_at', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .execute();

  // Create unique index on (asset_symbol, currency, timestamp)
  // Only one price per asset/currency/timestamp
  await db.schema
    .createIndex('idx_prices_asset_currency_timestamp')
    .on('prices')
    .columns(['asset_symbol', 'currency', 'timestamp'])
    .unique()
    .execute();

  // Create index for fast lookups by timestamp (for range queries)
  await db.schema.createIndex('idx_prices_timestamp').on('prices').column('timestamp').execute();

  // Create index for provider lookups
  await db.schema.createIndex('idx_prices_provider').on('prices').column('source_provider').execute();
}

export async function down(db: Kysely<PricesDatabase>): Promise<void> {
  await db.schema.dropTable('prices').execute();
  await db.schema.dropTable('provider_coin_mappings').execute();
  await db.schema.dropTable('providers').execute();
}
