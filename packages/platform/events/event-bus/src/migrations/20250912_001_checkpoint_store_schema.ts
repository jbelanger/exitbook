import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('subscription_checkpoints')
    .ifNotExists()
    .addColumn('subscription_id', 'text', (col) => col.primaryKey())
    .addColumn('position', 'text', (col) => col.notNull())
    .addColumn('events_processed', 'bigint', (col) => col.defaultTo(0))
    .addColumn('last_processed', 'timestamptz')
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('subscription_checkpoints').ifExists().execute();
}
