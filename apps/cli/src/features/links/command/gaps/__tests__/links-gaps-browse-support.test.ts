import type { LinkGapAnalysis } from '@exitbook/accounting/linking';
import type { ProfileLinkGapSourceData } from '@exitbook/accounting/ports';
import type { Transaction } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

const { mockBuildVisibleProfileLinkGapAnalysis } = vi.hoisted(() => ({
  mockBuildVisibleProfileLinkGapAnalysis: vi.fn(),
}));

vi.mock('@exitbook/accounting/linking', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exitbook/accounting/linking')>();

  return {
    ...actual,
    buildVisibleProfileLinkGapAnalysis: mockBuildVisibleProfileLinkGapAnalysis,
  };
});

import { createConfirmableTransferFixture, createMockGapAnalysis } from '../../../__tests__/test-utils.js';
import { createPersistedTransaction } from '../../../../shared/__tests__/transaction-test-utils.js';
import { createAddressOwnershipLookup } from '../../../../shared/address-ownership.js';
import { formatTransactionFingerprintRef } from '../../../../transactions/transaction-selector.js';
import { buildLinkGapRef, buildLinkProposalRef } from '../../../link-selector.js';
import { buildTransferProposalItems } from '../../../transfer-proposals.js';
import { buildLinksGapsBrowsePresentation } from '../links-gaps-browse-support.js';

type LinksGapSourceReader = Parameters<typeof buildLinksGapsBrowsePresentation>[0];

function createLinksGapSourceReader(
  sourceData: ProfileLinkGapSourceData = createProfileLinkGapSourceData(createMockGapAnalysis())
): {
  loadProfileLinkGapSourceData: ReturnType<typeof vi.fn>;
  sourceReader: LinksGapSourceReader;
} {
  const loadProfileLinkGapSourceData = vi.fn().mockResolvedValue(ok(sourceData));

  return {
    loadProfileLinkGapSourceData,
    sourceReader: {
      loadProfileLinkGapSourceData,
    },
  };
}

function createProfileLinkGapSourceData(analysis: LinkGapAnalysis): ProfileLinkGapSourceData {
  return {
    accounts: [],
    excludedAssetIds: new Set<string>(),
    links: [],
    resolvedIssueKeys: new Set<string>(),
    transactions: analysis.issues.map((issue) =>
      createPersistedTransaction({
        id: issue.transactionId,
        accountId: issue.transactionId,
        txFingerprint: issue.txFingerprint,
        platformKey: issue.platformKey,
        platformKind: issue.blockchainName !== undefined ? 'blockchain' : 'exchange',
        datetime: issue.timestamp,
        timestamp: Date.parse(issue.timestamp),
        status: 'success',
        movements: {
          inflows: [],
          outflows: [
            {
              assetId: 'test:gap',
              assetSymbol: 'ETH' as Currency,
              grossAmount: parseDecimal('1'),
              netAmount: parseDecimal('1'),
            },
          ],
        },
        fees: [],
        operation: {
          category: issue.operationCategory as Transaction['operation']['category'],
          type: issue.operationType as Transaction['operation']['type'],
        },
        ...(issue.blockchainName !== undefined
          ? {
              blockchain: {
                name: issue.blockchainName,
                transaction_hash: `${issue.txFingerprint}-hash`,
                is_confirmed: true,
              },
            }
          : {}),
      })
    ),
  };
}

function createCustomLinksGapSourceReader(sourceData: ProfileLinkGapSourceData): {
  loadProfileLinkGapSourceData: ReturnType<typeof vi.fn>;
  sourceReader: LinksGapSourceReader;
} {
  const loadProfileLinkGapSourceData = vi.fn().mockResolvedValue(ok(sourceData));

  return {
    loadProfileLinkGapSourceData,
    sourceReader: {
      loadProfileLinkGapSourceData,
    },
  };
}

describe('links-gaps-browse-support', () => {
  it('orders gap browsing data chronologically', async () => {
    const analysis = createMockGapAnalysis();
    analysis.issues = [analysis.issues[2]!, analysis.issues[0]!, analysis.issues[1]!];
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis,
      hiddenResolvedIssueCount: 0,
    });

    const result = await buildLinksGapsBrowsePresentation(
      createLinksGapSourceReader(createProfileLinkGapSourceData(analysis)).sourceReader,
      {}
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.gaps.map((gap) => gap.gapIssue.txFingerprint)).toEqual([
      'eth-inflow-1',
      'eth-inflow-2',
      'kraken-outflow-1',
    ]);
    expect(result.value.state.linkAnalysis.issues.map((issue) => issue.txFingerprint)).toEqual([
      'eth-inflow-1',
      'eth-inflow-2',
      'kraken-outflow-1',
    ]);
  });

  it('loads gap analysis from the shared profile gap source reader seam', async () => {
    const analysis = createMockGapAnalysis();
    const sourceData = createProfileLinkGapSourceData(analysis);
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis,
      hiddenResolvedIssueCount: 1,
    });
    const sourceReader = createLinksGapSourceReader(sourceData);

    const result = await buildLinksGapsBrowsePresentation(sourceReader.sourceReader, {});

    expect(result.isOk()).toBe(true);
    expect(sourceReader.loadProfileLinkGapSourceData).toHaveBeenCalledTimes(1);
    expect(mockBuildVisibleProfileLinkGapAnalysis).toHaveBeenCalledWith(sourceData);
  });

  it('treats same-transaction gap rows as distinct selector targets', async () => {
    const analysis = createMockGapAnalysis();
    const secondGap = {
      ...analysis.issues[0]!,
      assetId: 'blockchain:ethereum:0xusdc',
      assetSymbol: 'USDC',
      missingAmount: '25',
      totalAmount: '25',
    };
    analysis.issues = [analysis.issues[0]!, secondGap, analysis.issues[1]!];
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis,
      hiddenResolvedIssueCount: 0,
    });

    const secondGapRef = buildLinkGapRef({
      txFingerprint: secondGap.txFingerprint,
      assetId: secondGap.assetId,
      direction: secondGap.direction,
    });
    const result = await buildLinksGapsBrowsePresentation(
      createLinksGapSourceReader(createProfileLinkGapSourceData(analysis)).sourceReader,
      {
        preselectInExplorer: true,
        selector: secondGapRef,
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.selectedGap?.gapRef).toBe(secondGapRef);
    expect(result.value.selectedGap?.gapIssue.assetId).toBe('blockchain:ethereum:0xusdc');
    expect(result.value.selectedGap?.transactionGapCount).toBe(2);
    expect(result.value.state.selectedIndex).toBe(1);
  });

  it('formats gap transaction refs with the transaction ref formatter', async () => {
    const analysis = createMockGapAnalysis();
    analysis.issues = [
      {
        ...analysis.issues[0]!,
        txFingerprint: '1234567890abcdef-gap',
      },
    ];
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis,
      hiddenResolvedIssueCount: 0,
    });

    const result = await buildLinksGapsBrowsePresentation(
      createLinksGapSourceReader(createProfileLinkGapSourceData(analysis)).sourceReader,
      {}
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.gaps[0]?.transactionRef).toBe('1234567890');
  });

  it('attaches exact suggested proposal refs to matching source and target gap rows', async () => {
    const fixture = createConfirmableTransferFixture();
    const proposalRef = buildLinkProposalRef(buildTransferProposalItems([{ link: fixture.link }])[0]!.proposalKey);
    const analysis = {
      issues: [
        {
          transactionId: fixture.sourceTransaction.id,
          txFingerprint: fixture.sourceTransaction.txFingerprint,
          platformKey: fixture.sourceTransaction.platformKey,
          timestamp: fixture.sourceTransaction.datetime,
          assetId: fixture.link.sourceAssetId,
          assetSymbol: fixture.link.assetSymbol,
          missingAmount: '1',
          totalAmount: '1',
          confirmedCoveragePercent: '0',
          operationCategory: fixture.sourceTransaction.operation.category,
          operationType: fixture.sourceTransaction.operation.type,
          suggestedCount: 1,
          highestSuggestedConfidencePercent: '99.0',
          direction: 'outflow' as const,
        },
        {
          transactionId: fixture.targetTransaction.id,
          txFingerprint: fixture.targetTransaction.txFingerprint,
          platformKey: fixture.targetTransaction.platformKey,
          timestamp: fixture.targetTransaction.datetime,
          assetId: fixture.link.targetAssetId,
          assetSymbol: fixture.link.assetSymbol,
          missingAmount: '1',
          totalAmount: '1',
          confirmedCoveragePercent: '0',
          operationCategory: fixture.targetTransaction.operation.category,
          operationType: fixture.targetTransaction.operation.type,
          suggestedCount: 1,
          highestSuggestedConfidencePercent: '99.0',
          direction: 'inflow' as const,
        },
      ],
      summary: {
        total_issues: 2,
        uncovered_inflows: 1,
        unmatched_outflows: 1,
        affected_assets: 1,
        assets: [
          {
            assetSymbol: fixture.link.assetSymbol,
            inflowOccurrences: 1,
            inflowMissingAmount: '1',
            outflowOccurrences: 1,
            outflowMissingAmount: '1',
          },
        ],
      },
    };
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis,
      hiddenResolvedIssueCount: 0,
    });
    const sourceReader = createCustomLinksGapSourceReader({
      accounts: [],
      excludedAssetIds: new Set<string>(),
      links: [fixture.link],
      resolvedIssueKeys: new Set<string>(),
      transactions: fixture.transactions,
    });

    const result = await buildLinksGapsBrowsePresentation(sourceReader.sourceReader, {});

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.gaps.map((gap) => gap.suggestedProposalRefs)).toEqual([[proposalRef], [proposalRef]]);
  });

  it('attaches exact opposite-direction transfer matches from other profiles as gap counterparts', async () => {
    const gapTx = createPersistedTransaction({
      id: 10,
      accountId: 1,
      txFingerprint: 'kraken-gap-1',
      platformKey: 'kraken',
      platformKind: 'exchange',
      datetime: '2024-05-19T11:31:53.000Z',
      timestamp: Date.parse('2024-05-19T11:31:53.000Z'),
      status: 'success',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'exchange:kraken:usdc',
            assetSymbol: 'USDC' as Currency,
            grossAmount: parseDecimal('99'),
            netAmount: parseDecimal('99'),
          },
        ],
      },
      fees: [],
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
    });
    const counterpartTx = createPersistedTransaction({
      id: 20,
      accountId: 2,
      txFingerprint: 'other-profile-inflow-1',
      platformKey: 'solana',
      platformKind: 'blockchain',
      datetime: '2024-05-19T11:32:08.000Z',
      timestamp: Date.parse('2024-05-19T11:32:08.000Z'),
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'blockchain:solana:usdc',
            assetSymbol: 'USDC' as Currency,
            grossAmount: parseDecimal('99'),
            netAmount: parseDecimal('99'),
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
        name: 'solana',
        transaction_hash: 'sol-hash-1',
        is_confirmed: true,
      },
    });
    const analysis = {
      issues: [
        {
          transactionId: gapTx.id,
          txFingerprint: gapTx.txFingerprint,
          platformKey: gapTx.platformKey,
          timestamp: gapTx.datetime,
          assetId: 'exchange:kraken:usdc',
          assetSymbol: 'USDC',
          missingAmount: '99',
          totalAmount: '99',
          confirmedCoveragePercent: '0',
          operationCategory: gapTx.operation.category,
          operationType: gapTx.operation.type,
          suggestedCount: 0,
          direction: 'outflow' as const,
        },
      ],
      summary: {
        total_issues: 1,
        uncovered_inflows: 0,
        unmatched_outflows: 1,
        affected_assets: 1,
        assets: [
          {
            assetSymbol: 'USDC',
            inflowOccurrences: 0,
            inflowMissingAmount: '0',
            outflowOccurrences: 1,
            outflowMissingAmount: '99',
          },
        ],
      },
    };
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis,
      hiddenResolvedIssueCount: 0,
    });
    const sourceReader = createCustomLinksGapSourceReader({
      accounts: [
        {
          id: 1,
          profileId: 1,
          accountType: 'exchange-api',
          platformKey: 'kraken',
          identifier: 'kraken-account',
          accountFingerprint: 'acct-fp-1',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      ],
      excludedAssetIds: new Set<string>(),
      links: [],
      resolvedIssueKeys: new Set<string>(),
      transactions: [gapTx],
    });

    const result = await buildLinksGapsBrowsePresentation(
      sourceReader.sourceReader,
      {},
      {
        crossProfileGapCounterpartSource: {
          accounts: [
            { id: 1, profileId: 1 },
            { id: 2, profileId: 2 },
          ],
          activeProfileId: 1,
          profiles: [
            { id: 1, profileKey: 'default', displayName: 'default' },
            { id: 2, profileKey: 'maely', displayName: 'maely' },
          ],
          transactions: [gapTx, counterpartTx],
        },
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.gaps[0]?.crossProfileCandidates).toEqual([
      {
        amount: '99',
        direction: 'inflow',
        platformKey: 'solana',
        profileDisplayName: 'maely',
        profileKey: 'maely',
        secondsDeltaFromGap: 15,
        timestamp: counterpartTx.datetime,
        transactionRef: formatTransactionFingerprintRef(counterpartTx.txFingerprint),
        txFingerprint: counterpartTx.txFingerprint,
      },
    ]);
  });

  it('derives owned endpoint ownership and same-hash sibling refs from the profile gap source data', async () => {
    const txOne = createPersistedTransaction({
      id: 10,
      accountId: 1,
      txFingerprint: 'btc-gap-1',
      platformKey: 'bitcoin',
      platformKind: 'blockchain',
      datetime: '2024-07-05T11:37:19.000Z',
      timestamp: Date.parse('2024-07-05T11:37:19.000Z'),
      status: 'success',
      from: 'bc1qtrackedsource',
      to: '3J11externaldest',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('1'),
          },
        ],
      },
      fees: [],
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
      blockchain: {
        name: 'bitcoin',
        transaction_hash: 'shared-hash',
        is_confirmed: true,
      },
    });
    const txTwo = createPersistedTransaction({
      id: 11,
      accountId: 2,
      txFingerprint: 'btc-gap-2',
      platformKey: 'bitcoin',
      platformKind: 'blockchain',
      datetime: '2024-07-05T11:37:19.000Z',
      timestamp: Date.parse('2024-07-05T11:37:19.000Z'),
      status: 'success',
      from: 'bc1qtrackedsecond',
      to: '3J11externaldest',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('1'),
          },
        ],
      },
      fees: [],
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
      blockchain: {
        name: 'bitcoin',
        transaction_hash: 'shared-hash',
        is_confirmed: true,
      },
    });
    const analysis = {
      issues: [
        {
          transactionId: txOne.id,
          txFingerprint: txOne.txFingerprint,
          platformKey: txOne.platformKey,
          blockchainName: 'bitcoin',
          timestamp: txOne.datetime,
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          missingAmount: '0.5',
          totalAmount: '0.5',
          confirmedCoveragePercent: '0',
          operationCategory: txOne.operation.category,
          operationType: txOne.operation.type,
          suggestedCount: 0,
          direction: 'outflow' as const,
        },
        {
          transactionId: txTwo.id,
          txFingerprint: txTwo.txFingerprint,
          platformKey: txTwo.platformKey,
          blockchainName: 'bitcoin',
          timestamp: txTwo.datetime,
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          missingAmount: '0.4',
          totalAmount: '0.4',
          confirmedCoveragePercent: '0',
          operationCategory: txTwo.operation.category,
          operationType: txTwo.operation.type,
          suggestedCount: 0,
          direction: 'outflow' as const,
        },
      ],
      summary: {
        total_issues: 2,
        uncovered_inflows: 0,
        unmatched_outflows: 2,
        affected_assets: 1,
        assets: [
          {
            assetSymbol: 'BTC',
            inflowOccurrences: 0,
            inflowMissingAmount: '0',
            outflowOccurrences: 2,
            outflowMissingAmount: '0.9',
          },
        ],
      },
    };
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis,
      hiddenResolvedIssueCount: 0,
    });
    const sourceReader = createCustomLinksGapSourceReader({
      accounts: [
        {
          id: 1,
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1qtrackedsource',
          accountFingerprint: 'acct-fp-1',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
        {
          id: 2,
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1qtrackedsecond',
          accountFingerprint: 'acct-fp-2',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      ],
      excludedAssetIds: new Set<string>(),
      links: [],
      resolvedIssueKeys: new Set<string>(),
      transactions: [txOne, txTwo],
    });

    const result = await buildLinksGapsBrowsePresentation(sourceReader.sourceReader, {});

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.gaps[0]?.transactionSnapshot).toEqual({
      blockchainTransactionHash: 'shared-hash',
      from: 'bc1qtrackedsource',
      fromOwnership: 'owned',
      openSameHashGapRowCount: 2,
      openSameHashTransactionRefs: ['btc-gap-1', 'btc-gap-2'],
      to: '3J11externaldest',
      toOwnership: 'unknown',
    });
    expect(result.value.gaps[0]?.relatedContext).toEqual({
      fromAccount: {
        accountName: undefined,
        accountRef: 'acct-fp-1',
        platformKey: 'bitcoin',
      },
      openGapRefs: [result.value.gaps[0]?.gapRef],
      sameHashSiblingTransactionCount: 1,
      sameHashSiblingTransactionRefs: ['btc-gap-2'],
      sharedToTransactionCount: 1,
      sharedToTransactionRefs: ['btc-gap-2'],
    });
  });

  it('marks endpoints owned by another profile as other-profile when a shared ownership lookup is provided', async () => {
    const tx = createPersistedTransaction({
      id: 10,
      accountId: 1,
      txFingerprint: 'btc-gap-1',
      platformKey: 'bitcoin',
      platformKind: 'blockchain',
      datetime: '2024-07-05T11:37:19.000Z',
      timestamp: Date.parse('2024-07-05T11:37:19.000Z'),
      status: 'success',
      from: 'bc1qactiveprofile',
      to: 'bc1qotherprofile',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('1'),
          },
        ],
      },
      fees: [],
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
      blockchain: {
        name: 'bitcoin',
        transaction_hash: 'shared-hash',
        is_confirmed: true,
      },
    });
    const analysis = {
      issues: [
        {
          transactionId: tx.id,
          txFingerprint: tx.txFingerprint,
          platformKey: tx.platformKey,
          blockchainName: 'bitcoin',
          timestamp: tx.datetime,
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          missingAmount: '0.5',
          totalAmount: '0.5',
          confirmedCoveragePercent: '0',
          operationCategory: tx.operation.category,
          operationType: tx.operation.type,
          suggestedCount: 0,
          direction: 'outflow' as const,
        },
      ],
      summary: {
        total_issues: 1,
        uncovered_inflows: 0,
        unmatched_outflows: 1,
        affected_assets: 1,
        assets: [
          {
            assetSymbol: 'BTC',
            inflowOccurrences: 0,
            inflowMissingAmount: '0',
            outflowOccurrences: 1,
            outflowMissingAmount: '0.5',
          },
        ],
      },
    };
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis,
      hiddenResolvedIssueCount: 0,
    });
    const sourceReader = createCustomLinksGapSourceReader({
      accounts: [
        {
          id: 1,
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1qactiveprofile',
          accountFingerprint: 'acct-fp-1',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      ],
      excludedAssetIds: new Set<string>(),
      links: [],
      resolvedIssueKeys: new Set<string>(),
      transactions: [tx],
    });

    const result = await buildLinksGapsBrowsePresentation(
      sourceReader.sourceReader,
      {},
      {
        addressOwnershipLookup: createAddressOwnershipLookup({
          ownedIdentifiers: ['bc1qactiveprofile'],
          otherProfileIdentifiers: ['bc1qotherprofile'],
        }),
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.gaps[0]?.transactionSnapshot).toMatchObject({
      fromOwnership: 'owned',
      toOwnership: 'other-profile',
    });
  });
});
