import { sql, type Kysely } from '@exitbook/sqlite';

export async function ensureLedgerResetPerformanceIndexes<Schema>(db: Kysely<Schema>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_accounting_posting_source_components_source_activity
    ON accounting_posting_source_components(source_activity_fingerprint)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_accounting_journal_relationships_source_posting_id
    ON accounting_journal_relationships(source_posting_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_accounting_journal_relationships_target_posting_id
    ON accounting_journal_relationships(target_posting_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_accounting_journal_relationships_source_posting_fingerprint
    ON accounting_journal_relationships(source_posting_fingerprint)
    WHERE source_posting_fingerprint IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_accounting_journal_relationships_target_posting_fingerprint
    ON accounting_journal_relationships(target_posting_fingerprint)
    WHERE target_posting_fingerprint IS NOT NULL
  `.execute(db);
}
