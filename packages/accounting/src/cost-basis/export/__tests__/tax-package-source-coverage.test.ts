import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildTransaction } from '../../../__tests__/test-utils.js';
import { buildIndexedTaxPackageSourceContext } from '../tax-package-source-context.js';
import { validateTaxPackageSourceCoverage } from '../tax-package-source-coverage.js';

function createIndexedContext(params?: {
  accounts?: { id: number }[];
  confirmedLinks?: { id: number }[];
  transactions?: { accountId?: number; id: number }[];
}) {
  const ctx = {
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
  return assertOk(buildIndexedTaxPackageSourceContext(ctx));
}

describe('validateTaxPackageSourceCoverage', () => {
  it('should return ok when all references are satisfied', () => {
    const indexed = createIndexedContext({
      transactions: [{ id: 1 }],
      accounts: [{ id: 1 }],
      confirmedLinks: [{ id: 10 }],
    });

    const result = validateTaxPackageSourceCoverage(indexed, {
      transactionRefs: [{ transactionId: 1, reference: 'lot-1' }],
      confirmedLinkRefs: [{ linkId: 10, reference: 'transfer-1' }],
    });

    expect(result.isOk()).toBe(true);
    assertOk(result);
  });

  it('should return ok with empty refs', () => {
    const indexed = createIndexedContext({});
    const result = validateTaxPackageSourceCoverage(indexed, {
      transactionRefs: [],
      confirmedLinkRefs: [],
    });

    expect(result.isOk()).toBe(true);
    assertOk(result);
  });

  it('should validate multiple transaction refs and confirmed link refs', () => {
    const indexed = createIndexedContext({
      transactions: [{ id: 1 }, { id: 2 }, { id: 3 }],
      accounts: [{ id: 1 }],
      confirmedLinks: [{ id: 10 }, { id: 20 }],
    });

    const result = validateTaxPackageSourceCoverage(indexed, {
      transactionRefs: [
        { transactionId: 1, reference: 'lot-1' },
        { transactionId: 2, reference: 'lot-2' },
        { transactionId: 3, reference: 'lot-3' },
      ],
      confirmedLinkRefs: [
        { linkId: 10, reference: 'transfer-1' },
        { linkId: 20, reference: 'transfer-2' },
      ],
    });

    expect(result.isOk()).toBe(true);
    assertOk(result);
  });

  it('should return error when transaction is missing', () => {
    const indexed = createIndexedContext({
      accounts: [{ id: 1 }],
    });

    const result = assertErr(
      validateTaxPackageSourceCoverage(indexed, {
        transactionRefs: [{ transactionId: 999, reference: 'lot-1' }],
        confirmedLinkRefs: [],
      })
    );

    expect(result.message).toContain('Missing source transaction');
    expect(result.message).toContain('999');
    expect(result.message).toContain('lot-1');
  });

  it('should return error when confirmed link is missing', () => {
    const indexed = createIndexedContext({});

    const result = assertErr(
      validateTaxPackageSourceCoverage(indexed, {
        transactionRefs: [],
        confirmedLinkRefs: [{ linkId: 999, reference: 'transfer-1' }],
      })
    );

    expect(result.message).toContain('Missing confirmed link');
    expect(result.message).toContain('999');
    expect(result.message).toContain('transfer-1');
  });

  it('should return error when account is missing for transaction', () => {
    const indexed = createIndexedContext({
      transactions: [{ id: 1, accountId: 42 }],
    });

    const result = assertErr(
      validateTaxPackageSourceCoverage(indexed, {
        transactionRefs: [{ transactionId: 1, reference: 'lot-1' }],
        confirmedLinkRefs: [],
      })
    );

    expect(result.message).toContain('Missing account');
    expect(result.message).toContain('42');
  });
});
