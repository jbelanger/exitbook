import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add unique constraint on event_id to prevent duplicate outbox entries
  await db.schema
    .createIndex('ux_outbox_event_id')
    .unique()
    .on('event_outbox')
    .column('event_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Drop the unique index
  await db.schema.dropIndex('ux_outbox_event_id').execute();
}
