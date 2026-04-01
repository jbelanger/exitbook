import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../profile-removal-service.js', () => ({
  flattenProfileRemovePreview: (preview: {
    deleted: {
      assetReview: { assets: number };
      balances: { assetRows: number; scopes: number };
      costBasisSnapshots: { snapshots: number };
      links: { links: number };
      processedTransactions: { transactions: number };
      profiles: number;
      purge: { accounts: number; rawData: number; sessions: number };
    };
  }) => ({
    profiles: preview.deleted.profiles,
    accounts: preview.deleted.purge.accounts,
    rawData: preview.deleted.purge.rawData,
    sessions: preview.deleted.purge.sessions,
    transactions: preview.deleted.processedTransactions.transactions,
    links: preview.deleted.links.links,
    assetReviewStates: preview.deleted.assetReview.assets,
    balanceSnapshots: preview.deleted.balances.scopes,
    balanceSnapshotAssets: preview.deleted.balances.assetRows,
    costBasisSnapshots: preview.deleted.costBasisSnapshots.snapshots,
  }),
  ProfileRemovalService: class {
    async preview(accountIds: number[]) {
      return ok({
        accountIds,
        deleted: {
          profiles: 1,
          purge: { accounts: accountIds.length, rawData: 0, sessions: 0 },
          processedTransactions: { transactions: 0 },
          links: { links: 0 },
          assetReview: { assets: 0 },
          balances: { scopes: 0, assetRows: 0 },
          costBasisSnapshots: { snapshots: 0 },
        },
      });
    }
  },
}));

import { prepareProfileRemoval } from '../run-profiles-remove.js';

describe('prepareProfileRemoval', () => {
  it('orders child accounts before parents for profile deletion', async () => {
    const db = {
      accounts: {
        findAll: async () =>
          ok([
            {
              id: 10,
              profileId: 2,
              name: 'wallet-root',
              parentAccountId: undefined,
              accountType: 'blockchain',
              platformKey: 'bitcoin',
              identifier: 'xpub-parent',
              accountFingerprint: 'a'.repeat(64),
              providerName: undefined,
              credentials: undefined,
              lastCursor: undefined,
              metadata: undefined,
              createdAt: new Date('2026-03-27T00:00:00.000Z'),
              updatedAt: undefined,
            },
            {
              id: 12,
              profileId: 2,
              name: undefined,
              parentAccountId: 11,
              accountType: 'blockchain',
              platformKey: 'bitcoin',
              identifier: 'child-2',
              accountFingerprint: 'c'.repeat(64),
              providerName: undefined,
              credentials: undefined,
              lastCursor: undefined,
              metadata: undefined,
              createdAt: new Date('2026-03-27T00:00:00.000Z'),
              updatedAt: undefined,
            },
            {
              id: 11,
              profileId: 2,
              name: undefined,
              parentAccountId: 10,
              accountType: 'blockchain',
              platformKey: 'bitcoin',
              identifier: 'child-1',
              accountFingerprint: 'b'.repeat(64),
              providerName: undefined,
              credentials: undefined,
              lastCursor: undefined,
              metadata: undefined,
              createdAt: new Date('2026-03-27T00:00:00.000Z'),
              updatedAt: undefined,
            },
          ]),
      },
    } as unknown as Parameters<typeof prepareProfileRemoval>[0];

    const profileService = {
      findByKey: async () =>
        ok({
          id: 2,
          profileKey: 'business',
          displayName: 'Business / Family',
          createdAt: new Date('2026-03-27T00:00:00.000Z'),
        }),
    } as unknown as Parameters<typeof prepareProfileRemoval>[1];

    const preparation = assertOk(await prepareProfileRemoval(db, profileService, 'business'));

    expect(preparation.accountIds).toEqual([12, 11, 10]);
    expect(preparation.profile.profileKey).toBe('business');
    expect(preparation.preview.profiles).toBe(1);
    expect(preparation.preview.accounts).toBe(3);
  });
});
