import type { LinkStatus, TransactionLink } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { buildLinkProposalRef, buildLinkProposalSelector, resolveLinkProposalSelector } from '../link-selector.js';
import type { LinkProposalBrowseItem } from '../links-browse-model.js';
import type { LinkWithTransactions } from '../links-view-model.js';
import { buildTransferProposalItems } from '../transfer-proposals.js';
import { createLinksViewState } from '../view/index.js';
import type { LinksViewLinksState } from '../view/links-view-state.js';

type LinksCommandDatabase = Awaited<ReturnType<CommandRuntime['database']>>;

export interface LinksBrowseParams {
  maxConfidence?: number | undefined;
  minConfidence?: number | undefined;
  preselectInExplorer?: boolean | undefined;
  selector?: string | undefined;
  status?: LinkStatus | undefined;
  verbose?: boolean | undefined;
}

export interface LinksBrowsePresentation {
  mode: 'links';
  proposals: LinkProposalBrowseItem[];
  selectedProposal?: LinkProposalBrowseItem | undefined;
  state: LinksViewLinksState;
}

export async function buildLinksBrowsePresentation(
  database: LinksCommandDatabase,
  profileId: number,
  params: LinksBrowseParams
): Promise<Result<LinksBrowsePresentation, Error>> {
  const linksResult = await database.transactionLinks.findAll({
    profileId,
    status: params.status,
  });
  if (linksResult.isErr()) {
    return err(linksResult.error);
  }

  const linksWithTransactions = await hydrateLinksWithBestEffortTransactions(
    linksResult.value,
    database.transactions,
    profileId
  );
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

async function hydrateLinksWithBestEffortTransactions(
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
