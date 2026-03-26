import type { ILinksReset } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

import { buildProfileProjectionScopeKey, resolveAffectedProfileIds } from './profile-scope-key.js';

/**
 * Bridges DataSession to accounting's ILinksReset port.
 *
 * Owns only transaction_links.
 */
export function buildLinksResetPorts(db: DataSession): ILinksReset {
  return {
    async countResetImpact(accountIds) {
      return resultDoAsync(async function* () {
        const links = yield* await (accountIds
          ? db.transactionLinks.count({ accountIds })
          : db.transactionLinks.count());

        return { links };
      });
    },

    async reset(accountIds) {
      return db.executeInTransaction(async (tx) =>
        resultDoAsync(async function* () {
          const profileIds = yield* await resolveAffectedProfileIds(tx, accountIds);

          const links = yield* await (accountIds
            ? tx.transactionLinks.deleteByAccountIds(accountIds)
            : tx.transactionLinks.deleteAll());

          for (const profileId of profileIds) {
            yield* await tx.projectionState.markStale('links', 'reset', buildProfileProjectionScopeKey(profileId));
          }

          return { links };
        })
      );
    },
  };
}
