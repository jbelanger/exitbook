import { computeAccountFingerprint, type AccountType } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';

import type { KyselyDB } from '../database.js';

export interface AccountIdentityParams {
  accountType: AccountType;
  identifier: string;
  platformKey: string;
  profileId: number;
}

interface PersistedAccountIdentityRecord {
  accountType: string;
  accountFingerprint: string;
  accountId: number;
  identifier: string;
  platformKey: string;
  profileId: number;
  profileKey: string;
}

async function loadProfileKey(db: KyselyDB, profileId: number): Promise<Result<string, Error>> {
  const profile = await db.selectFrom('profiles').select('profile_key').where('id', '=', profileId).executeTakeFirst();

  if (!profile) {
    return err(new Error(`Profile ${profileId} not found`));
  }

  return ok(profile.profile_key);
}

export async function deriveCanonicalAccountFingerprint(
  db: KyselyDB,
  params: AccountIdentityParams
): Promise<Result<string, Error>> {
  const profileKeyResult = await loadProfileKey(db, params.profileId);
  if (profileKeyResult.isErr()) {
    return err(profileKeyResult.error);
  }

  return computeAccountFingerprint({
    profileKey: profileKeyResult.value,
    accountType: params.accountType,
    platformKey: params.platformKey,
    identifier: params.identifier,
  });
}

export function validatePersistedAccountFingerprint(record: PersistedAccountIdentityRecord): Result<string, Error> {
  const expectedFingerprintResult = computeAccountFingerprint({
    profileKey: record.profileKey,
    accountType: record.accountType,
    platformKey: record.platformKey,
    identifier: record.identifier,
  });
  if (expectedFingerprintResult.isErr()) {
    return err(expectedFingerprintResult.error);
  }

  if (record.accountFingerprint !== expectedFingerprintResult.value) {
    return err(
      new Error(
        `Account ${record.accountId} fingerprint drift detected: persisted ${record.accountFingerprint} does not match ` +
          `canonical ${expectedFingerprintResult.value}`
      )
    );
  }

  return ok(record.accountFingerprint);
}

export async function loadValidatedAccountFingerprint(db: KyselyDB, accountId: number): Promise<Result<string, Error>> {
  const account = await db
    .selectFrom('accounts')
    .innerJoin('profiles', 'profiles.id', 'accounts.profile_id')
    .select([
      'accounts.id',
      'accounts.account_type',
      'accounts.platform_key',
      'accounts.identifier',
      'accounts.profile_id',
      'accounts.account_fingerprint',
      'profiles.profile_key',
    ])
    .where('accounts.id', '=', accountId)
    .executeTakeFirst();

  if (!account) {
    return err(new Error(`Account ${accountId} not found`));
  }

  if (account.account_fingerprint.trim() === '') {
    return err(new Error(`Account ${accountId} is missing persisted account fingerprint`));
  }

  return validatePersistedAccountFingerprint({
    accountId: account.id,
    accountType: account.account_type,
    platformKey: account.platform_key,
    identifier: account.identifier,
    profileId: account.profile_id,
    accountFingerprint: account.account_fingerprint,
    profileKey: account.profile_key,
  });
}

export async function validateAccountFingerprintIntegrity(db: KyselyDB): Promise<Result<void, Error>> {
  const accounts = await db
    .selectFrom('accounts')
    .innerJoin('profiles', 'profiles.id', 'accounts.profile_id')
    .select([
      'accounts.id',
      'accounts.account_type',
      'accounts.platform_key',
      'accounts.identifier',
      'accounts.profile_id',
      'accounts.account_fingerprint',
      'profiles.profile_key',
    ])
    .execute();

  for (const account of accounts) {
    const validationResult = validatePersistedAccountFingerprint({
      accountId: account.id,
      accountType: account.account_type,
      platformKey: account.platform_key,
      identifier: account.identifier,
      profileId: account.profile_id,
      accountFingerprint: account.account_fingerprint,
      profileKey: account.profile_key,
    });
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }
  }

  return ok(undefined);
}
