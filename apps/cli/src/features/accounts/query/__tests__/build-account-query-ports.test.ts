import { err, ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuildBalancesFreshnessPorts, mockCheckFreshness } = vi.hoisted(() => ({
  mockBuildBalancesFreshnessPorts: vi.fn(),
  mockCheckFreshness: vi.fn(),
}));

vi.mock('@exitbook/data/balances', () => ({
  buildBalancesFreshnessPorts: mockBuildBalancesFreshnessPorts,
}));

import { buildAccountQueryPorts } from '../build-account-query-ports.js';

function createMockDatabase() {
  return {
    users: {
      findOrCreateDefault: vi.fn().mockResolvedValue(ok({ id: 1 })),
    },
    accounts: {
      findAll: vi.fn().mockResolvedValue(ok([])),
      findByIdOptional: vi.fn().mockResolvedValue(ok(undefined)),
    },
    importSessions: {
      countByAccount: vi.fn().mockResolvedValue(ok(new Map())),
      findAll: vi.fn().mockResolvedValue(ok([])),
    },
    balanceSnapshots: {
      findSnapshots: vi.fn().mockResolvedValue(
        ok([
          {
            scopeAccountId: 1,
            verificationStatus: 'match',
            matchCount: 1,
            mismatchCount: 0,
            warningCount: 0,
          },
        ])
      ),
    },
  };
}

describe('buildAccountQueryPorts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildBalancesFreshnessPorts.mockReturnValue({
      checkFreshness: mockCheckFreshness,
    });
    mockCheckFreshness.mockResolvedValue(ok({ status: 'fresh', reason: undefined }));
  });

  it('adapts database ports and converts snapshot arrays into a scope-id map', async () => {
    const db = createMockDatabase();
    const ports = buildAccountQueryPorts(db as never);

    expect(mockBuildBalancesFreshnessPorts).toHaveBeenCalledWith(db);

    await ports.findOrCreateDefaultUser();
    await ports.findAccountById(1);
    await ports.findAccounts({ sourceName: 'kraken' });
    await ports.countSessionsByAccount([1, 2]);
    await ports.findSessions({ accountIds: [1, 2] });

    const snapshotsResult = await ports.findBalanceSnapshots([1]);
    expect(snapshotsResult.isOk()).toBe(true);
    if (!snapshotsResult.isOk()) {
      return;
    }

    expect(db.users.findOrCreateDefault).toHaveBeenCalledOnce();
    expect(db.accounts.findByIdOptional).toHaveBeenCalledWith(1);
    expect(db.accounts.findAll).toHaveBeenCalledWith({ sourceName: 'kraken' });
    expect(db.importSessions.countByAccount).toHaveBeenCalledWith([1, 2]);
    expect(db.importSessions.findAll).toHaveBeenCalledWith({ accountIds: [1, 2] });
    expect(db.balanceSnapshots.findSnapshots).toHaveBeenCalledWith([1]);
    expect(snapshotsResult.value.get(1)).toMatchObject({
      scopeAccountId: 1,
      verificationStatus: 'match',
    });

    await ports.checkBalanceFreshness(1);
    expect(mockCheckFreshness).toHaveBeenCalledWith(1);
  });

  it('propagates snapshot lookup failures unchanged', async () => {
    const db = createMockDatabase();
    const snapshotError = new Error('snapshot query failed');
    db.balanceSnapshots.findSnapshots.mockResolvedValue(err(snapshotError));

    const ports = buildAccountQueryPorts(db as never);
    const result = await ports.findBalanceSnapshots([7]);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      return;
    }

    expect(result.error).toBe(snapshotError);
  });
});
