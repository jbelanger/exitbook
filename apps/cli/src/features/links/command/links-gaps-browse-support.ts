import { err, ok, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { formatLinkSelectorRef, resolveLinkGapSelector } from '../link-selector.js';
import type { LinkGapAnalysis } from '../links-gap-model.js';
import type { LinkGapBrowseItem } from '../links-gaps-browse-model.js';
import { createGapsViewState } from '../view/index.js';
import type { LinksViewGapsState } from '../view/links-view-state.js';

import { loadLinksGapAnalysis } from './links-gap-analysis-support.js';

type LinksGapsCommandDatabase = Awaited<ReturnType<CommandRuntime['database']>>;

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
  database: LinksGapsCommandDatabase,
  profileId: number,
  params: LinksGapsBrowseParams,
  excludedAssetIds?: ReadonlySet<string>,
  resolvedTransactionFingerprints?: ReadonlySet<string>
): Promise<Result<LinksGapsBrowsePresentation, Error>> {
  const loadedGapAnalysisResult = await loadLinksGapAnalysis(database, profileId, {
    excludedAssetIds,
    resolvedTransactionFingerprints,
  });
  if (loadedGapAnalysisResult.isErr()) {
    return err(loadedGapAnalysisResult.error);
  }

  const sortedAnalysis = sortLinkGapAnalysisByTimestamp(loadedGapAnalysisResult.value.analysis);
  const state = createGapsViewState(sortedAnalysis, {
    hiddenResolvedIssueCount: loadedGapAnalysisResult.value.hiddenResolvedIssueCount,
    hiddenResolvedTransactionCount: loadedGapAnalysisResult.value.hiddenResolvedTransactionCount,
  });
  const gapCountsByTransactionFingerprint = countGapIssuesByTransactionFingerprint(sortedAnalysis);
  const gaps = sortedAnalysis.issues.map((gapIssue) => ({
    gapIssue,
    transactionGapCount: gapCountsByTransactionFingerprint.get(gapIssue.txFingerprint) ?? 1,
    transactionRef: formatLinkSelectorRef(gapIssue.txFingerprint),
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

function toGapCandidates(gaps: LinkGapBrowseItem[]): { item: LinkGapBrowseItem; txFingerprint: string }[] {
  return gaps.map((gap) => ({
    item: gap,
    txFingerprint: gap.gapIssue.txFingerprint,
  }));
}

function preselectGapsState(
  state: LinksViewGapsState,
  gaps: LinkGapBrowseItem[],
  selectedGap: LinkGapBrowseItem
): void {
  const selectedIndex = gaps.findIndex((gap) => gap.gapIssue.txFingerprint === selectedGap.gapIssue.txFingerprint);
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

  return left.txFingerprint.localeCompare(right.txFingerprint);
}
