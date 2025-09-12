import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Create event_store table
  await db.schema
    .createTable('event_store')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('stream_name', 'text', (col) => col.notNull())
    .addColumn('category', 'text', (col) => col.notNull())
    .addColumn('event_id', 'uuid', (col) => col.notNull().unique())
    .addColumn('event_type', 'text', (col) => col.notNull())
    .addColumn('event_schema_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('event_data', 'jsonb', (col) => col.notNull())
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .addColumn('stream_version', 'integer', (col) => col.notNull())
    .addColumn('global_position', 'bigserial', (col) => col.notNull().unique())
    .addColumn('occurred_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Create unique constraint for stream ordering
  await db.schema
    .createIndex('ux_event_stream_version')
    .on('event_store')
    .columns(['stream_name', 'stream_version'])
    .unique()
    .execute();

  // Create indexes for performance
  await db.schema
    .createIndex('ix_event_store_category_position')
    .on('event_store')
    .columns(['category', 'global_position'])
    .execute();

  await db.schema
    .createIndex('ix_event_store_stream_name')
    .on('event_store')
    .column('stream_name')
    .execute();

  // Create event_idempotency table
  await db.schema
    .createTable('event_idempotency')
    .addColumn('idempotency_key', 'text', (col) => col.primaryKey())
    .addColumn('event_id', 'uuid', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .execute();

  // Create event_outbox table with all final columns
  await db.schema
    .createTable('event_outbox')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('event_id', 'uuid', (col) => col.notNull())
    .addColumn('stream_name', 'text', (col) => col.notNull())
    .addColumn('category', 'text', (col) => col.notNull())
    .addColumn('event_type', 'text', (col) => col.notNull())
    .addColumn('event_data', 'jsonb', (col) => col.notNull())
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('PENDING'))
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('next_attempt_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('processed_at', 'timestamptz')
    .addColumn('last_error', 'text')
    .addColumn('event_position', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('event_schema_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('occurred_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Create indexes for event_outbox
  await db.schema
    .createIndex('idx_event_outbox_sched')
    .on('event_outbox')
    .columns(['status', 'next_attempt_at'])
    .execute();

  await db.schema
    .createIndex('idx_event_outbox_status')
    .on('event_outbox')
    .column('status')
    .execute();

  await db.schema
    .createIndex('idx_event_outbox_position')
    .on('event_outbox')
    .column('event_position')
    .execute();

  // Create unique constraint on event_id to prevent duplicate outbox entries
  await db.schema
    .createIndex('ux_outbox_event_id')
    .unique()
    .on('event_outbox')
    .column('event_id')
    .execute();

  // Create event_snapshots table
  await db.schema
    .createTable('event_snapshots')
    .addColumn('stream_name', 'text', (col) => col.notNull())
    .addColumn('version', 'integer', (col) => col.notNull())
    .addColumn('schema_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('data', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Create primary key for snapshots
  await db.schema
    .alterTable('event_snapshots')
    .addPrimaryKeyConstraint('pk_event_snapshots', ['stream_name', 'version'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('event_snapshots').execute();
  await db.schema.dropTable('event_outbox').execute();
  await db.schema.dropTable('event_idempotency').execute();
  await db.schema.dropTable('event_store').execute();
}
