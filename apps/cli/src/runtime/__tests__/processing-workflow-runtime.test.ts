import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateCliAssetReviewProjectionRuntime, mockRebuild } = vi.hoisted(() => ({
  mockCreateCliAssetReviewProjectionRuntime: vi.fn(),
  mockRebuild: vi.fn(),
}));

vi.mock('../asset-review-projection-runtime.js', () => ({
  createCliAssetReviewProjectionRuntime: mockCreateCliAssetReviewProjectionRuntime,
}));

import { rebuildCliAssetReviewProjectionsForAccounts } from '../processing-workflow-runtime.js';

describe('rebuildCliAssetReviewProjectionsForAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRebuild.mockResolvedValue(ok(undefined));
    mockCreateCliAssetReviewProjectionRuntime.mockImplementation((_database, _dataDir, _profile) =>
      ok({
        rebuild: mockRebuild,
      })
    );
  });

  it('rebuilds only the profiles that own the processed accounts', async () => {
    const database = {
      accounts: {
        getById: vi.fn().mockImplementation(async (accountId: number) => {
          if (accountId === 1) {
            return ok({ id: 1, profileId: 10 });
          }

          if (accountId === 2) {
            return ok({ id: 2, profileId: 10 });
          }

          if (accountId === 3) {
            return ok({ id: 3, profileId: 20 });
          }

          return ok(undefined);
        }),
      },
      profiles: {
        list: vi.fn().mockResolvedValue(
          ok([
            { id: 10, profileKey: 'default' },
            { id: 20, profileKey: 'business' },
            { id: 30, profileKey: 'archived' },
          ])
        ),
      },
    };

    assertOk(await rebuildCliAssetReviewProjectionsForAccounts(database as never, '/tmp/exitbook', [1, 2, 3]));

    expect(mockCreateCliAssetReviewProjectionRuntime).toHaveBeenCalledTimes(2);
    expect(mockCreateCliAssetReviewProjectionRuntime).toHaveBeenNthCalledWith(1, database, '/tmp/exitbook', {
      profileId: 10,
      profileKey: 'default',
    });
    expect(mockCreateCliAssetReviewProjectionRuntime).toHaveBeenNthCalledWith(2, database, '/tmp/exitbook', {
      profileId: 20,
      profileKey: 'business',
    });
    expect(mockRebuild).toHaveBeenCalledTimes(2);
  });
});
