import type { Account, AccountType, BalanceSnapshot, ImportSession } from '@exitbook/core';
import type { Result } from '@exitbook/core';
import { ok } from '@exitbook/core';
import { vi } from 'vitest';

import type { AccountQueryPorts } from '../ports/account-query-ports.js';

export function createMockAccount(
  options?: Partial<Account> & {
    accountType?: AccountType | undefined;
    id?: number | undefined;
    identifier?: string | undefined;
    sourceName?: string | undefined;
    userId?: number | undefined;
  }
): Account {
  return {
    id: options?.id ?? 1,
    userId: options?.userId ?? 1,
    parentAccountId: options?.parentAccountId,
    accountType: options?.accountType ?? 'blockchain',
    sourceName: options?.sourceName ?? 'bitcoin',
    identifier: options?.identifier ?? 'bc1qtest',
    providerName: options?.providerName,
    credentials: options?.credentials,
    lastCursor: options?.lastCursor,
    metadata: options?.metadata,
    createdAt: options?.createdAt ?? new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: options?.updatedAt,
  };
}

export function createMockSession(overrides?: Partial<ImportSession>): ImportSession {
  return {
    id: overrides?.id ?? 1,
    accountId: overrides?.accountId ?? 1,
    status: overrides?.status ?? 'completed',
    startedAt: overrides?.startedAt ?? new Date('2025-01-01T00:00:00.000Z'),
    completedAt: overrides?.completedAt ?? new Date('2025-01-01T00:05:00.000Z'),
    createdAt: overrides?.createdAt ?? new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: overrides?.updatedAt,
    durationMs: overrides?.durationMs,
    transactionsImported: overrides?.transactionsImported ?? 5,
    transactionsSkipped: overrides?.transactionsSkipped ?? 0,
    errorMessage: overrides?.errorMessage,
    errorDetails: overrides?.errorDetails,
  };
}

interface AccountFindAllFilters {
  accountType?: AccountType | undefined;
  parentAccountId?: number | undefined;
  sourceName?: string | undefined;
  userId?: number | undefined;
}

type AccountFindAll = (filters?: AccountFindAllFilters) => Promise<Result<Account[], Error>>;
type AccountFindById = (accountId: number) => Promise<Result<Account, Error>>;
type CountByAccount = (accountIds: number[]) => Promise<Result<Map<number, number>, Error>>;
type SessionFindAll = (filters?: { accountIds?: number[] }) => Promise<Result<ImportSession[], Error>>;
type SnapshotFindMany = (scopeAccountIds: number[]) => Promise<Result<Map<number, BalanceSnapshot>, Error>>;

export function createMockPorts() {
  const users = {
    findOrCreateDefault: vi.fn().mockResolvedValue(ok({ id: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') })),
  };

  const accounts = {
    findAll: vi.fn<AccountFindAll>().mockResolvedValue(ok([])),
    findById: vi.fn<AccountFindById>(),
  };

  const importSessions = {
    countByAccount: vi.fn<CountByAccount>().mockImplementation((accountIds: number[]) => {
      return Promise.resolve(ok(new Map(accountIds.map((id) => [id, 0]))));
    }),
    findAll: vi.fn<SessionFindAll>().mockResolvedValue(ok([])),
  };

  const balanceSnapshots = {
    findSnapshots: vi.fn<SnapshotFindMany>().mockResolvedValue(ok(new Map())),
  };

  const ports: AccountQueryPorts = {
    users,
    accounts,
    importSessions,
    balanceSnapshots,
  };

  return {
    ports,
    users,
    accounts,
    importSessions,
    balanceSnapshots,
  };
}
