import type { Account, AssetReviewSummary, TransactionLink } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import { materializeTestTransaction } from '../../__tests__/test-utils.js';
import type { LedgerLinkingGapIssue } from '../../ledger-linking/gaps/ledger-linking-gap-issues.js';
import { buildLinkGapIssueKey } from '../../linking/gaps/gap-model.js';
import type { ProfileAccountingIssueSourceData } from '../../ports/profile-issue-source-reader.js';
import { materializeProfileAccountingIssueScopeSnapshot } from '../profile-issue-materializer.js';

function createMockAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    accountFingerprint: 'acc-1',
    accountType: 'blockchain',
    platformKey: 'bitcoin',
    identifier: 'bc1qowneraddress',
    profileId: 7,
    displayName: undefined,
    parentAccountId: undefined,
    ...overrides,
  } as Account;
}

function createAssetReviewSummary(overrides: Partial<AssetReviewSummary> = {}): AssetReviewSummary {
  return {
    assetId: 'blockchain:ethereum:0xscam',
    reviewStatus: 'needs-review',
    referenceStatus: 'unknown',
    evidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
    confirmationIsStale: false,
    accountingBlocked: true,
    warningSummary: 'Suspicious asset evidence requires review',
    evidence: [
      {
        kind: 'scam-diagnostic',
        severity: 'error',
        message: 'Known scam evidence',
      },
    ],
    ...overrides,
  };
}

function createLedgerLinkingGapIssue(overrides: Partial<LedgerLinkingGapIssue> = {}): LedgerLinkingGapIssue {
  return {
    activityDatetime: new Date('2026-04-23T12:00:00.000Z'),
    assetId: 'blockchain:ethereum:native',
    assetSymbol: 'ETH' as LedgerLinkingGapIssue['assetSymbol'],
    candidateId: 17,
    classifications: ['exchange_transfer_missing_hash'],
    claimedAmount: '0',
    direction: 'source',
    gapReason: 'exchange_transfer_missing_hash',
    journalFingerprint: 'ledger_journal:v1:17',
    originalAmount: '1.25',
    ownerAccountId: 1,
    platformKey: 'kraken',
    platformKind: 'exchange',
    postingFingerprint: 'ledger_posting:v1:17',
    remainingAmount: '1.25',
    sourceActivityFingerprint: 'source_activity:v1:17',
    ...overrides,
  };
}

function createBlockchainWithdrawal(overrides: Partial<Parameters<typeof materializeTestTransaction>[0]> = {}) {
  return materializeTestTransaction({
    id: 21,
    accountId: 1,
    txFingerprint: 'btc-outflow',
    datetime: '2024-01-01T12:00:00Z',
    timestamp: 1704110400000,
    platformKey: 'bitcoin',
    platformKind: 'blockchain',
    status: 'success',
    from: 'bc1qowneraddress',
    to: 'bc1qcounterparty',
    blockchain: {
      name: 'bitcoin',
      transaction_hash: 'hash-out',
      is_confirmed: true,
    },
    movements: {
      inflows: [],
      outflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('0.5'),
          netAmount: parseDecimal('0.5'),
        },
      ],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'withdrawal',
    },
    ...overrides,
  });
}

function createSourceData(overrides: Partial<ProfileAccountingIssueSourceData> = {}): ProfileAccountingIssueSourceData {
  return {
    accounts: [createMockAccount()],
    assetReviewSummaries: [createAssetReviewSummary()],
    excludedAssetIds: new Set<string>(),
    links: [] as readonly TransactionLink[],
    resolvedIssueKeys: new Set<string>(),
    transactions: [createBlockchainWithdrawal()],
    ...overrides,
  };
}

describe('materializeProfileAccountingIssueScopeSnapshot', () => {
  it('builds profile issues from reader-loaded source facts', async () => {
    const sourceReader = {
      loadProfileAccountingIssueSourceData: vi.fn().mockResolvedValue(ok(createSourceData())),
    };

    const result = await materializeProfileAccountingIssueScopeSnapshot({
      profileId: 7,
      scopeKey: 'profile:7',
      sourceReader,
      title: 'Main profile',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.scope.openIssueCount).toBe(2);
    expect(result.value.issues.map((issue) => issue.issue.family)).toEqual(['transfer_gap', 'asset_review_required']);
  });

  it('omits excluded asset-review-required items from the materialized profile scope', async () => {
    const assetId = 'blockchain:ethereum:0xscam';
    const sourceReader = {
      loadProfileAccountingIssueSourceData: vi.fn().mockResolvedValue(
        ok(
          createSourceData({
            assetReviewSummaries: [createAssetReviewSummary({ assetId })],
            excludedAssetIds: new Set<string>([assetId]),
            transactions: [],
          })
        )
      ),
    };

    const result = await materializeProfileAccountingIssueScopeSnapshot({
      profileId: 7,
      scopeKey: 'profile:7',
      sourceReader,
      title: 'Main profile',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.scope.status).toBe('ready');
    expect(result.value.issues).toHaveLength(0);
  });

  it('keeps resolved gap overrides hidden when materializing the snapshot', async () => {
    const transaction = createBlockchainWithdrawal();
    const sourceReader = {
      loadProfileAccountingIssueSourceData: vi.fn().mockResolvedValue(
        ok(
          createSourceData({
            assetReviewSummaries: [],
            resolvedIssueKeys: new Set([
              buildLinkGapIssueKey({
                txFingerprint: transaction.txFingerprint,
                assetId: 'blockchain:bitcoin:native',
                direction: 'outflow',
              }),
            ]),
            transactions: [transaction],
          })
        )
      ),
    };

    const result = await materializeProfileAccountingIssueScopeSnapshot({
      profileId: 7,
      scopeKey: 'profile:7',
      sourceReader,
      title: 'Main profile',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.scope.status).toBe('ready');
    expect(result.value.issues).toHaveLength(0);
  });

  it('includes reader-provided ledger-linking-v2 gaps in the profile snapshot', async () => {
    const sourceReader = {
      loadProfileAccountingIssueSourceData: vi.fn().mockResolvedValue(
        ok(
          createSourceData({
            assetReviewSummaries: [],
            ledgerLinkingGapIssues: [createLedgerLinkingGapIssue()],
            transactions: [],
          })
        )
      ),
    };

    const result = await materializeProfileAccountingIssueScopeSnapshot({
      profileId: 7,
      scopeKey: 'profile:7',
      sourceReader,
      title: 'Main profile',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.scope.status).toBe('has-open-issues');
    expect(result.value.scope.openIssueCount).toBe(1);
    expect(result.value.issues[0]?.issue.summary).toBe('ETH outflow remains unresolved in links-v2');
  });
});
