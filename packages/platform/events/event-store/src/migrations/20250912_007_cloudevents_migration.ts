import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add cloudevent column
  await db.schema
    .alterTable('event_outbox')
    .addColumn('cloudevent', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .execute();

  // Remove old columns (clean cut migration)
  await db.schema.alterTable('event_outbox').dropColumn('payload').dropColumn('metadata').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Restore old columns
  await db.schema
    .alterTable('event_outbox')
    .addColumn('payload', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .execute();

  // Remove cloudevent column
  await db.schema.alterTable('event_outbox').dropColumn('cloudevent').execute();
}
