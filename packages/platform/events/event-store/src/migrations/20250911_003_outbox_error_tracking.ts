import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add last_error column for tracking error messages
  await db.schema.alterTable('event_outbox').addColumn('last_error', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Drop the last_error column
  await db.schema.alterTable('event_outbox').dropColumn('last_error').execute();
}
