import { computeAccountFingerprint, type Account } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { AccountLifecycleService } from '../account-lifecycle-service.js';

function isExchangeAccountType(accountType: Account['accountType']): boolean {
  return accountType === 'exchange-api' || accountType === 'exchange-csv';
}

function recomputeAccountFingerprint(
  account: Pick<Account, 'accountType' | 'identifier' | 'platformKey' | 'profileId'>
): string {
  return assertOk(
    computeAccountFingerprint({
      profileKey: `profile-${account.profileId}`,
      accountType: account.accountType,
      platformKey: account.platformKey,
      identifier: account.identifier,
    })
  );
}

function createAccount(overrides: Partial<Account> & Pick<Account, 'id'>): Account {
  const profileId = overrides.profileId ?? 1;
  const accountType = overrides.accountType ?? 'exchange-api';
  const platformKey = overrides.platformKey ?? 'kraken';
  const identifier = overrides.identifier ?? `identifier-${overrides.id}`;

  return {
    id: overrides.id,
    profileId,
    name: overrides.name,
    parentAccountId: overrides.parentAccountId,
    accountType,
    platformKey,
    identifier,
    accountFingerprint:
      overrides.accountFingerprint ?? recomputeAccountFingerprint({ profileId, accountType, platformKey, identifier }),
    providerName: overrides.providerName,
    credentials: overrides.credentials,
    lastCursor: overrides.lastCursor,
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt,
  };
}

function createStore(initialAccounts: Account[] = []) {
  const accounts = initialAccounts.map((account) => ({ ...account }));
  let nextId = Math.max(0, ...accounts.map((account) => account.id)) + 1;

  return {
    accounts,
    store: {
      async create(input: {
        accountType: Account['accountType'];
        credentials?: Account['credentials'];
        identifier: string;
        metadata?: Account['metadata'];
        name: string;
        platformKey: string;
        profileId: number;
        providerName?: string | undefined;
      }) {
        const account = createAccount({
          id: nextId++,
          profileId: input.profileId,
          name: input.name,
          accountType: input.accountType,
          platformKey: input.platformKey,
          identifier: input.identifier,
          providerName: input.providerName,
          credentials: input.credentials,
          metadata: input.metadata,
        });
        accounts.push(account);
        return ok(account);
      },
      async findById(accountId: number) {
        return ok(accounts.find((account) => account.id === accountId));
      },
      async findByFingerprintRef(profileId: number, fingerprintRef: string) {
        const normalizedRef = fingerprintRef.trim().toLowerCase();
        return ok(
          accounts.find(
            (account) =>
              account.profileId === profileId && account.accountFingerprint.toLowerCase().startsWith(normalizedRef)
          )
        );
      },
      async findByIdentity(input: {
        accountType: Account['accountType'];
        identifier: string;
        platformKey: string;
        profileId: number;
      }) {
        return ok(
          accounts.find(
            (account) =>
              account.profileId === input.profileId &&
              account.platformKey === input.platformKey &&
              (isExchangeAccountType(input.accountType)
                ? account.parentAccountId === undefined && isExchangeAccountType(account.accountType)
                : account.accountType === input.accountType && account.identifier === input.identifier)
          )
        );
      },
      async findByName(profileId: number, name: string) {
        return ok(accounts.find((account) => account.profileId === profileId && account.name === name));
      },
      async findChildren(parentAccountId: number, profileId: number) {
        return ok(
          accounts.filter((account) => account.parentAccountId === parentAccountId && account.profileId === profileId)
        );
      },
      async listTopLevel(profileId: number) {
        return ok(
          accounts.filter(
            (account) =>
              account.profileId === profileId && account.parentAccountId === undefined && account.name !== undefined
          )
        );
      },
      async update(
        accountId: number,
        updates: {
          credentials?: Account['credentials'];
          identifier?: string | undefined;
          metadata?: Account['metadata'];
          name?: string | null | undefined;
          providerName?: string | undefined;
          resetCursor?: boolean | undefined;
        }
      ) {
        const account = accounts.find((current) => current.id === accountId);
        if (!account) {
          throw new Error(`Missing account ${accountId}`);
        }

        if (updates.name !== undefined) {
          account.name = updates.name ?? undefined;
        }
        if (updates.identifier !== undefined) {
          account.identifier = updates.identifier;
          account.accountFingerprint = recomputeAccountFingerprint(account);
        }
        if (updates.providerName !== undefined) {
          account.providerName = updates.providerName;
        }
        if (updates.credentials !== undefined) {
          account.credentials = updates.credentials;
        }
        if (updates.metadata !== undefined) {
          account.metadata = updates.metadata;
        }
        if (updates.resetCursor) {
          account.lastCursor = undefined;
        }
        account.updatedAt = new Date('2026-01-02T00:00:00.000Z');

        return ok(undefined);
      },
    },
  };
}

describe('AccountLifecycleService', () => {
  it('creates a new account when the config is new', async () => {
    const { store } = createStore();
    const service = new AccountLifecycleService(store);

    const result = assertOk(
      await service.create({
        profileId: 1,
        name: 'kraken-main',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'api-key-1',
      })
    );

    expect(result.name).toBe('kraken-main');
  });

  it('rejects reserved command words as new account names', async () => {
    const { store } = createStore();
    const service = new AccountLifecycleService(store);

    const result = await service.create({
      profileId: 1,
      name: 'view',
      accountType: 'exchange-api',
      platformKey: 'kraken',
      identifier: 'api-key-1',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("Account name 'view' is reserved");
      expect(result.error.message).toContain('add, list, remove, update, view');
    }
  });

  it('allows rename as an account name now that it is not a command', async () => {
    const { store } = createStore();
    const service = new AccountLifecycleService(store);

    const result = assertOk(
      await service.create({
        profileId: 1,
        name: 'rename',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'api-key-1',
      })
    );

    expect(result.name).toBe('rename');
  });

  it('rejects a second top-level exchange account on the same platform in one profile', async () => {
    const { store } = createStore([
      createAccount({
        id: 7,
        profileId: 1,
        name: 'kraken-main',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'api-key-1',
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const result = await service.create({
      profileId: 1,
      name: 'kraken-secondary',
      accountType: 'exchange-csv',
      platformKey: 'kraken',
      identifier: '/tmp/kraken',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('kraken-main');
    }
  });

  it('rejects existing top-level accounts instead of auto-adopting them', async () => {
    const { accounts, store } = createStore([
      createAccount({
        id: 7,
        profileId: 1,
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'api-key-1',
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const result = await service.create({
      profileId: 1,
      name: 'kraken-main',
      accountType: 'exchange-api',
      platformKey: 'kraken',
      identifier: 'api-key-1',
      providerName: 'kraken-api',
    });

    expect(result.isErr()).toBe(true);
    expect(accounts[0]?.name).toBeUndefined();
    expect(accounts[0]?.providerName).toBeUndefined();
    if (result.isErr()) {
      expect(result.error.message).toContain('top-level account #7');
    }
  });

  it('rejects naming a child account config as a standalone account', async () => {
    const { store } = createStore([
      createAccount({
        id: 7,
        profileId: 1,
        parentAccountId: 3,
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'bc1q-child',
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const result = await service.create({
      profileId: 1,
      name: 'btc-child',
      accountType: 'blockchain',
      platformKey: 'bitcoin',
      identifier: 'bc1q-child',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('child account');
    }
  });

  it('updates an existing account name', async () => {
    const { store } = createStore([
      createAccount({
        id: 7,
        profileId: 1,
        name: 'kraken-main',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'api-key-1',
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const renamed = assertOk(await service.updateOwned(1, 7, { name: 'kraken-primary' }));

    expect(renamed.name).toBe('kraken-primary');
  });

  it('rejects updating an account name to a reserved command word', async () => {
    const { store } = createStore([
      createAccount({
        id: 7,
        profileId: 1,
        name: 'kraken-main',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'api-key-1',
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const result = await service.updateOwned(1, 7, { name: 'list' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("Account name 'list' is reserved");
    }
  });

  it('updates account config for an existing account', async () => {
    const { store } = createStore([
      createAccount({
        id: 7,
        profileId: 1,
        name: 'kraken-main',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'old-key',
        credentials: {
          apiKey: 'old-key',
          apiSecret: 'old-secret',
        },
        lastCursor: {
          ledger: {
            primary: { type: 'pageToken', value: '123', providerName: 'kraken' },
            lastTransactionId: 'tx-123',
            totalFetched: 10,
          },
        },
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const updated = assertOk(
      await service.updateOwned(1, 7, {
        name: 'kraken-primary',
        identifier: 'new-key',
        credentials: {
          apiKey: 'new-key',
          apiSecret: 'new-secret',
        },
        resetCursor: true,
      })
    );

    expect(updated.name).toBe('kraken-primary');
    expect(updated.identifier).toBe('new-key');
    expect(updated.credentials).toEqual({
      apiKey: 'new-key',
      apiSecret: 'new-secret',
    });
    expect(updated.lastCursor).toBeUndefined();
  });

  it('rejects updating a name to an existing account name', async () => {
    const { store } = createStore([
      createAccount({
        id: 7,
        profileId: 1,
        name: 'kraken-main',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'api-key-1',
      }),
      createAccount({
        id: 8,
        profileId: 1,
        name: 'kraken-secondary',
        accountType: 'exchange-api',
        platformKey: 'coinbase',
        identifier: 'api-key-2',
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const result = await service.updateOwned(1, 7, {
      name: 'kraken-secondary',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("Account 'kraken-secondary' already exists");
    }
  });

  it('rejects blockchain config updates that collide with another account', async () => {
    const { store } = createStore([
      createAccount({
        id: 7,
        profileId: 1,
        name: 'btc-main',
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'bc1q-old',
      }),
      createAccount({
        id: 8,
        profileId: 1,
        name: 'btc-secondary',
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'bc1q-new',
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const result = await service.updateOwned(1, 7, {
      identifier: 'bc1q-new',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('btc-secondary');
    }
  });

  it('reports child-account collisions accurately during config updates', async () => {
    const { store } = createStore([
      createAccount({
        id: 7,
        profileId: 1,
        name: 'wallet-root',
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'xpub-root',
      }),
      createAccount({
        id: 8,
        profileId: 1,
        parentAccountId: 7,
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'bc1q-child',
      }),
      createAccount({
        id: 9,
        profileId: 1,
        name: 'wallet-secondary',
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'bc1q-secondary',
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const result = await service.updateOwned(1, 9, {
      identifier: 'bc1q-child',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('child account #8');
    }
  });

  it('returns the account when it belongs to the selected profile', async () => {
    const { store } = createStore([
      createAccount({
        id: 7,
        profileId: 1,
        name: 'kraken-main',
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const account = assertOk(await service.requireOwned(1, 7));

    expect(account.id).toBe(7);
  });

  it('rejects accounts owned by another profile', async () => {
    const { store } = createStore([
      createAccount({
        id: 7,
        profileId: 2,
        name: 'kraken-main',
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const result = await service.requireOwned(1, 7);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('does not belong');
    }
  });

  it('collects the full account hierarchy in breadth-first order', async () => {
    const { store } = createStore([
      createAccount({
        id: 1,
        profileId: 1,
        name: 'wallet-root',
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'xpub-root',
      }),
      createAccount({
        id: 2,
        profileId: 1,
        parentAccountId: 1,
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'child-a',
      }),
      createAccount({
        id: 3,
        profileId: 1,
        parentAccountId: 1,
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'child-b',
      }),
      createAccount({
        id: 4,
        profileId: 1,
        parentAccountId: 2,
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'grandchild',
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const hierarchy = assertOk(await service.collectHierarchy(1, 1));

    expect(hierarchy.map((account) => account.id)).toEqual([1, 2, 3, 4]);
  });

  it('keeps hierarchy traversal inside the selected profile', async () => {
    const { store } = createStore([
      createAccount({
        id: 1,
        profileId: 1,
        name: 'root',
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'root',
      }),
      createAccount({
        id: 2,
        profileId: 1,
        parentAccountId: 1,
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'child-a',
      }),
      createAccount({
        id: 3,
        profileId: 2,
        parentAccountId: 1,
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'cross-profile-child',
      }),
    ]);
    const service = new AccountLifecycleService(store);

    const hierarchy = assertOk(await service.collectHierarchy(1, 1));

    expect(hierarchy.map((account) => account.id)).toEqual([1, 2]);
  });
});
