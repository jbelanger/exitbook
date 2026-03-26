import { resultDoAsync, type Result } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

export function buildProfileProjectionScopeKey(profileId: number): string {
  return `profile:${profileId}`;
}

export async function resolveAffectedProfileIds(
  db: DataSession,
  accountIds?: number[]  
): Promise<Result<number[], Error>> {
  return resultDoAsync(async function* () {
    const profileIds = new Set<number>();

    if (accountIds) {
      for (const accountId of accountIds) {
        const account = yield* await db.accounts.findById(accountId);
        if (account?.profileId !== undefined) {
          profileIds.add(account.profileId);
        }
      }
    } else {
      const accounts = yield* await db.accounts.findAll();
      for (const account of accounts) {
        if (account.profileId !== undefined) {
          profileIds.add(account.profileId);
        }
      }
    }

    return [...profileIds];
  });
}
