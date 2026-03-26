import type { ILinksReset } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

import { buildProfileProjectionScopeKey } from './profile-scope-key.js';

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
          const profileIds = new Set<number>();
          if (accountIds) {
            for (const accountId of accountIds) {
              const account = yield* await tx.accounts.findById(accountId);
              if (account?.profileId !== undefined) {
                profileIds.add(account.profileId);
              }
            }
          } else {
            const accounts = yield* await tx.accounts.findAll();
            for (const account of accounts) {
              if (account.profileId !== undefined) {
                profileIds.add(account.profileId);
              }
            }
          }

          const links = yield* await (accountIds
            ? tx.transactionLinks.deleteByAccountIds(accountIds)
            : tx.transactionLinks.deleteAll());

          yield* await tx.projectionState.markStale('links', 'reset');
          for (const profileId of profileIds) {
            yield* await tx.projectionState.markStale('links', 'reset', buildProfileProjectionScopeKey(profileId));
          }

          return { links };
        })
      );
    },
  };
}
