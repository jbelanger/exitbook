import type { LinkStatus, TransactionLink } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import {
  buildLinkProposalRef,
  buildLinkProposalSelector,
  formatLinkSelectorRef,
  resolveLinkGapSelector,
  resolveLinkProposalSelector,
} from '../link-selector.js';
import type { LinkGapBrowseItem, LinkProposalBrowseItem } from '../links-browse-model.js';
import type { LinkGapAnalysis } from '../links-gap-model.js';
import type { LinkWithTransactions } from '../links-view-model.js';
import { buildTransferProposalItems } from '../transfer-proposals.js';
import { createGapsViewState, createLinksViewState } from '../view/index.js';
import type { LinksViewGapsState, LinksViewLinksState } from '../view/links-view-state.js';

import { loadLinksGapAnalysis } from './links-gap-analysis-support.js';

type LinksCommandDatabase = Awaited<ReturnType<CommandRuntime['database']>>;

export interface LinksBrowseParams {
  gaps?: boolean | undefined;
  maxConfidence?: number | undefined;
  minConfidence?: number | undefined;
  preselectInExplorer?: boolean | undefined;
  selector?: string | undefined;
  status?: LinkStatus | undefined;
  verbose?: boolean | undefined;
}

export type LinksBrowsePresentation =
  | {
      gaps: LinkGapBrowseItem[];
      mode: 'gaps';
      selectedGap?: LinkGapBrowseItem | undefined;
      state: LinksViewGapsState;
    }
  | {
      mode: 'links';
      proposals: LinkProposalBrowseItem[];
      selectedProposal?: LinkProposalBrowseItem | undefined;
      state: LinksViewLinksState;
    };

export async function buildLinksBrowsePresentation(
  database: LinksCommandDatabase,
  profileId: number,
  params: LinksBrowseParams,
  excludedAssetIds?: ReadonlySet<string>,
  resolvedTransactionFingerprints?: ReadonlySet<string>
): Promise<Result<LinksBrowsePresentation, Error>> {
  if (params.gaps === true) {
    return buildLinksGapsBrowsePresentation(
      database,
      profileId,
      params,
      excludedAssetIds,
      resolvedTransactionFingerprints
    );
  }

  return buildLinksProposalBrowsePresentation(database, profileId, params);
}

async function buildLinksProposalBrowsePresentation(
  database: LinksCommandDatabase,
  profileId: number,
  params: LinksBrowseParams
): Promise<Result<Extract<LinksBrowsePresentation, { mode: 'links' }>, Error>> {
  const linksResult = await database.transactionLinks.findAll({
    profileId,
    status: params.status,
  });
  if (linksResult.isErr()) {
    return err(linksResult.error);
  }

  const linksWithTransactions = await fetchTransactionsForLinks(linksResult.value, database.transactions, profileId);
  const totalProposalCount = countTransferProposals(linksWithTransactions);
  const state = createLinksViewState(
    linksWithTransactions,
    params.status,
    params.verbose ?? false,
    totalProposalCount,
    {
      maxConfidence: params.maxConfidence,
      minConfidence: params.minConfidence,
    }
  );
  const proposals = buildProposalBrowseItems(state);
  const selectedProposalResult =
    params.selector !== undefined
      ? resolveLinkProposalSelector(toProposalCandidates(proposals), params.selector)
      : ok(undefined);
  if (selectedProposalResult.isErr()) {
    return err(selectedProposalResult.error);
  }

  const selectedProposal = selectedProposalResult.value?.item;
  if (params.preselectInExplorer && selectedProposal) {
    preselectLinksState(state, proposals, selectedProposal);
  }

  return ok({
    mode: 'links',
    proposals,
    selectedProposal,
    state,
  });
}

async function buildLinksGapsBrowsePresentation(
  database: LinksCommandDatabase,
  profileId: number,
  params: LinksBrowseParams,
  excludedAssetIds?: ReadonlySet<string>,
  resolvedTransactionFingerprints?: ReadonlySet<string>
): Promise<Result<Extract<LinksBrowsePresentation, { mode: 'gaps' }>, Error>> {
  const analysisResult = await loadLinksGapAnalysis(database, profileId, {
    excludedAssetIds,
    resolvedTransactionFingerprints,
  });
  if (analysisResult.isErr()) {
    return err(analysisResult.error);
  }

  const sortedAnalysis = sortLinkGapAnalysisByTimestamp(analysisResult.value);
  const state = createGapsViewState(sortedAnalysis);
  const gaps = sortedAnalysis.issues.map((issue) => ({
    issue,
    transactionRef: formatLinkSelectorRef(issue.txFingerprint),
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
    mode: 'gaps',
    gaps,
    selectedGap,
    state,
  });
}

async function fetchTransactionsForLinks(
  links: readonly TransactionLink[],
  txRepo: LinksCommandDatabase['transactions'],
  profileId: number
): Promise<LinkWithTransactions[]> {
  const result: LinkWithTransactions[] = [];

  for (const link of links) {
    const sourceTxResult = await txRepo.findById(link.sourceTransactionId, profileId);
    const sourceTx = sourceTxResult.isOk() ? sourceTxResult.value : undefined;

    const targetTxResult = await txRepo.findById(link.targetTransactionId, profileId);
    const targetTx = targetTxResult.isOk() ? targetTxResult.value : undefined;

    result.push({
      link,
      sourceTransaction: sourceTx,
      targetTransaction: targetTx,
    });
  }

  return result;
}

function countTransferProposals(links: LinkWithTransactions[]): number {
  return buildTransferProposalItems(links).length;
}

function buildProposalBrowseItems(state: LinksViewLinksState): LinkProposalBrowseItem[] {
  return state.proposals.map((proposal) => ({
    proposal,
    proposalRef: buildLinkProposalRef(proposal.proposalKey),
  }));
}

function toProposalCandidates(
  proposals: LinkProposalBrowseItem[]
): { item: LinkProposalBrowseItem; proposalRef: string; proposalSelector: string }[] {
  return proposals.map((proposal) => ({
    item: proposal,
    proposalRef: proposal.proposalRef,
    proposalSelector: buildLinkProposalSelector(proposal.proposal.proposalKey),
  }));
}

function toGapCandidates(gaps: LinkGapBrowseItem[]): { item: LinkGapBrowseItem; txFingerprint: string }[] {
  return gaps.map((gap) => ({
    item: gap,
    txFingerprint: gap.issue.txFingerprint,
  }));
}

function preselectLinksState(
  state: LinksViewLinksState,
  proposals: LinkProposalBrowseItem[],
  selectedProposal: LinkProposalBrowseItem
): void {
  const selectedIndex = proposals.findIndex(
    (proposal) => proposal.proposal.proposalKey === selectedProposal.proposal.proposalKey
  );
  if (selectedIndex < 0) {
    return;
  }

  state.selectedIndex = selectedIndex;
  state.scrollOffset = selectedIndex;
}

function preselectGapsState(
  state: LinksViewGapsState,
  gaps: LinkGapBrowseItem[],
  selectedGap: LinkGapBrowseItem
): void {
  const selectedIndex = gaps.findIndex((gap) => gap.issue.txFingerprint === selectedGap.issue.txFingerprint);
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
