import { AmbiguousAccountFingerprintRefError, type Account } from '@exitbook/core';
import { err, ok } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  AccountSelectorResolutionError,
  buildAccountSelectorFilters,
  formatResolvedAccountSelectorInput,
  getAccountSelectorErrorExitCode,
  resolveOwnedAccountSelector,
  resolveOwnedBrowseAccountSelector,
  resolveRequiredOwnedAccountSelector,
} from '../account-selector.js';

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? 1,
    profileId: overrides.profileId ?? 1,
    name: overrides.name ?? 'kraken-main',
    parentAccountId: overrides.parentAccountId,
    accountType: overrides.accountType ?? 'exchange-api',
    platformKey: overrides.platformKey ?? 'kraken',
    identifier: overrides.identifier ?? 'acct-1',
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

describe('account-selector helpers', () => {
  it('resolves a named account selector', async () => {
    const account = createAccount();
    const service = {
      getByName: vi.fn().mockResolvedValue(ok(account)),
      getByFingerprintRef: vi.fn(),
    };

    const result = await resolveOwnedAccountSelector(service, 1, { accountName: 'kraken-main' });

    expect(result.isErr()).toBe(false);
    if (result.isErr()) {
      return;
    }
    if (!result.value) {
      throw new Error('Expected named selector to resolve');
    }

    expect(result.value).toEqual({
      account,
      kind: 'name',
      value: 'kraken-main',
    });
    expect(buildAccountSelectorFilters(result.value)).toEqual({ accountName: 'kraken-main' });
    expect(formatResolvedAccountSelectorInput(result.value)).toBe("Account name 'kraken-main'");
  });

  it('falls back from a bare selector name lookup to fingerprint ref lookup', async () => {
    const account = createAccount({ name: undefined });
    const service = {
      getByName: vi.fn().mockResolvedValue(ok(undefined)),
      getByFingerprintRef: vi.fn().mockResolvedValue(ok(account)),
    };

    const result = await resolveOwnedBrowseAccountSelector(service, 1, '1aaaaaaaaa');

    expect(result.isErr()).toBe(false);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      account,
      kind: 'ref',
      value: '1aaaaaaaaa',
    });
    expect(service.getByName).toHaveBeenCalledWith(1, '1aaaaaaaaa');
    expect(service.getByFingerprintRef).toHaveBeenCalledWith(1, '1aaaaaaaaa');
  });

  it('rewrites a bare selector miss into selector-specific not-found copy', async () => {
    const service = {
      getByName: vi.fn().mockResolvedValue(ok(undefined)),
      getByFingerprintRef: vi.fn().mockResolvedValue(ok(undefined)),
    };

    const result = await resolveOwnedBrowseAccountSelector(service, 1, 'ghost-wallet');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AccountSelectorResolutionError);
      expect(result.error.message).toBe("Account selector 'ghost-wallet' not found");
      expect(getAccountSelectorErrorExitCode(result.error)).toBe(4);
    }
  });

  it('treats required-selector misses as invalid arguments', async () => {
    const service = {
      getByName: vi.fn(),
      getByFingerprintRef: vi.fn(),
    };

    const result = await resolveRequiredOwnedAccountSelector(
      service,
      1,
      {},
      'Import requires --account-name or --account-ref'
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AccountSelectorResolutionError);
      expect(result.error.message).toBe('Import requires --account-name or --account-ref');
      expect(getAccountSelectorErrorExitCode(result.error)).toBe(2);
    }
  });

  it('maps ambiguous fingerprint refs to invalid-args semantics', async () => {
    const service = {
      getByName: vi.fn(),
      getByFingerprintRef: vi
        .fn()
        .mockResolvedValue(err(new AmbiguousAccountFingerprintRefError('1aaa', ['1aaa0', '1aaa1']))),
    };

    const result = await resolveOwnedAccountSelector(service, 1, { accountRef: '1aaa' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AccountSelectorResolutionError);
      expect(getAccountSelectorErrorExitCode(result.error)).toBe(2);
      expect(result.error.message).toContain("Account ref '1aaa' is ambiguous");
    }
  });
});
