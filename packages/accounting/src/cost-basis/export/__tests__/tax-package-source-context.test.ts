import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { buildTransaction } from '../../../__tests__/test-utils.js';
import {
  buildIndexedTaxPackageSourceContext,
  requireConfirmedLink,
  requireTransactionWithAccount,
} from '../tax-package-source-context.js';

function createSourceContext(params?: {
  accounts?: { id: number }[];
  confirmedLinks?: { id: number }[];
  transactions?: { accountId?: number; id: number }[];
}) {
  return {
    transactions: (params?.transactions ?? []).map((t) =>
      buildTransaction({
        id: t.id,
        accountId: t.accountId ?? 1,
        datetime: '2024-01-01T00:00:00Z',
        source: 'test',
      })
    ),
    accounts: (params?.accounts ?? []).map((a) => ({ id: a.id, name: `account-${a.id}` })),
    confirmedLinks: (params?.confirmedLinks ?? []).map((l) => ({ id: l.id })),
  } as unknown as Parameters<typeof buildIndexedTaxPackageSourceContext>[0];
}

describe('buildIndexedTaxPackageSourceContext', () => {
  it('should build indexed maps from source context', () => {
    const ctx = createSourceContext({
      transactions: [{ id: 1 }, { id: 2 }],
      accounts: [{ id: 1 }],
      confirmedLinks: [{ id: 10 }],
    });

    const result = assertOk(buildIndexedTaxPackageSourceContext(ctx));

    expect(result.transactionsById.size).toBe(2);
    expect(result.accountsById.size).toBe(1);
    expect(result.confirmedLinksById.size).toBe(1);
  });

  it('should return error for duplicate transaction ids', () => {
    const ctx = createSourceContext({
      transactions: [{ id: 1 }, { id: 1 }],
      accounts: [{ id: 1 }],
    });

    const result = assertErr(buildIndexedTaxPackageSourceContext(ctx));

    expect(result.message).toContain('Duplicate');
    expect(result.message).toContain('transaction');
  });
});

describe('requireTransactionWithAccount', () => {
  it('should return transaction when it exists and account is present', () => {
    const ctx = createSourceContext({
      transactions: [{ id: 1, accountId: 1 }],
      accounts: [{ id: 1 }],
    });
    const indexed = assertOk(buildIndexedTaxPackageSourceContext(ctx));

    const result = assertOk(requireTransactionWithAccount(indexed, 1, 'lot-123'));
    expect(result.id).toBe(1);
  });

  it('should return error when transaction is missing', () => {
    const ctx = createSourceContext({ accounts: [{ id: 1 }] });
    const indexed = assertOk(buildIndexedTaxPackageSourceContext(ctx));

    const result = assertErr(requireTransactionWithAccount(indexed, 999, 'lot-123'));
    expect(result.message).toContain('Missing source transaction');
    expect(result.message).toContain('999');
  });

  it('should return error when account is missing for transaction', () => {
    const ctx = createSourceContext({
      transactions: [{ id: 1, accountId: 99 }],
      accounts: [{ id: 1 }],
    });
    const indexed = assertOk(buildIndexedTaxPackageSourceContext(ctx));

    const result = assertErr(requireTransactionWithAccount(indexed, 1, 'lot-123'));
    expect(result.message).toContain('Missing account');
    expect(result.message).toContain('99');
  });
});

describe('requireConfirmedLink', () => {
  it('should return link when it exists', () => {
    const ctx = createSourceContext({ confirmedLinks: [{ id: 10 }] });
    const indexed = assertOk(buildIndexedTaxPackageSourceContext(ctx));

    const result = assertOk(requireConfirmedLink(indexed, 10, 'transfer-abc'));
    expect(result.id).toBe(10);
  });

  it('should return error when link is missing', () => {
    const ctx = createSourceContext({});
    const indexed = assertOk(buildIndexedTaxPackageSourceContext(ctx));

    const result = assertErr(requireConfirmedLink(indexed, 999, 'transfer-abc'));
    expect(result.message).toContain('Missing confirmed link');
    expect(result.message).toContain('999');
  });
});
