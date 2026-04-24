import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFormatAccountSelectorLabel, mockResolveRequiredOwnedAccountSelector } = vi.hoisted(() => ({
  mockFormatAccountSelectorLabel: vi.fn(),
  mockResolveRequiredOwnedAccountSelector: vi.fn(),
}));

vi.mock('../../account-selector.js', () => ({
  formatAccountSelectorLabel: mockFormatAccountSelectorLabel,
  resolveRequiredOwnedAccountSelector: mockResolveRequiredOwnedAccountSelector,
}));

import { prepareAccountRemoval, runAccountRemoval } from '../run-accounts-remove.js';

describe('run-accounts-remove helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFormatAccountSelectorLabel.mockReturnValue('kraken-main');
  });

  it('builds removal preparation from the selected hierarchy and preview counts', async () => {
    const scope = {
      accountRemovalService: {
        preview: vi.fn().mockResolvedValue(
          ok({
            accountIds: [4, 5],
            deleted: {
              assetReview: { assets: 2 },
              balances: { assetRows: 5, scopes: 3 },
              costBasisSnapshots: { snapshots: 7 },
              links: { links: 11 },
              processedTransactions: { ledgerSourceActivities: 3, transactions: 13 },
              purge: {
                accounts: 17,
                rawData: 19,
                sessions: 23,
              },
            },
          })
        ),
      },
      accountService: {
        collectHierarchy: vi.fn().mockResolvedValue(ok([{ id: 4 }, { id: 5 }])),
      },
      profile: {
        id: 9,
      },
    };

    mockResolveRequiredOwnedAccountSelector.mockResolvedValue(
      ok({
        account: {
          id: 4,
          name: 'kraken-main',
        },
      })
    );

    const result = await prepareAccountRemoval(scope as never, 'kraken-main');

    expect(mockResolveRequiredOwnedAccountSelector).toHaveBeenCalledWith(
      scope.accountService,
      9,
      'kraken-main',
      'Account removal requires an account selector'
    );
    expect(scope.accountService.collectHierarchy).toHaveBeenCalledWith(9, 4);
    expect(scope.accountRemovalService.preview).toHaveBeenCalledWith([4, 5]);
    expect(assertOk(result)).toEqual({
      accountLabel: 'kraken-main',
      accountIds: [4, 5],
      preview: {
        transactions: 13,
        ledgerSourceActivities: 3,
        links: 11,
        assetReviewStates: 2,
        balanceSnapshots: 3,
        balanceSnapshotAssets: 5,
        costBasisSnapshots: 7,
        accounts: 17,
        sessions: 23,
        rawData: 19,
      },
    });
  });

  it('propagates selector failures without attempting hierarchy or preview work', async () => {
    const scope = {
      accountRemovalService: {
        preview: vi.fn(),
      },
      accountService: {
        collectHierarchy: vi.fn(),
      },
      profile: {
        id: 9,
      },
    };

    mockResolveRequiredOwnedAccountSelector.mockResolvedValue(err(new Error('selector not found')));

    const result = await prepareAccountRemoval(scope as never, 'missing');

    expect(assertErr(result).message).toBe('selector not found');
    expect(scope.accountService.collectHierarchy).not.toHaveBeenCalled();
    expect(scope.accountRemovalService.preview).not.toHaveBeenCalled();
  });

  it('delegates account deletion to the removal service', async () => {
    const scope = {
      accountRemovalService: {
        execute: vi.fn().mockResolvedValue(ok({ deleted: { accounts: 2 } })),
      },
    };

    const result = await runAccountRemoval(scope as never, [5, 4]);

    expect(scope.accountRemovalService.execute).toHaveBeenCalledWith([5, 4]);
    expect(assertOk(result)).toEqual({ deleted: { accounts: 2 } });
  });
});
