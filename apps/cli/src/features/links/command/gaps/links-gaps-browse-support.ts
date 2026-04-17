import {
  buildLinkGapIssueKey,
  buildVisibleProfileLinkGapAnalysis,
  type LinkGapAnalysis,
} from '@exitbook/accounting/linking';
import type { IProfileLinkGapSourceReader, ProfileLinkGapSourceData } from '@exitbook/accounting/ports';
import type { Transaction } from '@exitbook/core';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';

import { resolveAddressOwnership } from '../../../shared/address-ownership.js';
import { normalizeBlockchainTransactionHashForGrouping } from '../../../shared/blockchain-transaction-hash-grouping.js';
import { buildTransactionRelatedContext } from '../../../transactions/transaction-investigation-context.js';
import { formatTransactionFingerprintRef } from '../../../transactions/transaction-selector.js';
import {
  buildLinkGapRef,
  buildLinkGapSelector,
  buildLinkProposalRef,
  resolveLinkGapSelector,
} from '../../link-selector.js';
import type { LinkGapBrowseItem, LinkGapBrowseTransactionSnapshot } from '../../links-gaps-browse-model.js';
import { buildTransferProposalItems } from '../../transfer-proposals.js';
import { createGapsViewState } from '../../view/index.js';
import type { LinksViewGapsState } from '../../view/links-view-state.js';

export interface LinksGapsBrowseParams {
  preselectInExplorer?: boolean | undefined;
  selector?: string | undefined;
}

export interface LinksGapsBrowsePresentation {
  gaps: LinkGapBrowseItem[];
  selectedGap?: LinkGapBrowseItem | undefined;
  state: LinksViewGapsState;
}

export async function buildLinksGapsBrowsePresentation(
  sourceReader: IProfileLinkGapSourceReader,
  params: LinksGapsBrowseParams
): Promise<Result<LinksGapsBrowsePresentation, Error>> {
  return resultDoAsync(async function* () {
    const source = yield* await sourceReader.loadProfileLinkGapSourceData();
    const visibility = buildVisibleProfileLinkGapAnalysis(source);
    const sortedAnalysis = sortLinkGapAnalysisByTimestamp(visibility.analysis);
    const gapCountsByTransactionFingerprint = countGapIssuesByTransactionFingerprint(sortedAnalysis);
    const suggestedProposalRefsByIssueKey = yield* buildSuggestedProposalRefsByIssueKey(source);
    const transactionSnapshotByFingerprint = yield* buildGapTransactionSnapshotByFingerprint(source, sortedAnalysis);
    const relatedContextByFingerprint = yield* buildRelatedContextByFingerprint(source, sortedAnalysis);
    const gaps = sortedAnalysis.issues.map((gapIssue) => ({
      gapRef: buildLinkGapRef({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      }),
      gapIssue,
      suggestedProposalRefs: suggestedProposalRefsByIssueKey.get(
        buildLinkGapIssueKey({
          txFingerprint: gapIssue.txFingerprint,
          assetId: gapIssue.assetId,
          direction: gapIssue.direction,
        })
      ),
      relatedContext: relatedContextByFingerprint.get(gapIssue.txFingerprint),
      transactionSnapshot: transactionSnapshotByFingerprint.get(gapIssue.txFingerprint),
      transactionGapCount: gapCountsByTransactionFingerprint.get(gapIssue.txFingerprint) ?? 1,
      transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
    }));
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
  analysis: LinkGapAnalysis
): Result<Map<string, LinkGapBrowseTransactionSnapshot>, Error> {
  const transactionByFingerprint = new Map(
    source.transactions.map((transaction) => [transaction.txFingerprint, transaction])
  );
  const trackedIdentifiers = new Set(source.accounts.map((account) => account.identifier));
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

    snapshots.set(issue.txFingerprint, buildGapTransactionSnapshot(transaction, trackedIdentifiers, sameHashGroup));
  }

  return ok(snapshots);
}

function buildGapTransactionSnapshot(
  transaction: Transaction,
  trackedIdentifiers: ReadonlySet<string>,
  sameHashGroup?: {
    openSameHashGapRowCount: number;
    openSameHashTransactionRefs: string[];
  }
): LinkGapBrowseTransactionSnapshot {
  return {
    blockchainTransactionHash: transaction.blockchain?.transaction_hash,
    from: transaction.from,
    fromOwnership: resolveAddressOwnership(transaction.from, trackedIdentifiers),
    ...(sameHashGroup !== undefined && sameHashGroup.openSameHashTransactionRefs.length > 1
      ? {
          openSameHashGapRowCount: sameHashGroup.openSameHashGapRowCount,
          openSameHashTransactionRefs: sameHashGroup.openSameHashTransactionRefs,
        }
      : {}),
    to: transaction.to,
    toOwnership: resolveAddressOwnership(transaction.to, trackedIdentifiers),
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
