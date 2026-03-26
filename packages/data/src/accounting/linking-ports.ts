import type { ILinkingPersistence } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';
import { buildProfileProjectionScopeKey } from '../projections/profile-scope-key.js';

/**
 * Bridges DataSession repositories to accounting's ILinkingPersistence port.
 * Mirrors the pattern established by buildProcessingPorts and buildImportPorts.
 */
export function buildLinkingPorts(db: DataSession, profileId: number): ILinkingPersistence {
  const scopeKey = buildProfileProjectionScopeKey(profileId);

  return {
    loadTransactions: () => db.transactions.findAll({ profileId }),

    replaceLinks: (links) =>
      resultDoAsync(async function* () {
        const scopedAccounts = yield* await db.accounts.findAll({ profileId });
        const scopedAccountIds = scopedAccounts.map((account) => account.id);
        const previousCount = yield* await db.transactionLinks.count({ accountIds: scopedAccountIds });

        if (previousCount > 0) {
          yield* await db.transactionLinks.deleteByAccountIds(scopedAccountIds);
        }

        const savedCount = yield* await db.transactionLinks.createBatch(links);

        return { previousCount, savedCount };
      }),

    markLinksBuilding: () =>
      resultDoAsync(async function* () {
        yield* await db.projectionState.markBuilding('links', scopeKey);
        return undefined;
      }),

    markLinksFresh: () =>
      resultDoAsync(async function* () {
        // eslint-disable-next-line unicorn/no-null -- DB layer expects null for absent metadata
        yield* await db.projectionState.markFresh('links', null, scopeKey);
        return undefined;
      }),

    markLinksFailed: () =>
      resultDoAsync(async function* () {
        yield* await db.projectionState.markFailed('links', scopeKey);
        return undefined;
      }),

    withTransaction: (fn) => db.executeInTransaction((txDb) => fn(buildLinkingPorts(txDb, profileId))),
  };
}
