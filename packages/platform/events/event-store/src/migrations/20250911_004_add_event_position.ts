import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add event_position column for consistent ordering and partition keys
  await db.schema
    .alterTable('event_outbox')
    .addColumn('event_position', 'bigint', (col) => col.notNull().defaultTo(0))
    .execute();

  // Create index for efficient ordering by event position
  await db.schema
    .createIndex('idx_event_outbox_position')
    .on('event_outbox')
    .column('event_position')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Drop index and column
  await db.schema.dropIndex('idx_event_outbox_position').execute();
  await db.schema.alterTable('event_outbox').dropColumn('event_position').execute();
}
