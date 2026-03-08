import { sql, type Kysely } from '@exitbook/sqlite';

import type { OverridesDatabaseSchema } from '../schema.js';

export async function up(db: Kysely<OverridesDatabaseSchema>): Promise<void> {
  await db.schema
    .createTable('override_events')
    .addColumn('sequence_id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('event_id', 'text', (col) => col.notNull().unique())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('actor', 'text', (col) => col.notNull())
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('scope', 'text', (col) => col.notNull())
    .addColumn('reason', 'text')
    .addColumn('payload_json', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex('idx_override_events_scope_sequence')
    .on('override_events')
    .columns(['scope', 'sequence_id'])
    .execute();

  await db.schema.createIndex('idx_override_events_created_at').on('override_events').column('created_at').execute();
}

export async function down(db: Kysely<OverridesDatabaseSchema>): Promise<void> {
  await db.schema.dropIndex('idx_override_events_created_at').ifExists().execute();
  await db.schema.dropIndex('idx_override_events_scope_sequence').ifExists().execute();
  await db.schema.dropTable('override_events').ifExists().execute();

  await sql`DROP TABLE IF EXISTS kysely_migration`.execute(db);
  await sql`DROP TABLE IF EXISTS kysely_migration_lock`.execute(db);
}
