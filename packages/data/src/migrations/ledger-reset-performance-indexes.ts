import { sql, type Kysely } from '@exitbook/sqlite';

export async function ensureLedgerResetPerformanceIndexes<Schema>(db: Kysely<Schema>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_accounting_posting_source_components_source_activity
    ON accounting_posting_source_components(source_activity_fingerprint)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_accounting_journal_relationship_allocations_posting_id_reset
    ON accounting_journal_relationship_allocations(posting_id)
    WHERE posting_id IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_accounting_journal_relationship_allocations_posting_fingerprint_reset
    ON accounting_journal_relationship_allocations(posting_fingerprint)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_accounting_journal_relationship_allocations_activity_reset
    ON accounting_journal_relationship_allocations(source_activity_fingerprint)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_accounting_journal_relationship_allocations_relationship_reset
    ON accounting_journal_relationship_allocations(relationship_id)
  `.execute(db);
}
