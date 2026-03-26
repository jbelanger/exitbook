/* eslint-disable unicorn/no-null -- acceptable for db */
export { seedAssetMovementFingerprint, seedFeeMovementFingerprint, seedTxFingerprint } from '@exitbook/core/test-utils';

import type { KyselyDB } from '../../database.js';

export async function seedUser(db: KyselyDB): Promise<void> {
  await db
    .insertInto('profiles')
    .values({ id: 1, profile_key: 'default', name: 'default', created_at: new Date().toISOString() })
    .execute();
}

export async function seedAccount(
  db: KyselyDB,
  accountId: number,
  type: string,
  source: string,
  options?: {
    parentAccountId?: number | undefined;
    profileId?: number | undefined;
  }
): Promise<void> {
  await db
    .insertInto('accounts')
    .values({
      id: accountId,
      profile_id: options?.profileId ?? 1,
      account_type: type,
      platform_key: source,
      identifier: `identifier-${accountId}`,
      provider_name: null,
      parent_account_id: options?.parentAccountId ?? null,
      last_cursor: null,
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
