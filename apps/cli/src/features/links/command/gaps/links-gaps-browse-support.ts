import { loadVisibleProfileLinkGapAnalysis, type LinkGapAnalysis } from '@exitbook/accounting/linking';
import type { IProfileLinkGapSourceReader } from '@exitbook/accounting/ports';
import { err, ok, type Result } from '@exitbook/foundation';

import { formatTransactionFingerprintRef } from '../../../transactions/transaction-selector.js';
import { buildLinkGapRef, buildLinkGapSelector, resolveLinkGapSelector } from '../../link-selector.js';
import type { LinkGapBrowseItem } from '../../links-gaps-browse-model.js';
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
  const loadedGapAnalysisResult = await loadVisibleProfileLinkGapAnalysis(sourceReader);
  if (loadedGapAnalysisResult.isErr()) {
    return err(loadedGapAnalysisResult.error);
  }

  const sortedAnalysis = sortLinkGapAnalysisByTimestamp(loadedGapAnalysisResult.value.analysis);
  const state = createGapsViewState(sortedAnalysis, {
    hiddenResolvedIssueCount: loadedGapAnalysisResult.value.hiddenResolvedIssueCount,
  });
  const gapCountsByTransactionFingerprint = countGapIssuesByTransactionFingerprint(sortedAnalysis);
  const gaps = sortedAnalysis.issues.map((gapIssue) => ({
    gapRef: buildLinkGapRef({
      txFingerprint: gapIssue.txFingerprint,
      assetId: gapIssue.assetId,
      direction: gapIssue.direction,
    }),
    gapIssue,
    transactionGapCount: gapCountsByTransactionFingerprint.get(gapIssue.txFingerprint) ?? 1,
    transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
  }));
  const selectedGapResult =
    params.selector !== undefined ? resolveLinkGapSelector(toGapCandidates(gaps), params.selector) : ok(undefined);
  if (selectedGapResult.isErr()) {
    return err(selectedGapResult.error);
  }

  const selectedGap = selectedGapResult.value?.item;
  if (params.preselectInExplorer && selectedGap) {
    preselectGapsState(state, gaps, selectedGap);
  }

  return ok({
    gaps,
    selectedGap,
    state,
  });
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
