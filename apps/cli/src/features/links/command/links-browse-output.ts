import { err, ok, type Result } from '@exitbook/foundation';

import { jsonSuccess, textSuccess, type CliCompletion } from '../../../cli/command.js';
import { buildDefinedFilters, buildViewMeta } from '../../shared/view-utils.js';
import type { LinkProposalBrowseItem } from '../links-browse-model.js';
import { outputLinkProposalStaticDetail, outputLinksStaticList } from '../view/links-static-renderer.js';
import {
  formatMatchCriteria,
  formatProposalConfidence,
  formatProposalRoute,
  getProposalAmountDisplay,
} from '../view/links-view-formatters.js';

import type { LinksBrowseParams, LinksBrowsePresentation } from './links-browse-support.js';

export function hasNavigableLinksBrowseItems(browsePresentation: LinksBrowsePresentation): boolean {
  return browsePresentation.proposals.length > 0;
}

export function buildLinksBrowseCompletion(
  browsePresentation: LinksBrowsePresentation,
  staticKind: 'detail' | 'list',
  outputMode: 'json' | 'static',
  params: LinksBrowseParams
): Result<CliCompletion, Error> {
  if (outputMode === 'json') {
    return ok(buildLinksBrowseJsonCompletion(browsePresentation, staticKind, params));
  }

  if (staticKind === 'detail') {
    if (!browsePresentation.selectedProposal) {
      return err(new Error('Expected a selected link proposal'));
    }

    return ok(
      textSuccess(() => {
        outputLinkProposalStaticDetail(browsePresentation.selectedProposal!, params.verbose ?? false);
      })
    );
  }

  return ok(
    textSuccess(() => {
      outputLinksStaticList(browsePresentation.state, browsePresentation.proposals);
    })
  );
}

function buildLinksBrowseJsonCompletion(
  browsePresentation: LinksBrowsePresentation,
  staticKind: 'detail' | 'list',
  params: LinksBrowseParams
): CliCompletion {
  if (staticKind === 'detail') {
    return jsonSuccess(
      {
        data: browsePresentation.selectedProposal
          ? serializeProposalDetail(browsePresentation.selectedProposal, params.verbose ?? false)
          : undefined,
        meta: buildViewMeta(1, 0, 1, 1, buildDefinedFilters({ proposal: params.selector })),
      },
      undefined
    );
  }

  return jsonSuccess(
    {
      data: browsePresentation.proposals.map(serializeProposalSummary),
      meta: buildViewMeta(
        browsePresentation.proposals.length,
        0,
        browsePresentation.proposals.length,
        browsePresentation.state.totalCount ?? browsePresentation.proposals.length,
        buildDefinedFilters({
          status: params.status,
          minConfidence: params.minConfidence,
          maxConfidence: params.maxConfidence,
        })
      ),
    },
    undefined
  );
}

function serializeProposalSummary(item: LinkProposalBrowseItem): Record<string, unknown> {
  return {
    kind: 'proposal',
    ref: item.proposalRef,
    assetSymbol: item.proposal.representativeLink.assetSymbol,
    route: formatProposalRoute(item.proposal),
    confidence: formatProposalConfidence(item.proposal).trim(),
    status: item.proposal.status,
    legCount: item.proposal.legs.length,
  };
}

function serializeProposalDetail(item: LinkProposalBrowseItem, verbose: boolean): Record<string, unknown> {
  const amountDisplay = getProposalAmountDisplay(item.proposal);

  return {
    ...serializeProposalSummary(item),
    matchedAmount: amountDisplay.matchedAmount,
    summaryLabel: amountDisplay.detailLabel,
    summary: amountDisplay.detailSummary,
    match: formatMatchCriteria(item.proposal.representativeLink.matchCriteria),
    legs: item.proposal.legs.map((leg) => ({
      linkId: leg.link.id,
      status: leg.link.status,
      sourceTransactionId: leg.link.sourceTransactionId,
      targetTransactionId: leg.link.targetTransactionId,
      sourceAmount: leg.link.sourceAmount.toFixed(),
      targetAmount: leg.link.targetAmount.toFixed(),
      assetSymbol: leg.link.assetSymbol,
      sourcePlatform: leg.sourceTransaction?.platformKey,
      targetPlatform: leg.targetTransaction?.platformKey,
      sourceTimestamp: leg.sourceTransaction?.datetime,
      targetTimestamp: leg.targetTransaction?.datetime,
      sourceAddress: verbose ? leg.sourceTransaction?.from : undefined,
      targetAddress: verbose ? leg.targetTransaction?.to : undefined,
    })),
  };
}
