import { buildAccountingIssueSelector } from '@exitbook/accounting/issues';
import { err, ok, type Result } from '@exitbook/foundation';

import { ExitCodes, type ExitCode } from '../../cli/exit-codes.js';

export interface IssueSelectorCandidate<TItem> {
  fullSelector: string;
  item: TItem;
}

export interface ResolvedIssueSelector<TItem> {
  item: TItem;
  kind: 'ref';
  value: string;
}

export class IssueSelectorResolutionError extends Error {
  readonly kind: 'ambiguous' | 'missing' | 'not-found';

  constructor(kind: 'ambiguous' | 'missing' | 'not-found', message: string) {
    super(message);
    this.kind = kind;
    this.name = 'IssueSelectorResolutionError';
  }
}

export function buildIssueSelector(scopeKey: string, issueKey: string): string {
  return buildAccountingIssueSelector(scopeKey, issueKey);
}

export function resolveIssueSelector<TItem>(
  candidates: readonly IssueSelectorCandidate<TItem>[],
  selector: string
): Result<ResolvedIssueSelector<TItem>, Error> {
  const normalizedSelector = normalizeIssueSelectorValue(selector);
  if (normalizedSelector.length === 0) {
    return err(new IssueSelectorResolutionError('missing', 'Issue selector is required'));
  }

  const matches = candidates.filter((candidate) => candidate.fullSelector.startsWith(normalizedSelector));
  if (matches.length === 0) {
    return err(new IssueSelectorResolutionError('not-found', `Issue ref '${normalizedSelector}' not found`));
  }

  if (matches.length > 1) {
    return err(
      new IssueSelectorResolutionError(
        'ambiguous',
        `Issue selector '${normalizedSelector}' is ambiguous. Use a longer issue ref.`
      )
    );
  }

  return ok({
    item: matches[0]!.item,
    kind: 'ref',
    value: normalizedSelector,
  });
}

export function getIssueSelectorErrorExitCode(error: Error): ExitCode {
  if (!(error instanceof IssueSelectorResolutionError)) {
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

function normalizeIssueSelectorValue(value: string): string {
  return value.trim().toLowerCase();
}
