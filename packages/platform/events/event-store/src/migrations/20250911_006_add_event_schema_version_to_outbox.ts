import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add event_schema_version column to event_outbox for topic versioning
  await db.schema
    .alterTable('event_outbox')
    .addColumn('event_schema_version', 'integer', (col) => col.notNull().defaultTo(1))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Drop the event_schema_version column
  await db.schema.alterTable('event_outbox').dropColumn('event_schema_version').execute();
}
