import {
  buildLinkGapIssueKey,
  buildVisibleProfileLinkGapAnalysis,
  type LinkGapAnalysis,
  type LinkGapIssue,
} from '@exitbook/accounting/linking';
import type { IProfileLinkGapSourceReader, ProfileLinkGapSourceData } from '@exitbook/accounting/ports';
import type { Account, Profile, Transaction } from '@exitbook/core';
import { err, ok, parseDecimal, resultDoAsync, type Result } from '@exitbook/foundation';

import {
  createAddressOwnershipLookup,
  resolveAddressOwnership,
  type AddressOwnershipLookup,
} from '../../../shared/address-ownership.js';
import { normalizeBlockchainTransactionHashForGrouping } from '../../../shared/blockchain-transaction-hash-grouping.js';
import { buildTransactionRelatedContext } from '../../../transactions/transaction-investigation-context.js';
import { formatTransactionFingerprintRef } from '../../../transactions/transaction-selector.js';
import {
  buildLinkGapRef,
  buildLinkGapSelector,
  buildLinkProposalRef,
  resolveLinkGapSelector,
} from '../../link-selector.js';
import type {
  LinkGapBrowseCrossProfileCandidate,
  LinkGapBrowseItem,
  LinkGapBrowseTransactionSnapshot,
} from '../../links-gaps-browse-model.js';
import { buildTransferProposalItems } from '../../transfer-proposals.js';
import { createGapsViewState } from '../../view/index.js';
import type { LinksViewGapsState } from '../../view/links-view-state.js';

const CROSS_PROFILE_GAP_COUNTERPART_WINDOW_SECONDS = 60 * 60;
const MAX_CROSS_PROFILE_GAP_COUNTERPARTS = 3;

export interface LinksGapsBrowseParams {
  preselectInExplorer?: boolean | undefined;
  selector?: string | undefined;
}

export interface LinksGapsBrowsePresentation {
  gaps: LinkGapBrowseItem[];
  selectedGap?: LinkGapBrowseItem | undefined;
  state: LinksViewGapsState;
}

interface CrossProfileGapCounterpartSource {
  accounts: readonly Pick<Account, 'id' | 'profileId'>[];
  activeProfileId: number;
  profiles: readonly Pick<Profile, 'displayName' | 'id' | 'profileKey'>[];
  transactions: readonly Transaction[];
}

interface IndexedCrossProfileGapCounterpart extends Omit<LinkGapBrowseCrossProfileCandidate, 'secondsDeltaFromGap'> {
  timestampMs: number;
}

export async function buildLinksGapsBrowsePresentation(
  sourceReader: IProfileLinkGapSourceReader,
  params: LinksGapsBrowseParams,
  options?: {
    addressOwnershipLookup?: AddressOwnershipLookup | undefined;
    crossProfileGapCounterpartSource?: CrossProfileGapCounterpartSource | undefined;
  }
): Promise<Result<LinksGapsBrowsePresentation, Error>> {
  return resultDoAsync(async function* () {
    const source = yield* await sourceReader.loadProfileLinkGapSourceData();
    const visibility = buildVisibleProfileLinkGapAnalysis(source);
    const sortedAnalysis = sortLinkGapAnalysisByTimestamp(visibility.analysis);
    const gapCountsByTransactionFingerprint = countGapIssuesByTransactionFingerprint(sortedAnalysis);
    const suggestedProposalRefsByIssueKey = yield* buildSuggestedProposalRefsByIssueKey(source);
    const crossProfileCandidatesByIssueKey = buildCrossProfileGapCounterpartsByIssueKey(
      sortedAnalysis.issues,
      options?.crossProfileGapCounterpartSource
    );
    const addressOwnershipLookup =
      options?.addressOwnershipLookup ??
      createAddressOwnershipLookup({
        ownedIdentifiers: source.accounts.map((account) => account.identifier),
      });
    const transactionSnapshotByFingerprint = yield* buildGapTransactionSnapshotByFingerprint(
      source,
      sortedAnalysis,
      addressOwnershipLookup
    );
    const relatedContextByFingerprint = yield* buildRelatedContextByFingerprint(source, sortedAnalysis);
    const gaps = sortedAnalysis.issues.map((gapIssue) => {
      const issueKey = buildLinkGapIssueKey({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      });

      return {
        crossProfileCandidates: crossProfileCandidatesByIssueKey.get(issueKey),
        gapRef: buildLinkGapRef({
          txFingerprint: gapIssue.txFingerprint,
          assetId: gapIssue.assetId,
          direction: gapIssue.direction,
        }),
        gapIssue,
        suggestedProposalRefs: suggestedProposalRefsByIssueKey.get(issueKey),
        relatedContext: relatedContextByFingerprint.get(gapIssue.txFingerprint),
        transactionSnapshot: transactionSnapshotByFingerprint.get(gapIssue.txFingerprint),
        transactionGapCount: gapCountsByTransactionFingerprint.get(gapIssue.txFingerprint) ?? 1,
        transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
      };
    });
    const state = createGapsViewState(
      sortedAnalysis,
      {
        hiddenResolvedIssueCount: visibility.hiddenResolvedIssueCount,
      },
      gaps
    );
    const resolvedGap =
      params.selector !== undefined ? yield* resolveLinkGapSelector(toGapCandidates(gaps), params.selector) : undefined;
    const selectedGap = resolvedGap?.item;
    if (params.preselectInExplorer && selectedGap) {
      preselectGapsState(state, gaps, selectedGap);
    }

    return {
      gaps,
      selectedGap,
      state,
    };
  });
}

function buildRelatedContextByFingerprint(
  source: ProfileLinkGapSourceData,
  analysis: LinkGapAnalysis
): Result<Map<string, NonNullable<LinkGapBrowseItem['relatedContext']>>, Error> {
  const transactionByFingerprint = new Map(
    source.transactions.map((transaction) => [transaction.txFingerprint, transaction])
  );
  const contexts = new Map<string, NonNullable<LinkGapBrowseItem['relatedContext']>>();

  for (const issue of analysis.issues) {
    const transaction = transactionByFingerprint.get(issue.txFingerprint);
    if (transaction === undefined) {
      return err(new Error(`Gap transaction ${issue.txFingerprint} missing from profile gap source data`));
    }

    const relatedContext = buildTransactionRelatedContext(source, transaction, {
      visibleGapIssues: analysis.issues,
    });
    if (relatedContext !== undefined) {
      contexts.set(issue.txFingerprint, relatedContext);
    }
  }

  return ok(contexts);
}

function toGapCandidates(gaps: LinkGapBrowseItem[]): { gapSelector: string; item: LinkGapBrowseItem }[] {
  return gaps.map((gap) => ({
    gapSelector: buildLinkGapSelector({
      txFingerprint: gap.gapIssue.txFingerprint,
      assetId: gap.gapIssue.assetId,
      direction: gap.gapIssue.direction,
    }),
    item: gap,
  }));
}

function preselectGapsState(
  state: LinksViewGapsState,
  gaps: LinkGapBrowseItem[],
  selectedGap: LinkGapBrowseItem
): void {
  const selectedIndex = gaps.findIndex((gap) => gap.gapRef === selectedGap.gapRef);
  if (selectedIndex < 0) {
    return;
  }

  state.selectedIndex = selectedIndex;
  state.scrollOffset = selectedIndex;
}

function sortLinkGapAnalysisByTimestamp(analysis: LinkGapAnalysis): LinkGapAnalysis {
  return {
    ...analysis,
    issues: [...analysis.issues].sort(compareLinkGapIssuesByTimestamp),
  };
}

function countGapIssuesByTransactionFingerprint(analysis: LinkGapAnalysis): Map<string, number> {
  const counts = new Map<string, number>();

  for (const issue of analysis.issues) {
    counts.set(issue.txFingerprint, (counts.get(issue.txFingerprint) ?? 0) + 1);
  }

  return counts;
}

function compareLinkGapIssuesByTimestamp(
  left: LinkGapAnalysis['issues'][number],
  right: LinkGapAnalysis['issues'][number]
): number {
  const leftTimestamp = Date.parse(left.timestamp);
  const rightTimestamp = Date.parse(right.timestamp);

  if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp) && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }

  const timestampCompare = left.timestamp.localeCompare(right.timestamp);
  if (timestampCompare !== 0) {
    return timestampCompare;
  }

  if (left.transactionId !== right.transactionId) {
    return left.transactionId - right.transactionId;
  }

  const directionCompare = left.direction.localeCompare(right.direction);
  if (directionCompare !== 0) {
    return directionCompare;
  }

  const assetCompare = left.assetSymbol.localeCompare(right.assetSymbol);
  if (assetCompare !== 0) {
    return assetCompare;
  }

  const assetIdCompare = left.assetId.localeCompare(right.assetId);
  if (assetIdCompare !== 0) {
    return assetIdCompare;
  }

  return left.txFingerprint.localeCompare(right.txFingerprint);
}

function buildGapTransactionSnapshotByFingerprint(
  source: ProfileLinkGapSourceData,
  analysis: LinkGapAnalysis,
  addressOwnershipLookup: AddressOwnershipLookup
): Result<Map<string, LinkGapBrowseTransactionSnapshot>, Error> {
  const transactionByFingerprint = new Map(
    source.transactions.map((transaction) => [transaction.txFingerprint, transaction])
  );
  const sameHashGroupByNormalizedHash = buildOpenSameHashGroupByNormalizedHash(source.transactions, analysis);
  const snapshots = new Map<string, LinkGapBrowseTransactionSnapshot>();

  for (const issue of analysis.issues) {
    const transaction = transactionByFingerprint.get(issue.txFingerprint);
    if (transaction === undefined) {
      return err(new Error(`Gap transaction ${issue.txFingerprint} missing from profile gap source data`));
    }

    const sameHashGroup =
      transaction.blockchain !== undefined
        ? sameHashGroupByNormalizedHash.get(
            normalizeBlockchainTransactionHashForGrouping(transaction.blockchain.transaction_hash)
          )
        : undefined;

    snapshots.set(issue.txFingerprint, buildGapTransactionSnapshot(transaction, addressOwnershipLookup, sameHashGroup));
  }

  return ok(snapshots);
}

function buildGapTransactionSnapshot(
  transaction: Transaction,
  addressOwnershipLookup: AddressOwnershipLookup,
  sameHashGroup?: {
    openSameHashGapRowCount: number;
    openSameHashTransactionRefs: string[];
  }
): LinkGapBrowseTransactionSnapshot {
  return {
    blockchainTransactionHash: transaction.blockchain?.transaction_hash,
    from: transaction.from,
    fromOwnership: resolveAddressOwnership(transaction.from, addressOwnershipLookup),
    ...(sameHashGroup !== undefined && sameHashGroup.openSameHashTransactionRefs.length > 1
      ? {
          openSameHashGapRowCount: sameHashGroup.openSameHashGapRowCount,
          openSameHashTransactionRefs: sameHashGroup.openSameHashTransactionRefs,
        }
      : {}),
    to: transaction.to,
    toOwnership: resolveAddressOwnership(transaction.to, addressOwnershipLookup),
  };
}

function buildOpenSameHashGroupByNormalizedHash(
  transactions: readonly Transaction[],
  analysis: LinkGapAnalysis
): Map<
  string,
  {
    openSameHashGapRowCount: number;
    openSameHashTransactionRefs: string[];
  }
> {
  const transactionByFingerprint = new Map(transactions.map((transaction) => [transaction.txFingerprint, transaction]));
  const groupByNormalizedHash = new Map<
    string,
    {
      gapRowCount: number;
      transactionRefs: Set<string>;
    }
  >();

  for (const issue of analysis.issues) {
    const transaction = transactionByFingerprint.get(issue.txFingerprint);
    const blockchainHash = transaction?.blockchain?.transaction_hash;
    if (blockchainHash === undefined) {
      continue;
    }

    const normalizedHash = normalizeBlockchainTransactionHashForGrouping(blockchainHash);
    const group = groupByNormalizedHash.get(normalizedHash) ?? {
      gapRowCount: 0,
      transactionRefs: new Set<string>(),
    };
    group.gapRowCount += 1;
    group.transactionRefs.add(formatTransactionFingerprintRef(issue.txFingerprint));
    groupByNormalizedHash.set(normalizedHash, group);
  }

  return new Map(
    [...groupByNormalizedHash.entries()].map(([normalizedHash, group]) => [
      normalizedHash,
      {
        openSameHashGapRowCount: group.gapRowCount,
        openSameHashTransactionRefs: [...group.transactionRefs].sort(),
      },
    ])
  );
}

function buildSuggestedProposalRefsByIssueKey(source: ProfileLinkGapSourceData): Result<Map<string, string[]>, Error> {
  const txFingerprintByTransactionId = new Map(
    source.transactions.map((transaction) => [transaction.id, transaction.txFingerprint])
  );
  const proposalRefsByIssueKey = new Map<string, Set<string>>();
  const suggestedProposalItems = buildTransferProposalItems(
    source.links.filter((link) => link.status === 'suggested').map((link) => ({ link }))
  );

  for (const proposalItem of suggestedProposalItems) {
    const proposalRef = buildLinkProposalRef(proposalItem.proposalKey);

    for (const item of proposalItem.items) {
      const sourceTxFingerprint = txFingerprintByTransactionId.get(item.link.sourceTransactionId);
      if (sourceTxFingerprint === undefined) {
        return err(
          new Error(
            `Suggested link ${item.link.id} source transaction ${item.link.sourceTransactionId} missing from profile gap source data`
          )
        );
      }

      const targetTxFingerprint = txFingerprintByTransactionId.get(item.link.targetTransactionId);
      if (targetTxFingerprint === undefined) {
        return err(
          new Error(
            `Suggested link ${item.link.id} target transaction ${item.link.targetTransactionId} missing from profile gap source data`
          )
        );
      }

      appendSuggestedProposalRef(
        proposalRefsByIssueKey,
        buildLinkGapIssueKey({
          txFingerprint: sourceTxFingerprint,
          assetId: item.link.sourceAssetId,
          direction: 'outflow',
        }),
        proposalRef
      );
      appendSuggestedProposalRef(
        proposalRefsByIssueKey,
        buildLinkGapIssueKey({
          txFingerprint: targetTxFingerprint,
          assetId: item.link.targetAssetId,
          direction: 'inflow',
        }),
        proposalRef
      );
    }
  }

  return ok(new Map([...proposalRefsByIssueKey.entries()].map(([issueKey, refs]) => [issueKey, [...refs].sort()])));
}

function appendSuggestedProposalRef(
  proposalRefsByIssueKey: Map<string, Set<string>>,
  issueKey: string,
  proposalRef: string
): void {
  const refs = proposalRefsByIssueKey.get(issueKey) ?? new Set<string>();
  refs.add(proposalRef);
  proposalRefsByIssueKey.set(issueKey, refs);
}

function buildCrossProfileGapCounterpartsByIssueKey(
  issues: readonly LinkGapIssue[],
  source?: CrossProfileGapCounterpartSource
): Map<string, LinkGapBrowseCrossProfileCandidate[]> {
  if (source === undefined || issues.length === 0 || source.profiles.length < 2) {
    return new Map();
  }

  const counterpartLookup = buildCrossProfileCounterpartLookup(source);
  const candidatesByIssueKey = new Map<string, LinkGapBrowseCrossProfileCandidate[]>();

  for (const issue of issues) {
    const issueTimestampMs = Date.parse(issue.timestamp);
    if (Number.isNaN(issueTimestampMs)) {
      continue;
    }

    const oppositeDirection = issue.direction === 'inflow' ? 'outflow' : 'inflow';
    const lookupKey = buildCrossProfileCounterpartLookupKey(oppositeDirection, issue.assetSymbol, issue.missingAmount);
    const counterpartCandidates = counterpartLookup.get(lookupKey);

    if (counterpartCandidates === undefined || counterpartCandidates.length === 0) {
      continue;
    }

    const matchingCandidates = counterpartCandidates
      .filter(
        (candidate) =>
          Math.abs(candidate.timestampMs - issueTimestampMs) / 1000 <= CROSS_PROFILE_GAP_COUNTERPART_WINDOW_SECONDS
      )
      .map((candidate) => ({
        amount: candidate.amount,
        direction: candidate.direction,
        platformKey: candidate.platformKey,
        profileDisplayName: candidate.profileDisplayName,
        profileKey: candidate.profileKey,
        secondsDeltaFromGap: Math.round((candidate.timestampMs - issueTimestampMs) / 1000),
        timestamp: candidate.timestamp,
        transactionRef: candidate.transactionRef,
        txFingerprint: candidate.txFingerprint,
      }))
      .sort(compareCrossProfileGapCounterparts)
      .slice(0, MAX_CROSS_PROFILE_GAP_COUNTERPARTS);

    if (matchingCandidates.length === 0) {
      continue;
    }

    candidatesByIssueKey.set(
      buildLinkGapIssueKey({
        txFingerprint: issue.txFingerprint,
        assetId: issue.assetId,
        direction: issue.direction,
      }),
      matchingCandidates
    );
  }

  return candidatesByIssueKey;
}

function buildCrossProfileCounterpartLookup(
  source: CrossProfileGapCounterpartSource
): Map<string, IndexedCrossProfileGapCounterpart[]> {
  const profileIdByAccountId = new Map(source.accounts.map((account) => [account.id, account.profileId]));
  const profileById = new Map(source.profiles.map((profile) => [profile.id, profile]));
  const counterpartLookup = new Map<string, IndexedCrossProfileGapCounterpart[]>();

  for (const transaction of source.transactions) {
    const profileId = profileIdByAccountId.get(transaction.accountId);
    if (
      profileId === undefined ||
      profileId === source.activeProfileId ||
      transaction.operation.category !== 'transfer'
    ) {
      continue;
    }

    const profile = profileById.get(profileId);
    if (profile === undefined) {
      continue;
    }

    const timestampMs = Date.parse(transaction.datetime);
    if (Number.isNaN(timestampMs)) {
      continue;
    }

    const seenLookupKeys = new Set<string>();
    for (const movement of listCrossProfileCounterpartMovements(transaction)) {
      const lookupKey = buildCrossProfileCounterpartLookupKey(
        movement.direction,
        movement.assetSymbol,
        movement.amount
      );
      const dedupeKey = `${lookupKey}|${transaction.txFingerprint}`;
      if (seenLookupKeys.has(dedupeKey)) {
        continue;
      }

      seenLookupKeys.add(dedupeKey);
      const counterparts = counterpartLookup.get(lookupKey) ?? [];
      counterparts.push({
        amount: movement.amount,
        direction: movement.direction,
        platformKey: transaction.platformKey,
        profileDisplayName: profile.displayName,
        profileKey: profile.profileKey,
        timestamp: transaction.datetime,
        timestampMs,
        transactionRef: formatTransactionFingerprintRef(transaction.txFingerprint),
        txFingerprint: transaction.txFingerprint,
      });
      counterpartLookup.set(lookupKey, counterparts);
    }
  }

  return counterpartLookup;
}

function listCrossProfileCounterpartMovements(
  transaction: Transaction
): { amount: string; assetSymbol: string; direction: 'inflow' | 'outflow' }[] {
  const movements: { amount: string; assetSymbol: string; direction: 'inflow' | 'outflow' }[] = [];

  for (const inflow of transaction.movements.inflows ?? []) {
    movements.push({
      amount: inflow.grossAmount.toFixed(),
      assetSymbol: inflow.assetSymbol,
      direction: 'inflow',
    });
  }

  for (const outflow of transaction.movements.outflows ?? []) {
    movements.push({
      amount: outflow.grossAmount.toFixed(),
      assetSymbol: outflow.assetSymbol,
      direction: 'outflow',
    });
  }

  return movements;
}

function buildCrossProfileCounterpartLookupKey(
  direction: 'inflow' | 'outflow',
  assetSymbol: string,
  amount: string
): string {
  return `${direction}|${assetSymbol.trim().toUpperCase()}|${parseDecimal(amount).toFixed()}`;
}

function compareCrossProfileGapCounterparts(
  left: LinkGapBrowseCrossProfileCandidate,
  right: LinkGapBrowseCrossProfileCandidate
): number {
  const deltaDifference = Math.abs(left.secondsDeltaFromGap) - Math.abs(right.secondsDeltaFromGap);
  if (deltaDifference !== 0) {
    return deltaDifference;
  }

  const timestampCompare = left.timestamp.localeCompare(right.timestamp);
  if (timestampCompare !== 0) {
    return timestampCompare;
  }

  const profileCompare = left.profileDisplayName.localeCompare(right.profileDisplayName);
  if (profileCompare !== 0) {
    return profileCompare;
  }

  return left.txFingerprint.localeCompare(right.txFingerprint);
}
