import { err, ok, type Result } from '@exitbook/foundation';

import { jsonSuccess, textSuccess, type CliCompletion } from '../../../../cli/command.js';
import { buildDefinedFilters, buildViewMeta } from '../../../shared/view-utils.js';
import type { LinkGapBrowseItem } from '../../links-gaps-browse-model.js';
import { outputLinkGapStaticDetail, outputLinkGapsStaticList } from '../../view/links-static-renderer.js';

import type { LinksGapsBrowseParams, LinksGapsBrowsePresentation } from './links-gaps-browse-support.js';

export function hasNavigableLinksGapsBrowseItems(browsePresentation: LinksGapsBrowsePresentation): boolean {
  return browsePresentation.gaps.length > 0;
}

export function buildLinksGapsBrowseCompletion(
  browsePresentation: LinksGapsBrowsePresentation,
  staticKind: 'detail' | 'list',
  outputMode: 'json' | 'static',
  params: LinksGapsBrowseParams
): Result<CliCompletion, Error> {
  if (outputMode === 'json') {
    return ok(buildLinksGapsBrowseJsonCompletion(browsePresentation, staticKind, params));
  }

  if (staticKind === 'detail') {
    if (!browsePresentation.selectedGap) {
      return err(new Error('Expected a selected link gap'));
    }

    return ok(
      textSuccess(() => {
        outputLinkGapStaticDetail(browsePresentation.selectedGap!);
      })
    );
  }

  return ok(
    textSuccess(() => {
      outputLinkGapsStaticList(browsePresentation.state, browsePresentation.gaps);
    })
  );
}

function buildLinksGapsBrowseJsonCompletion(
  browsePresentation: LinksGapsBrowsePresentation,
  staticKind: 'detail' | 'list',
  params: LinksGapsBrowseParams
): CliCompletion {
  if (staticKind === 'detail') {
    return jsonSuccess(
      {
        data: browsePresentation.selectedGap ? serializeGapDetail(browsePresentation.selectedGap) : undefined,
        meta: buildViewMeta(1, 0, 1, 1, buildDefinedFilters({ transaction: params.selector })),
      },
      undefined
    );
  }

  return jsonSuccess(
    {
      data: browsePresentation.gaps.map(serializeGapSummary),
      meta: buildViewMeta(
        browsePresentation.gaps.length,
        0,
        browsePresentation.gaps.length,
        browsePresentation.state.linkAnalysis.issues.length,
        buildDefinedFilters({
          totalIssues: browsePresentation.state.linkAnalysis.summary.total_issues,
          uncoveredInflows: browsePresentation.state.linkAnalysis.summary.uncovered_inflows,
          unmatchedOutflows: browsePresentation.state.linkAnalysis.summary.unmatched_outflows,
          hiddenResolvedIssues: browsePresentation.state.hiddenResolvedIssueCount,
        })
      ),
    },
    undefined
  );
}

function serializeGapSummary(item: LinkGapBrowseItem): Record<string, unknown> {
  return {
    kind: 'gap',
    ref: item.gapRef,
    transactionRef: item.transactionRef,
    transactionId: item.gapIssue.transactionId,
    transactionGapCount: item.transactionGapCount,
    txFingerprint: item.gapIssue.txFingerprint,
    platformKey: item.gapIssue.platformKey,
    blockchainName: item.gapIssue.blockchainName,
    timestamp: item.gapIssue.timestamp,
    assetId: item.gapIssue.assetId,
    assetSymbol: item.gapIssue.assetSymbol,
    missingAmount: item.gapIssue.missingAmount,
    totalAmount: item.gapIssue.totalAmount,
    confirmedCoveragePercent: item.gapIssue.confirmedCoveragePercent,
    operationCategory: item.gapIssue.operationCategory,
    operationType: item.gapIssue.operationType,
    suggestedCount: item.gapIssue.suggestedCount,
    highestSuggestedConfidencePercent: item.gapIssue.highestSuggestedConfidencePercent,
    direction: item.gapIssue.direction,
    gapCue: item.gapIssue.gapCue,
    contextHint: item.gapIssue.contextHint,
  };
}

function serializeGapDetail(item: LinkGapBrowseItem): Record<string, unknown> {
  return serializeGapSummary(item);
}
