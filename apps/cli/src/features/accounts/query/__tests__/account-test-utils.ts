import type { Account, AccountType, BalanceSnapshot, ImportSession, ProjectionStatus } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';
import { ok } from '@exitbook/foundation';
import { vi } from 'vitest';

import type { AccountQueryPorts } from '../account-query-ports.js';

export function createMockAccount(
  options?: Partial<Account> & {
    accountType?: AccountType | undefined;
    id?: number | undefined;
    identifier?: string | undefined;
    platformKey?: string | undefined;
    profileId?: number | undefined;
  }
): Account {
  return {
    id: options?.id ?? 1,
    profileId: options?.profileId ?? 1,
    parentAccountId: options?.parentAccountId,
    accountType: options?.accountType ?? 'blockchain',
    platformKey: options?.platformKey ?? 'bitcoin',
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
  platformKey?: string | undefined;
  profileId?: number | undefined;
}

type AccountFindAll = (filters?: AccountFindAllFilters) => Promise<Result<Account[], Error>>;
type AccountFindById = (accountId: number) => Promise<Result<Account | undefined, Error>>;
type CountByAccount = (accountIds: number[]) => Promise<Result<Map<number, number>, Error>>;
type SessionFindAll = (filters?: { accountIds?: number[] }) => Promise<Result<ImportSession[], Error>>;
type SnapshotFindMany = (scopeAccountIds: number[]) => Promise<Result<Map<number, BalanceSnapshot>, Error>>;
type CheckBalanceFreshness = (
  scopeAccountId: number
) => Promise<Result<{ reason?: string | undefined; status: ProjectionStatus }, Error>>;

export function createMockPorts() {
  const findAccounts = vi.fn<AccountFindAll>().mockResolvedValue(ok([]));
  const findAccountById = vi.fn<AccountFindById>();
  const countSessionsByAccount = vi.fn<CountByAccount>().mockImplementation((accountIds: number[]) => {
    return Promise.resolve(ok(new Map(accountIds.map((id) => [id, 0]))));
  });
  const findSessions = vi.fn<SessionFindAll>().mockResolvedValue(ok([]));
  const findBalanceSnapshots = vi.fn<SnapshotFindMany>().mockResolvedValue(ok(new Map()));
  const checkBalanceFreshness = vi
    .fn<CheckBalanceFreshness>()
    .mockResolvedValue(ok({ status: 'fresh', reason: undefined }));

  const ports: AccountQueryPorts = {
    findAccounts,
    findAccountById,
    countSessionsByAccount,
    findSessions,
    findBalanceSnapshots,
    checkBalanceFreshness,
  };

  return {
    ports,
    findAccounts,
    findAccountById,
    countSessionsByAccount,
    findSessions,
    findBalanceSnapshots,
    checkBalanceFreshness,
  };
}
