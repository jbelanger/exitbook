import type { DataSession } from '@exitbook/data/session';
import { resultDoAsync, type Result } from '@exitbook/foundation';

export async function loadTrackedTransactionIdentifiers(
  database: DataSession,
  profileId: number
): Promise<Result<Set<string>, Error>> {
  return resultDoAsync(async function* () {
    const accounts = yield* await database.accounts.findAll({ profileId });
    return new Set(accounts.map((account) => account.identifier));
  });
}
