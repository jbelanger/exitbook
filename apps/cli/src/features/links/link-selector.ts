import { computeResolvedLinkFingerprint, type TransactionLink } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import { ExitCodes, type ExitCode } from '../../cli/exit-codes.js';

export const LINK_SELECTOR_REF_LENGTH = 10;

export interface LinkProposalSelectorCandidate<TItem> {
  item: TItem;
  resolvedLinkFingerprint: string;
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

export function buildLinkProposalFingerprint(link: TransactionLink): Result<string, Error> {
  return computeResolvedLinkFingerprint({
    sourceAssetId: link.sourceAssetId,
    targetAssetId: link.targetAssetId,
    sourceMovementFingerprint: link.sourceMovementFingerprint,
    targetMovementFingerprint: link.targetMovementFingerprint,
  });
}

export function buildLinkProposalRef(link: TransactionLink): Result<string, Error> {
  const fingerprintResult = buildLinkProposalFingerprint(link);
  if (fingerprintResult.isErr()) {
    return err(fingerprintResult.error);
  }

  return ok(formatLinkSelectorRef(fingerprintResult.value));
}

export function resolveLinkProposalSelector<TItem>(
  candidates: LinkProposalSelectorCandidate<TItem>[],
  selector: string
): Result<ResolvedLinkSelector<TItem>, Error> {
  return resolveLinkSelector(
    candidates.map((candidate) => ({
      fullValue: candidate.resolvedLinkFingerprint,
      item: candidate.item,
    })),
    selector,
    'Link proposal'
  );
}

export function resolveLinkGapSelector<TItem>(
  candidates: LinkGapSelectorCandidate<TItem>[],
  selector: string
): Result<ResolvedLinkSelector<TItem>, Error> {
  return resolveLinkSelector(
    candidates.map((candidate) => ({
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
    const matchRefs = matches.slice(0, 5).map((candidate) => formatLinkSelectorRef(candidate.fullValue));
    const matchSuffix = matchRefs.length > 0 ? ` Matches include: ${matchRefs.join(', ')}` : '';

    return err(
      new LinkSelectorResolutionError(
        'ambiguous',
        `${subject} selector '${normalizedSelector}' is ambiguous. Use a longer fingerprint prefix.${matchSuffix}`
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
