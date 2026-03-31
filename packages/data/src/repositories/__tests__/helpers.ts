/* eslint-disable unicorn/no-null -- acceptable for db */
export { seedAssetMovementFingerprint, seedFeeMovementFingerprint, seedTxFingerprint } from '@exitbook/core/test-utils';

import { computeAccountFingerprint, type AccountType } from '@exitbook/core';
import { assertOk } from '@exitbook/foundation/test-utils';

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
  type: AccountType,
  platformKey: string,
  options?: {
    parentAccountId?: number | undefined;
    profileId?: number | undefined;
  }
): Promise<void> {
  const profileId = options?.profileId ?? 1;
  const identifier = `identifier-${accountId}`;
  const profile = await db.selectFrom('profiles').select('profile_key').where('id', '=', profileId).executeTakeFirst();
  if (!profile) {
    throw new Error(`Profile ${profileId} not found`);
  }

  const accountFingerprint = assertOk(
    computeAccountFingerprint({
      profileKey: profile.profile_key,
      accountType: type,
      platformKey,
      identifier,
    })
  );

  await db
    .insertInto('accounts')
    .values({
      id: accountId,
      profile_id: profileId,
      account_type: type,
      platform_key: platformKey,
      identifier,
      account_fingerprint: accountFingerprint,
      provider_name: null,
      parent_account_id: options?.parentAccountId ?? null,
      last_cursor: null,
      created_at: new Date().toISOString(),
      updated_at: null,
    })
    .execute();
}

export async function computeTestAccountFingerprint(
  db: KyselyDB,
  params: {
    accountType: AccountType;
    identifier: string;
    platformKey: string;
    profileId?: number | undefined;
  }
): Promise<string> {
  const profileId = params.profileId ?? 1;
  const profile = await db.selectFrom('profiles').select('profile_key').where('id', '=', profileId).executeTakeFirst();
  if (!profile) {
    throw new Error(`Profile ${profileId} not found`);
  }

  return assertOk(
    computeAccountFingerprint({
      profileKey: profile.profile_key,
      accountType: params.accountType,
      platformKey: params.platformKey,
      identifier: params.identifier,
    })
  );
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
