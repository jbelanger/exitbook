import { err, ok } from '@exitbook/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@exitbook/logger', () => ({
  getLogger: () => mockLogger,
}));

import { AccountQuery } from '../account-query.js';

import { createMockAccount, createMockPorts, createMockSession } from './account-test-utils.js';

interface AccountFindAllFilters {
  parentAccountId?: number | undefined;
}

describe('AccountQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists accounts with parent/child hierarchy and aggregated session counts', async () => {
    const ctx = createMockPorts();
    const query = new AccountQuery(ctx.ports);

    const parent = createMockAccount({ id: 1, identifier: 'xpub-parent' });
    const child = createMockAccount({ id: 2, parentAccountId: 1, identifier: 'bc1qchild' });
    const standalone = createMockAccount({ id: 3, identifier: 'bc1qstandalone' });

    vi.mocked(ctx.accounts.findAll).mockImplementation((filters: AccountFindAllFilters | undefined) => {
      if (filters?.parentAccountId === 1) return Promise.resolve(ok([child]));
      if (filters?.parentAccountId === 3) return Promise.resolve(ok([]));
      return Promise.resolve(ok([parent, child, standalone]));
    });
    vi.mocked(ctx.importSessions.countByAccount).mockResolvedValue(
      ok(
        new Map([
          [1, 2],
          [2, 3],
          [3, 4],
        ])
      )
    );

    const result = await query.list();

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();

    expect(value.accounts).toHaveLength(2);
    expect(value.count).toBe(3);
    expect(value.sessions).toBeUndefined();

    const parentView = value.accounts.find((account) => account.id === 1);
    const standaloneView = value.accounts.find((account) => account.id === 3);

    expect(parentView).toMatchObject({
      id: 1,
      sessionCount: 5,
    });
    expect(parentView?.childAccounts).toHaveLength(1);
    expect(parentView?.childAccounts?.[0]).toMatchObject({
      id: 2,
      sessionCount: 3,
    });
    expect(standaloneView).toMatchObject({
      id: 3,
      sessionCount: 4,
    });
    expect(ctx.importSessions.findAll).not.toHaveBeenCalled();
  });

  it('lists account sessions when showSessions is true', async () => {
    const ctx = createMockPorts();
    const query = new AccountQuery(ctx.ports);

    const a1 = createMockAccount({ id: 1 });
    const a2 = createMockAccount({ id: 2, identifier: 'bc1qsecond' });

    vi.mocked(ctx.accounts.findAll).mockImplementation((filters: AccountFindAllFilters | undefined) => {
      if (filters?.parentAccountId === 1 || filters?.parentAccountId === 2) return Promise.resolve(ok([]));
      return Promise.resolve(ok([a1, a2]));
    });

    vi.mocked(ctx.importSessions.findAll).mockResolvedValue(
      ok([
        createMockSession({ id: 10, accountId: 1 }),
        createMockSession({ id: 11, accountId: 1 }),
        createMockSession({ id: 12, accountId: 2 }),
      ])
    );

    const result = await query.list({ showSessions: true });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();

    expect(ctx.importSessions.countByAccount).not.toHaveBeenCalled();
    expect(ctx.importSessions.findAll).toHaveBeenCalledWith({ accountIds: [1, 2] });
    expect(value.accounts).toHaveLength(2);
    expect(value.count).toBe(2);
    expect(value.accounts.find((account) => account.id === 1)?.sessionCount).toBe(2);
    expect(value.accounts.find((account) => account.id === 2)?.sessionCount).toBe(1);
    expect(value.sessions?.get(1)).toHaveLength(2);
    expect(value.sessions?.get(2)).toHaveLength(1);
  });

  it('returns an error when accountId does not belong to the default user', async () => {
    const ctx = createMockPorts();
    const query = new AccountQuery(ctx.ports);

    vi.mocked(ctx.accounts.findById).mockResolvedValue(ok(createMockAccount({ id: 7, userId: 999 })));

    const result = await query.list({ accountId: 7 });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('does not belong to the default user');
  });

  it('lists a single child account directly when queried by accountId', async () => {
    const ctx = createMockPorts();
    const query = new AccountQuery(ctx.ports);

    const child = createMockAccount({ id: 8, parentAccountId: 2, identifier: 'bc1qchild-single' });
    vi.mocked(ctx.accounts.findById).mockResolvedValue(ok(child));
    vi.mocked(ctx.importSessions.countByAccount).mockResolvedValue(ok(new Map([[8, 7]])));

    const result = await query.list({ accountId: 8 });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();

    expect(value.accounts).toHaveLength(1);
    expect(value.count).toBe(1);
    expect(value.accounts[0]).toMatchObject({
      id: 8,
      sessionCount: 7,
      childAccounts: undefined,
    });
    expect(ctx.accounts.findAll).not.toHaveBeenCalled();
  });

  it('finds an account by id and aggregates child session counts', async () => {
    const ctx = createMockPorts();
    const query = new AccountQuery(ctx.ports);

    const parent = createMockAccount({ id: 1, accountType: 'exchange-api', identifier: 'apikey-secret' });
    const child = createMockAccount({ id: 2, parentAccountId: 1, identifier: 'bc1qchild' });

    vi.mocked(ctx.accounts.findById).mockResolvedValue(ok(parent));
    vi.mocked(ctx.accounts.findAll).mockResolvedValue(ok([child]));
    vi.mocked(ctx.importSessions.countByAccount).mockImplementation((accountIds: number[]) => {
      if (accountIds.length === 1 && accountIds[0] === 1) return Promise.resolve(ok(new Map([[1, 2]])));
      if (accountIds.length === 1 && accountIds[0] === 2) return Promise.resolve(ok(new Map([[2, 4]])));
      return Promise.resolve(ok(new Map()));
    });

    const result = await query.findById(1);

    expect(result.isOk()).toBe(true);
    const account = result._unsafeUnwrap();

    expect(account).toMatchObject({
      id: 1,
      identifier: 'apikey-s***',
      sessionCount: 6,
    });
    expect(account?.childAccounts).toHaveLength(1);
    expect(account?.childAccounts?.[0]).toMatchObject({
      id: 2,
      sessionCount: 4,
    });
  });

  it('returns undefined when findById resolves an account outside default user tenancy', async () => {
    const ctx = createMockPorts();
    const query = new AccountQuery(ctx.ports);

    vi.mocked(ctx.accounts.findById).mockResolvedValue(ok(createMockAccount({ id: 9, userId: 42 })));

    const result = await query.findById(9);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(ctx.importSessions.countByAccount).not.toHaveBeenCalled();
  });

  it('wraps and logs unexpected list errors', async () => {
    const ctx = createMockPorts();
    const query = new AccountQuery(ctx.ports);

    vi.mocked(ctx.accounts.findAll).mockRejectedValue(new Error('database unavailable'));

    const result = await query.list();

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('Failed to query accounts: database unavailable');
    const firstCall = mockLogger.error.mock.calls[0];
    expect(firstCall?.[1]).toBe('Failed to query accounts');
  });

  it('propagates repository errors from findById', async () => {
    const ctx = createMockPorts();
    const query = new AccountQuery(ctx.ports);

    vi.mocked(ctx.accounts.findById).mockResolvedValue(err(new Error('Account 22 not found')));

    const result = await query.findById(22);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('Account 22 not found');
  });
});
