import type { IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { Account, RawTransaction, Transaction } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { ok, type Currency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import type { AdapterRegistry } from '@exitbook/ingestion/adapters';
import type { AccountingLedgerDraft, AccountingPostingDraft } from '@exitbook/ingestion/process';
import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import {
  EvmFamilyLedgerStressRunner,
  parseEvmFamilyLedgerStressExpectedDiffFile,
} from '../evm-family-ledger-stress-runner.js';
import { EVM_FAMILY_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA } from '../evm-family-ledger-stress-types.js';

const ASSET_ID = 'blockchain:ethereum:native';
const ETH = 'ETH' as Currency;

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? 1,
    profileId: overrides.profileId ?? 1,
    name: overrides.name ?? 'ethereum-main',
    accountType: overrides.accountType ?? 'blockchain',
    platformKey: overrides.platformKey ?? 'ethereum',
    identifier: overrides.identifier ?? '0x1111111111111111111111111111111111111111',
    accountFingerprint: overrides.accountFingerprint ?? 'account-fingerprint-1',
    createdAt: overrides.createdAt ?? new Date('2026-04-26T00:00:00.000Z'),
  };
}

function createRawRow(account: Account, eventId = 'raw-event-1'): RawTransaction {
  return {
    id: 1,
    accountId: account.id,
    providerName: 'fixture-provider',
    eventId,
    blockchainTransactionHash: '0xstress1',
    timestamp: 1_776_000_000_000,
    providerData: { eventId },
    normalizedData: { eventId },
    processingStatus: 'processed',
    createdAt: new Date('2026-04-26T00:00:00.000Z'),
  };
}

function createLegacyTransaction(account: Account, quantity: string): Transaction {
  return {
    id: 1,
    accountId: account.id,
    txFingerprint: 'tx-fingerprint-1',
    datetime: '2026-04-26T00:00:00.000Z',
    timestamp: 1_776_000_000_000,
    platformKey: account.platformKey,
    platformKind: 'blockchain',
    status: 'success',
    movements: {
      inflows: [
        {
          assetId: ASSET_ID,
          assetSymbol: ETH,
          grossAmount: new Decimal(quantity),
          movementFingerprint: 'movement-fingerprint-1',
        },
      ],
      outflows: [],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'deposit',
    },
    blockchain: {
      name: account.platformKey,
      transaction_hash: '0xstress1',
      is_confirmed: true,
    },
  };
}

function createLedgerDraft(account: Account, quantity: string): AccountingLedgerDraft {
  const sourceActivityFingerprint = 'source-activity-fingerprint-1';
  const posting = createPosting(sourceActivityFingerprint, quantity);

  return {
    sourceActivity: {
      ownerAccountId: account.id,
      sourceActivityOrigin: 'provider_event',
      sourceActivityStableKey: 'source-activity-stable-1',
      sourceActivityFingerprint,
      platformKey: account.platformKey,
      platformKind: 'blockchain',
      activityStatus: 'success',
      activityDatetime: '2026-04-26T00:00:00.000Z',
      activityTimestampMs: 1_776_000_000_000,
      blockchainName: account.platformKey,
      blockchainTransactionHash: '0xstress1',
      blockchainIsConfirmed: true,
    },
    journals: [
      {
        sourceActivityFingerprint,
        journalStableKey: 'journal-stable-1',
        journalKind: 'transfer',
        postings: [posting],
      },
    ],
  };
}

function createPosting(sourceActivityFingerprint: string, quantity: string): AccountingPostingDraft {
  return {
    postingStableKey: 'posting-stable-1',
    assetId: ASSET_ID,
    assetSymbol: ETH,
    quantity: new Decimal(quantity),
    role: 'principal',
    balanceCategory: 'liquid',
    settlement: 'on-chain',
    sourceComponentRefs: [
      {
        component: {
          sourceActivityFingerprint,
          componentKind: 'raw_event',
          componentId: 'raw-event-1',
          assetId: ASSET_ID,
        },
        quantity: new Decimal(quantity).abs(),
      },
    ],
  };
}

function createDataSessionMock(params: {
  account: Account;
  legacyTransactions: Transaction[];
  rawRows: RawTransaction[];
}): DataSession {
  return {
    accounts: {
      findAll: vi.fn(async () => ok([params.account])),
    },
    rawTransactions: {
      findAll: vi.fn(async () => ok(params.rawRows)),
    },
    transactions: {
      findAll: vi.fn(async () => ok(params.legacyTransactions)),
    },
  } as unknown as DataSession;
}

function createAdapterRegistryMock(ledgerDrafts: AccountingLedgerDraft[]): AdapterRegistry {
  return {
    getBlockchain: vi.fn(() =>
      ok({
        blockchain: 'ethereum',
        chainModel: 'account-based',
        normalizeAddress: vi.fn((address: string) => ok(address.toLowerCase())),
        createImporter: vi.fn(),
        createProcessor: vi.fn(),
        createLedgerProcessor: vi.fn(() => ({
          process: vi.fn(async () => ok(ledgerDrafts)),
        })),
      })
    ),
  } as unknown as AdapterRegistry;
}

function createRunner(params: {
  account: Account;
  ledgerDrafts: AccountingLedgerDraft[];
  legacyTransactions: Transaction[];
  rawRows: RawTransaction[];
}): EvmFamilyLedgerStressRunner {
  return new EvmFamilyLedgerStressRunner({
    adapterRegistry: createAdapterRegistryMock(params.ledgerDrafts),
    db: createDataSessionMock({
      account: params.account,
      legacyTransactions: params.legacyTransactions,
      rawRows: params.rawRows,
    }),
    providerRuntime: {} as IBlockchainProviderRuntime,
  });
}

describe('EvmFamilyLedgerStressRunner', () => {
  it('passes when ledger-v2 balances match legacy balance impact', async () => {
    const account = createAccount();
    const runner = createRunner({
      account,
      rawRows: [createRawRow(account)],
      legacyTransactions: [createLegacyTransaction(account, '1')],
      ledgerDrafts: [createLedgerDraft(account, '1')],
    });

    const result = assertOk(await runner.run([account], { chains: ['ethereum'] }));

    expect(result.status).toBe('passed');
    expect(result.summary).toMatchObject({
      checkedAccounts: 1,
      unexpectedDiffs: 0,
      staleExpectedDiffs: 0,
      ledgerPostings: 1,
    });
    expect(result.scopes[0]?.status).toBe('passed');
  });

  it('fails with an unexpected diff when ledger-v2 quantity diverges from legacy impact', async () => {
    const account = createAccount();
    const runner = createRunner({
      account,
      rawRows: [createRawRow(account)],
      legacyTransactions: [createLegacyTransaction(account, '1')],
      ledgerDrafts: [createLedgerDraft(account, '2')],
    });

    const result = assertOk(await runner.run([account], { chains: ['ethereum'] }));

    expect(result.status).toBe('failed');
    expect(result.summary.unexpectedDiffs).toBe(1);
    expect(result.scopes[0]?.diffs[0]).toMatchObject({
      assetId: ASSET_ID,
      balanceCategory: 'liquid',
      delta: '1',
      ledgerQuantity: '2',
      referenceQuantity: '1',
      status: 'unexpected_diff',
    });
  });

  it('passes with accepted diffs when expected-diffs documents the exact observed delta', async () => {
    const account = createAccount();
    const runner = createRunner({
      account,
      rawRows: [createRawRow(account)],
      legacyTransactions: [createLegacyTransaction(account, '1')],
      ledgerDrafts: [createLedgerDraft(account, '2')],
    });

    const result = assertOk(
      await runner.run([account], {
        chains: ['ethereum'],
        expectedDiffs: [
          {
            accountFingerprint: account.accountFingerprint,
            assetId: ASSET_ID,
            balanceCategory: 'liquid',
            delta: '1',
            reason: 'Fixture documents an intentional balance projection difference.',
          },
        ],
      })
    );

    expect(result.status).toBe('passed');
    expect(result.summary.acceptedDiffs).toBe(1);
    expect(result.summary.unexpectedDiffs).toBe(0);
    expect(result.scopes[0]?.status).toBe('accepted_diffs');
    expect(result.scopes[0]?.diffs[0]).toMatchObject({
      expectedReason: 'Fixture documents an intentional balance projection difference.',
      status: 'accepted_diff',
    });
  });

  it('fails stale expected diffs when a documented diff is no longer observed', async () => {
    const account = createAccount();
    const runner = createRunner({
      account,
      rawRows: [createRawRow(account)],
      legacyTransactions: [createLegacyTransaction(account, '1')],
      ledgerDrafts: [createLedgerDraft(account, '1')],
    });

    const result = assertOk(
      await runner.run([account], {
        chains: ['ethereum'],
        expectedDiffs: [
          {
            accountFingerprint: account.accountFingerprint,
            assetId: ASSET_ID,
            balanceCategory: 'liquid',
            delta: '1',
            reason: 'This expected diff should be removed once it disappears.',
          },
        ],
      })
    );

    expect(result.status).toBe('failed');
    expect(result.summary.staleExpectedDiffs).toBe(1);
    expect(result.staleExpectedDiffs[0]).toMatchObject({
      assetId: ASSET_ID,
      reason: 'This expected diff should be removed once it disappears.',
    });
  });

  it('rejects malformed expected-diffs files instead of treating invalid decimals as zero', () => {
    const error = assertErr(
      parseEvmFamilyLedgerStressExpectedDiffFile({
        schema: EVM_FAMILY_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA,
        diffs: [
          {
            accountFingerprint: 'account-fingerprint-1',
            assetId: ASSET_ID,
            balanceCategory: 'liquid',
            delta: 'not-a-decimal',
            reason: 'Invalid fixture.',
          },
        ],
      })
    );

    expect(error.message).toContain('invalid delta not-a-decimal');
  });
});
