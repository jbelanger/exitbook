/* eslint-disable unicorn/no-null -- acceptable for db */
import type { KyselyDB } from '../../database.js';

export async function seedUser(db: KyselyDB): Promise<void> {
  await db.insertInto('users').values({ id: 1, created_at: new Date().toISOString() }).execute();
}

export async function seedAccount(db: KyselyDB, accountId: number, type: string, source: string): Promise<void> {
  await db
    .insertInto('accounts')
    .values({
      id: accountId,
      user_id: 1,
      account_type: type,
      source_name: source,
      identifier: `identifier-${accountId}`,
      provider_name: null,
      parent_account_id: null,
      last_cursor: null,
      last_balance_check_at: null,
      verification_metadata: null,
      created_at: new Date().toISOString(),
      updated_at: null,
    })
    .execute();
}

export async function seedImportSession(db: KyselyDB, sessionId: number, accountId: number): Promise<void> {
  await db
    .insertInto('import_sessions')
    .values({
      id: sessionId,
      account_id: accountId,
      started_at: new Date().toISOString(),
      status: 'completed',
      transactions_imported: 0,
      transactions_skipped: 0,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .execute();
}
