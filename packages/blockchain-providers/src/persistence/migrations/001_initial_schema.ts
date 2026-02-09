import { sql, type Kysely } from 'kysely';

import type { ProviderStatsDatabase } from '../schema.js';

export async function up(db: Kysely<ProviderStatsDatabase>): Promise<void> {
  await db.schema
    .createTable('provider_stats')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('blockchain', 'text', (col) => col.notNull())
    .addColumn('provider_name', 'text', (col) => col.notNull())
    .addColumn('avg_response_time', 'real', (col) => col.notNull().defaultTo(0))
    .addColumn('error_rate', 'real', (col) => col.notNull().defaultTo(0))
    .addColumn('consecutive_failures', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_healthy', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('last_error', 'text')
    .addColumn('last_checked', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('failure_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_failure_time', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_success_time', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('total_successes', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('total_failures', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn('updated_at', 'text')
    .execute();

  await db.schema
    .createIndex('idx_provider_stats_blockchain_provider')
    .on('provider_stats')
    .columns(['blockchain', 'provider_name'])
    .unique()
    .execute();
}

export async function down(db: Kysely<ProviderStatsDatabase>): Promise<void> {
  await db.schema.dropTable('provider_stats').execute();
}
