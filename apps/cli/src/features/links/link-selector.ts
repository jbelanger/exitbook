import type { TransactionLink } from '@exitbook/core';
import { err, ok, sha256Hex, type Result } from '@exitbook/foundation';

import { ExitCodes, type ExitCode } from '../../cli/exit-codes.js';

import { buildTransferProposalItems } from './transfer-proposals.js';

export const LINK_SELECTOR_REF_LENGTH = 10;

export interface LinkProposalSelectorCandidate<TItem> {
  item: TItem;
  proposalRef: string;
  proposalSelector: string;
}

export interface LinkGapSelectorCandidate<TItem> {
  item: TItem;
  txFingerprint: string;
}

export interface ResolvedLinkSelector<TItem> {
  item: TItem;
  kind: 'ref';
  value: string;
}

export interface ResolvedLinkProposalRef {
  proposalKey: string;
  proposalRef: string;
  representativeLinkId: number;
}

export class LinkSelectorResolutionError extends Error {
  readonly kind: 'ambiguous' | 'missing' | 'not-found';

  constructor(kind: 'ambiguous' | 'missing' | 'not-found', message: string) {
    super(message);
    this.kind = kind;
    this.name = 'LinkSelectorResolutionError';
  }
}

export function formatLinkSelectorRef(value: string): string {
  if (value.length <= LINK_SELECTOR_REF_LENGTH) {
    return value;
  }

  return value.slice(0, LINK_SELECTOR_REF_LENGTH);
}

export function buildLinkProposalSelector(proposalKey: string): string {
  return sha256Hex(proposalKey);
}

export function buildLinkProposalRef(proposalKey: string): string {
  return formatLinkSelectorRef(buildLinkProposalSelector(proposalKey));
}

export function resolveLinkProposalSelector<TItem>(
  candidates: LinkProposalSelectorCandidate<TItem>[],
  selector: string
): Result<ResolvedLinkSelector<TItem>, Error> {
  return resolveLinkSelector(
    candidates.map((candidate) => ({
      fullValue: candidate.proposalSelector,
      item: candidate.item,
    })),
    selector,
    'Link proposal'
  );
}

export function resolveLinkProposalRef(
  links: readonly TransactionLink[],
  selector: string
): Result<ResolvedLinkProposalRef, Error> {
  const candidatesResult = buildLinkProposalRefCandidates(links);
  if (candidatesResult.isErr()) {
    return err(candidatesResult.error);
  }

  const resolvedResult = resolveLinkProposalSelector(candidatesResult.value, selector);
  if (resolvedResult.isErr()) {
    return err(resolvedResult.error);
  }

  return ok(resolvedResult.value.item);
}

export function resolveLinkGapSelector<TItem>(
  candidates: LinkGapSelectorCandidate<TItem>[],
  selector: string
): Result<ResolvedLinkSelector<TItem>, Error> {
  const uniqueCandidatesByTransaction = new Map<string, LinkGapSelectorCandidate<TItem>>();

  for (const candidate of candidates) {
    if (!uniqueCandidatesByTransaction.has(candidate.txFingerprint)) {
      uniqueCandidatesByTransaction.set(candidate.txFingerprint, candidate);
    }
  }

  return resolveLinkSelector(
    [...uniqueCandidatesByTransaction.values()].map((candidate) => ({
      fullValue: candidate.txFingerprint,
      item: candidate.item,
    })),
    selector,
    'Link gap'
  );
}

export function getLinkSelectorErrorExitCode(error: Error): ExitCode {
  if (!(error instanceof LinkSelectorResolutionError)) {
    return ExitCodes.GENERAL_ERROR;
  }

  switch (error.kind) {
    case 'not-found':
      return ExitCodes.NOT_FOUND;
    case 'ambiguous':
    case 'missing':
      return ExitCodes.INVALID_ARGS;
  }
}

function resolveLinkSelector<TItem>(
  candidates: { fullValue: string; item: TItem }[],
  selector: string,
  subject: string
): Result<ResolvedLinkSelector<TItem>, Error> {
  const normalizedSelector = normalizeLinkSelectorValue(selector);
  if (normalizedSelector.length === 0) {
    return err(new LinkSelectorResolutionError('missing', `${subject} selector must not be empty`));
  }

  const matches = candidates.filter((candidate) => candidate.fullValue.toLowerCase().startsWith(normalizedSelector));

  if (matches.length === 0) {
    return err(new LinkSelectorResolutionError('not-found', `${subject} ref '${normalizedSelector}' not found`));
  }

  if (matches.length > 1) {
    const matchRefs = matches
      .slice(0, 5)
      .map((candidate) =>
        candidate.fullValue.slice(0, Math.min(candidate.fullValue.length, LINK_SELECTOR_REF_LENGTH + 4))
      );
    const matchSuffix = matchRefs.length > 0 ? ` Matches include: ${matchRefs.join(', ')}` : '';

    return err(
      new LinkSelectorResolutionError(
        'ambiguous',
        `${subject} selector '${normalizedSelector}' is ambiguous. Use a longer ref.${matchSuffix}`
      )
    );
  }

  return ok({
    item: matches[0]!.item,
    kind: 'ref',
    value: normalizedSelector,
  });
}

function normalizeLinkSelectorValue(value: string): string {
  return value.trim().toLowerCase();
}

function buildLinkProposalRefCandidates(
  links: readonly TransactionLink[]
): Result<LinkProposalSelectorCandidate<ResolvedLinkProposalRef>[], Error> {
  const proposalItems = buildTransferProposalItems(links.map((link) => ({ link })));
  const candidates: LinkProposalSelectorCandidate<ResolvedLinkProposalRef>[] = [];

  for (const proposalItem of proposalItems) {
    const proposalSelector = buildLinkProposalSelector(proposalItem.proposalKey);
    const proposalRef = buildLinkProposalRef(proposalItem.proposalKey);
    candidates.push({
      item: {
        proposalKey: proposalItem.proposalKey,
        proposalRef,
        representativeLinkId: proposalItem.representativeLink.id,
      },
      proposalRef,
      proposalSelector,
    });
  }

  return ok(candidates);
}
