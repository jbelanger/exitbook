/* eslint-disable unicorn/no-null -- acceptable for db */
export { seedAssetMovementFingerprint, seedFeeMovementFingerprint, seedTxFingerprint } from '@exitbook/core/test-utils';

import type { KyselyDB } from '../../database.js';

export async function seedProfile(db: KyselyDB): Promise<void> {
  await db
    .insertInto('profiles')
    .values({ id: 1, profile_key: 'default', display_name: 'default', created_at: new Date().toISOString() })
    .execute();
}

export async function seedAccount(
  db: KyselyDB,
  accountId: number,
  type: string,
  platformKey: string,
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
      platform_key: platformKey,
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
