import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  abortAccountsRefresh,
  awaitAccountsRefreshStream,
  loadAccountsRefreshTargets,
  runAccountsRefreshAll,
  runAccountsRefreshSingle,
  startAccountsRefreshStream,
} from '../run-accounts-refresh.js';

function createScope() {
  return {
    profile: {
      id: 7,
    },
    refreshRunner: {
      abort: vi.fn(),
      awaitStream: vi.fn().mockResolvedValue('completed'),
      loadAccountsForRefresh: vi.fn().mockResolvedValue(ok([{ accountId: 1, accountType: 'blockchain' }])),
      refreshAllScopes: vi.fn().mockResolvedValue(ok({ totals: { total: 1 } })),
      refreshSingleScope: vi.fn().mockResolvedValue(ok({ accountId: 1, status: 'match' })),
      startStream: vi.fn(),
    },
  };
}

describe('run-accounts-refresh helpers', () => {
  it('delegates single-account refreshes to the scoped refresh runner', async () => {
    const scope = createScope();

    const result = await runAccountsRefreshSingle(scope as never, { accountId: 42 });

    expect(scope.refreshRunner.refreshSingleScope).toHaveBeenCalledWith({
      accountId: 42,
      profileId: 7,
    });
    expect(assertOk(result)).toEqual({ accountId: 1, status: 'match' });
  });

  it('delegates full-profile refreshes and target loading to the scoped refresh runner', async () => {
    const scope = createScope();

    const allResult = await runAccountsRefreshAll(scope as never);
    const targetsResult = await loadAccountsRefreshTargets(scope as never);

    expect(scope.refreshRunner.refreshAllScopes).toHaveBeenCalledWith(7);
    expect(scope.refreshRunner.loadAccountsForRefresh).toHaveBeenCalledWith(7);
    expect(assertOk(allResult)).toEqual({ totals: { total: 1 } });
    expect(assertOk(targetsResult)).toEqual([{ accountId: 1, accountType: 'blockchain' }]);
  });

  it('delegates stream lifecycle events to the scoped refresh runner', async () => {
    const scope = createScope();
    const relay = { send: vi.fn() };
    const accounts = [{ accountId: 1, accountType: 'blockchain' }];

    startAccountsRefreshStream(scope as never, accounts as never, relay as never);

    expect(scope.refreshRunner.startStream).toHaveBeenCalledWith(accounts, relay);
    expect(await awaitAccountsRefreshStream(scope as never)).toBe('completed');

    abortAccountsRefresh(scope as never);

    expect(scope.refreshRunner.abort).toHaveBeenCalledOnce();
  });
});
