import type { ProfileLinkGapSourceData } from '@exitbook/accounting/ports';
import type { Account, Transaction, TransactionDraft } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { createPersistedTransaction } from '../../shared/__tests__/transaction-test-utils.js';
import { buildTransactionRelatedContext } from '../transaction-investigation-context.js';

function createFingerprint(seed: string): string {
  return seed.repeat(64);
}

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? 1,
    profileId: overrides.profileId ?? 1,
    name: overrides.name,
    parentAccountId: overrides.parentAccountId,
    accountType: overrides.accountType ?? 'blockchain',
    platformKey: overrides.platformKey ?? 'bitcoin',
    identifier: overrides.identifier ?? 'bc1qtrackedwallet',
    accountFingerprint: overrides.accountFingerprint ?? createFingerprint('f'),
    providerName: overrides.providerName,
    credentials: overrides.credentials,
    lastCursor: overrides.lastCursor,
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt,
  };
}

function createTransaction(
  overrides: Partial<Omit<Transaction, 'fees' | 'movements'>> & {
    fees?: TransactionDraft['fees'] | undefined;
    movements?: TransactionDraft['movements'] | undefined;
  } = {}
): Transaction {
  const datetime = overrides.datetime ?? '2026-03-01T12:00:00.000Z';

  return createPersistedTransaction({
    id: overrides.id ?? 1,
    accountId: overrides.accountId ?? 1,
    txFingerprint: overrides.txFingerprint ?? createFingerprint('a'),
    platformKey: overrides.platformKey ?? 'bitcoin',
    platformKind: overrides.platformKind ?? 'blockchain',
    datetime,
    timestamp: overrides.timestamp ?? Date.parse(datetime),
    status: overrides.status ?? 'success',
    operation: overrides.operation ?? {
      category: 'transfer',
      type: 'withdrawal',
    },
    movements: overrides.movements ?? {
      inflows: [],
      outflows: [
        {
          assetId: 'asset:btc',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('0.25'),
          netAmount: parseDecimal('0.25'),
        },
      ],
    },
    fees: overrides.fees ?? [],
    from: overrides.from,
    to: overrides.to,
    blockchain: overrides.blockchain,
    diagnostics: overrides.diagnostics,
    userNotes: overrides.userNotes,
    excludedFromAccounting: overrides.excludedFromAccounting,
  });
}

describe('buildTransactionRelatedContext', () => {
  it('builds open-gap, sibling, shared-endpoint, and account-match context from profile data', () => {
    const selectedTransaction = createTransaction({
      id: 1,
      txFingerprint: createFingerprint('a'),
      from: 'bc1qtrackedwallet',
      to: 'bc1qexternaldestination',
      blockchain: {
        name: 'bitcoin',
        transaction_hash: 'txhash-0',
        is_confirmed: true,
      },
    });
    const sameHashSibling = createTransaction({
      id: 2,
      txFingerprint: createFingerprint('b'),
      datetime: '2026-03-01T12:01:00.000Z',
      timestamp: Date.parse('2026-03-01T12:01:00.000Z'),
      from: 'bc1qtrackedwallet',
      to: 'bc1qotherdestination',
      blockchain: {
        name: 'bitcoin',
        transaction_hash: 'txhash-1',
        is_confirmed: true,
      },
    });
    const sharedFromTransaction = createTransaction({
      id: 3,
      txFingerprint: createFingerprint('c'),
      datetime: '2026-03-01T12:05:00.000Z',
      timestamp: Date.parse('2026-03-01T12:05:00.000Z'),
      from: 'bc1qtrackedwallet',
      to: 'bc1qdifferentdestination',
      blockchain: {
        name: 'bitcoin',
        transaction_hash: 'different-hash',
        is_confirmed: true,
      },
    });
    const sharedToTransaction = createTransaction({
      id: 4,
      txFingerprint: createFingerprint('d'),
      datetime: '2026-03-01T11:59:00.000Z',
      timestamp: Date.parse('2026-03-01T11:59:00.000Z'),
      from: 'bc1quntrackedsource',
      to: 'bc1qexternaldestination',
      blockchain: {
        name: 'bitcoin',
        transaction_hash: 'different-hash-2',
        is_confirmed: true,
      },
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
      movements: {
        inflows: [
          {
            assetId: 'asset:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.10'),
            netAmount: parseDecimal('0.10'),
          },
        ],
        outflows: [],
      },
    });

    const source: ProfileLinkGapSourceData = {
      accounts: [
        createAccount({
          name: 'wallet-main',
          identifier: 'bc1qtrackedwallet',
          accountFingerprint: '1234567890abcdef1234567890abcdef',
        }),
      ],
      excludedAssetIds: new Set(),
      links: [],
      resolvedIssueKeys: new Set(),
      transactions: [selectedTransaction, sameHashSibling, sharedFromTransaction, sharedToTransaction],
    };

    const context = buildTransactionRelatedContext(source, selectedTransaction);

    expect(context?.fromAccount).toEqual({
      accountName: 'wallet-main',
      accountRef: '1234567890',
      platformKey: 'bitcoin',
    });
    expect(context?.openGapRefs).toHaveLength(1);
    expect(context?.openGapRefs?.[0]).toEqual(expect.any(String));
    expect(context?.sameHashSiblingTransactionCount).toBe(1);
    expect(context?.sameHashSiblingTransactionRefs).toEqual(['bbbbbbbbbb']);
    expect(context?.sharedFromTransactionCount).toBe(2);
    expect(context?.sharedFromTransactionRefs).toEqual(['bbbbbbbbbb', 'cccccccccc']);
    expect(context?.sharedToTransactionCount).toBe(1);
    expect(context?.sharedToTransactionRefs).toEqual(['dddddddddd']);
  });

  it('matches EVM endpoints case-insensitively for account and shared-endpoint context', () => {
    const selectedTransaction = createTransaction({
      id: 1,
      txFingerprint: createFingerprint('e'),
      platformKey: 'ethereum',
      from: '0xBA7DD2a5726a5A94b3556537E7212277e0E76CBf',
      to: '0x15A2AA147781B08A0105D678386EA63E6CA06281',
    });
    const sharedFromTransaction = createTransaction({
      id: 2,
      txFingerprint: createFingerprint('f'),
      platformKey: 'ethereum',
      datetime: '2026-03-01T12:05:00.000Z',
      timestamp: Date.parse('2026-03-01T12:05:00.000Z'),
      from: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
      to: '0x0000000000000000000000000000000000000001',
    });
    const source: ProfileLinkGapSourceData = {
      accounts: [
        createAccount({
          name: 'wallet-main',
          platformKey: 'ethereum',
          identifier: '0x15a2aa147781b08a0105d678386ea63e6ca06281',
          accountFingerprint: 'abcdef1234567890abcdef1234567890',
        }),
      ],
      excludedAssetIds: new Set(),
      links: [],
      resolvedIssueKeys: new Set(),
      transactions: [selectedTransaction, sharedFromTransaction],
    };

    const context = buildTransactionRelatedContext(source, selectedTransaction);

    expect(context?.toAccount).toEqual({
      accountName: 'wallet-main',
      accountRef: 'abcdef1234',
      platformKey: 'ethereum',
    });
    expect(context?.sharedFromTransactionCount).toBe(1);
    expect(context?.sharedFromTransactionRefs).toEqual(['ffffffffff']);
  });
});
