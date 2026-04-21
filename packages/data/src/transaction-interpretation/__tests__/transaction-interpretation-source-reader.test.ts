import { type TransactionDraft, type Transaction } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { seedAccount, seedProfile } from '../../repositories/__tests__/helpers.js';
import { AccountRepository } from '../../repositories/account-repository.js';
import { TransactionRepository } from '../../repositories/transaction-repository.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { TransactionInterpretationSourceReader } from '../transaction-interpretation-source-reader.js';

function makePersistedTransaction(overrides: Partial<TransactionDraft> = {}): TransactionDraft {
  const platformKey = overrides.platformKey ?? 'ethereum';

  return {
    datetime: '2025-01-01T00:00:00.000Z',
    timestamp: 1_735_689_600_000,
    platformKey,
    platformKind: 'blockchain',
    status: 'success',
    movements: {
      inflows: [
        {
          assetId: 'blockchain:ethereum:0xa0b8',
          assetSymbol: 'USDC' as Currency,
          grossAmount: parseDecimal('1'),
          netAmount: parseDecimal('1'),
        },
      ],
      outflows: [],
    },
    fees: [],
    operation: { category: 'transfer', type: 'deposit' },
    blockchain: {
      name: platformKey,
      transaction_hash: '0xreader',
      is_confirmed: true,
    },
    ...overrides,
  };
}

describe('TransactionInterpretationSourceReader', () => {
  let db: KyselyDB;
  let accountRepository: AccountRepository;
  let repository: TransactionRepository;
  let reader: TransactionInterpretationSourceReader;

  beforeEach(async () => {
    db = await createTestDatabase();
    accountRepository = new AccountRepository(db);
    repository = new TransactionRepository(db);
    reader = new TransactionInterpretationSourceReader(repository, accountRepository);

    await seedProfile(db);
    await seedAccount(db, 1, 'blockchain', 'ethereum');
    await seedAccount(db, 2, 'blockchain', 'arbitrum');
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('loads a canonical transaction for the matching account', async () => {
    const transactionId = assertOk(await repository.create(makePersistedTransaction(), 1));

    const result = await reader.loadTransactionForInterpretation({
      accountId: 1,
      transactionId,
    });

    const transaction = assertOk(result) as Transaction;
    expect(transaction.id).toBe(transactionId);
    expect(transaction.accountId).toBe(1);
  });

  it('rejects transactions from a different account scope', async () => {
    const transactionId = assertOk(await repository.create(makePersistedTransaction(), 1));

    const result = await reader.loadTransactionForInterpretation({
      accountId: 2,
      transactionId,
    });

    expect(assertErr(result).message).toContain('belongs to account 1');
  });

  it('loads profile interpretation scope with transactions and account contexts', async () => {
    const transactionId = assertOk(await repository.create(makePersistedTransaction(), 1));

    const result = await reader.loadProfileInterpretationScope({ profileId: 1 });

    const scope = assertOk(result);
    expect(scope.transactions.map((transaction) => transaction.id)).toContain(transactionId);
    expect(scope.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: 1,
          identifier: 'identifier-1',
          profileId: 1,
        }),
        expect.objectContaining({
          accountId: 2,
          identifier: 'identifier-2',
          profileId: 1,
        }),
      ])
    );
  });
});
