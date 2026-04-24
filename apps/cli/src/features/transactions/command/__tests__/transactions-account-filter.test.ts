import type { Account } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { ok } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  buildAccountPathSegment,
  buildTransactionsAccountFilters,
  resolveTransactionsAccountFilter,
} from '../transactions-account-filter.js';

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? 1,
    profileId: overrides.profileId ?? 1,
    name: overrides.name ?? 'wallet-main',
    parentAccountId: overrides.parentAccountId,
    accountType: overrides.accountType ?? 'blockchain',
    platformKey: overrides.platformKey ?? 'bitcoin',
    identifier: overrides.identifier ?? 'bc1-root',
    accountFingerprint:
      overrides.accountFingerprint ?? '1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    providerName: overrides.providerName,
    credentials: overrides.credentials,
    lastCursor: overrides.lastCursor,
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt,
  };
}

describe('transactions account filter', () => {
  it('resolves a selected account to that account plus all descendants', async () => {
    const root = createAccount({ id: 10, name: 'wallet-main', identifier: 'bc1-root' });
    const child = createAccount({
      id: 11,
      name: undefined,
      parentAccountId: root.id,
      identifier: 'bc1-child',
      accountFingerprint: '1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    const grandchild = createAccount({
      id: 12,
      name: undefined,
      parentAccountId: child.id,
      identifier: 'bc1-grandchild',
      accountFingerprint: '1ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    });

    const database = {
      accounts: {
        findAll: vi.fn().mockImplementation(async (filters?: { parentAccountId?: number | undefined }) => {
          if (filters?.parentAccountId === root.id) {
            return ok([child]);
          }

          if (filters?.parentAccountId === child.id) {
            return ok([grandchild]);
          }

          if (filters?.parentAccountId === grandchild.id) {
            return ok([]);
          }

          return ok([]);
        }),
        findByFingerprintRef: vi.fn(),
        findById: vi.fn(),
        findByIdentifier: vi.fn(),
        findByIdentity: vi.fn(),
        findByName: vi.fn().mockResolvedValue(ok(root)),
        update: vi.fn(),
        create: vi.fn(),
      },
    } as unknown as DataSession;

    const result = await resolveTransactionsAccountFilter(database, 1, 'wallet-main');

    expect(result.isErr()).toBe(false);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      accountIds: [10, 11, 12],
      selector: {
        account: root,
        kind: 'name',
        value: 'wallet-main',
      },
    });
    expect(buildTransactionsAccountFilters(result.value)).toEqual({ account: 'wallet-main' });
    expect(buildAccountPathSegment(result.value)).toBe('wallet-main');
  });

  it('returns undefined when no account filter was provided', async () => {
    const findByName = vi.fn();
    const database = {
      accounts: {
        findAll: vi.fn(),
        findByFingerprintRef: vi.fn(),
        findById: vi.fn(),
        findByIdentifier: vi.fn(),
        findByIdentity: vi.fn(),
        findByName,
        update: vi.fn(),
        create: vi.fn(),
      },
    } as unknown as DataSession;

    const result = await resolveTransactionsAccountFilter(database, 1, undefined);

    expect(result).toEqual(ok(undefined));
    expect(findByName).not.toHaveBeenCalled();
  });
});
