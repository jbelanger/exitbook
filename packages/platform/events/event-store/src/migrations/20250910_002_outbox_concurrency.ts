import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add new columns for outbox concurrency and retry handling
  await db.schema
    .alterTable('event_outbox')
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('next_attempt_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('processed_at', 'timestamptz')
    .execute();

  // Add PROCESSING status to existing status column
  // Note: This is safe because we're adding a new status value

  // Create index for efficient worker batch claiming
  await db.schema
    .createIndex('idx_event_outbox_sched')
    .on('event_outbox')
    .columns(['status', 'next_attempt_at'])
    .execute();

  // Create index for status filtering (if not exists)
  await db.schema
    .createIndex('idx_event_outbox_status')
    .on('event_outbox')
    .column('status')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Drop indexes
  await db.schema.dropIndex('idx_event_outbox_sched').execute();
  await db.schema.dropIndex('idx_event_outbox_status').execute();

  // Drop columns
  await db.schema
    .alterTable('event_outbox')
    .dropColumn('attempts')
    .dropColumn('next_attempt_at')
    .dropColumn('processed_at')
    .execute();
}
