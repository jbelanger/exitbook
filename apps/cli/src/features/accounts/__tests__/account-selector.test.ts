import { AmbiguousAccountFingerprintRefError, type Account } from '@exitbook/core';
import { err, ok } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  AccountSelectorResolutionError,
  buildAccountSelectorFilters,
  formatResolvedAccountSelectorInput,
  getAccountSelectorErrorExitCode,
  hasAccountSelectorArgument,
  resolveOwnedAccountSelector,
  resolveOwnedOptionalAccountSelector,
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
      getByIdentifier: vi.fn(),
      getByName: vi.fn().mockResolvedValue(ok(account)),
      getByFingerprintRef: vi.fn(),
    };

    const result = await resolveOwnedAccountSelector(service, 1, 'kraken-main');

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
    expect(buildAccountSelectorFilters(result.value)).toEqual({ account: 'kraken-main' });
    expect(formatResolvedAccountSelectorInput(result.value)).toBe("Account selector 'kraken-main'");
  });

  it('falls back from a bare selector name lookup to fingerprint ref lookup', async () => {
    const account = createAccount({ name: undefined });
    const service = {
      getByIdentifier: vi.fn(),
      getByName: vi.fn().mockResolvedValue(ok(undefined)),
      getByFingerprintRef: vi.fn().mockResolvedValue(ok(account)),
    };

    const result = await resolveOwnedAccountSelector(service, 1, '1aaaaaaaaa');

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
    expect(service.getByIdentifier).not.toHaveBeenCalled();
  });

  it('falls back from selector lookup to exact identifier lookup', async () => {
    const account = createAccount({
      accountType: 'blockchain',
      identifier: 'bc1qwalletaddress',
      name: undefined,
      platformKey: 'bitcoin',
    });
    const service = {
      getByIdentifier: vi.fn().mockResolvedValue(ok(account)),
      getByName: vi.fn().mockResolvedValue(ok(undefined)),
      getByFingerprintRef: vi.fn().mockResolvedValue(ok(undefined)),
    };

    const result = await resolveOwnedAccountSelector(service, 1, 'bc1qwalletaddress');

    expect(result.isErr()).toBe(false);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      account,
      kind: 'identifier',
      value: 'bc1qwalletaddress',
    });
    expect(service.getByIdentifier).toHaveBeenCalledWith(1, 'bc1qwalletaddress');
  });

  it('treats a missing bare selector as an omitted selection', async () => {
    const service = {
      getByIdentifier: vi.fn(),
      getByName: vi.fn(),
      getByFingerprintRef: vi.fn(),
    };

    const result = await resolveOwnedOptionalAccountSelector(service, 1, undefined);

    expect(result.isErr()).toBe(false);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toBeUndefined();
    expect(hasAccountSelectorArgument({})).toBe(false);
    expect(hasAccountSelectorArgument({ selector: 'kraken-main' })).toBe(true);
    expect(service.getByName).not.toHaveBeenCalled();
    expect(service.getByFingerprintRef).not.toHaveBeenCalled();
    expect(service.getByIdentifier).not.toHaveBeenCalled();
  });

  it('rewrites a bare selector miss into selector-specific not-found copy', async () => {
    const service = {
      getByIdentifier: vi.fn().mockResolvedValue(ok(undefined)),
      getByName: vi.fn().mockResolvedValue(ok(undefined)),
      getByFingerprintRef: vi.fn().mockResolvedValue(ok(undefined)),
    };

    const result = await resolveOwnedAccountSelector(service, 1, 'ghost-wallet');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AccountSelectorResolutionError);
      expect(result.error.message).toBe("Account selector 'ghost-wallet' not found");
      expect(getAccountSelectorErrorExitCode(result.error)).toBe(4);
    }
  });

  it('treats missing required selectors as invalid arguments', async () => {
    const service = {
      getByIdentifier: vi.fn(),
      getByName: vi.fn(),
      getByFingerprintRef: vi.fn(),
    };

    const result = await resolveRequiredOwnedAccountSelector(
      service,
      1,
      undefined,
      'Import requires an account selector or --all'
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AccountSelectorResolutionError);
      expect(result.error.message).toBe('Import requires an account selector or --all');
      expect(getAccountSelectorErrorExitCode(result.error)).toBe(2);
    }
  });

  it('maps ambiguous selectors to invalid-args semantics when the fingerprint prefix is ambiguous', async () => {
    const service = {
      getByIdentifier: vi.fn(),
      getByName: vi.fn().mockResolvedValue(ok(undefined)),
      getByFingerprintRef: vi
        .fn()
        .mockResolvedValue(err(new AmbiguousAccountFingerprintRefError('1aaa', ['1aaa0', '1aaa1']))),
    };

    const result = await resolveOwnedAccountSelector(service, 1, '1aaa');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AccountSelectorResolutionError);
      expect(getAccountSelectorErrorExitCode(result.error)).toBe(2);
      expect(result.error.message).toContain("Account selector '1aaa' is ambiguous");
    }
  });
});
