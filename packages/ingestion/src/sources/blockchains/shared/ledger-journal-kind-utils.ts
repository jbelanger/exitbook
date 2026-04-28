import type { AccountingJournalKind, AccountingPostingDraft } from '@exitbook/ledger';

function principalAssetIdsByDirection(params: {
  direction: 'in' | 'out';
  postings: readonly AccountingPostingDraft[];
}): Set<string> {
  return new Set(
    params.postings
      .filter((posting) => posting.role === 'principal')
      .filter((posting) => (params.direction === 'in' ? posting.quantity.gt(0) : posting.quantity.lt(0)))
      .map((posting) => posting.assetId)
  );
}

function hasDifferentPrincipalAssetsAcrossSides(postings: readonly AccountingPostingDraft[]): boolean {
  const positivePrincipalAssets = principalAssetIdsByDirection({ direction: 'in', postings });
  const negativePrincipalAssets = principalAssetIdsByDirection({ direction: 'out', postings });

  return (
    [...positivePrincipalAssets].some((assetId) => !negativePrincipalAssets.has(assetId)) ||
    [...negativePrincipalAssets].some((assetId) => !positivePrincipalAssets.has(assetId))
  );
}

function hasPrincipalOnBothSides(postings: readonly AccountingPostingDraft[]): boolean {
  return (
    postings.some((posting) => posting.role === 'principal' && posting.quantity.gt(0)) &&
    postings.some((posting) => posting.role === 'principal' && posting.quantity.lt(0))
  );
}

export function hasProtocolCustodyPosting(postings: readonly AccountingPostingDraft[]): boolean {
  return postings.some(
    (posting) =>
      posting.role === 'protocol_deposit' ||
      posting.role === 'protocol_refund' ||
      posting.balanceCategory === 'staked' ||
      posting.balanceCategory === 'unbonding'
  );
}

export function resolvePostingDrivenJournalKind(params: {
  forceProtocolEvent?: boolean | undefined;
  hasProtocolCustody?: boolean | undefined;
  protocolEventAfterRewards?: boolean | undefined;
  protocolEventOnEmpty?: boolean | undefined;
  valuePostings: readonly AccountingPostingDraft[];
}): AccountingJournalKind {
  if (params.forceProtocolEvent === true) {
    return 'protocol_event';
  }

  if (params.valuePostings.length === 0) {
    return params.protocolEventOnEmpty === true ? 'protocol_event' : 'expense_only';
  }

  if (params.valuePostings.every((posting) => posting.role === 'staking_reward')) {
    return 'staking_reward';
  }

  if (params.protocolEventAfterRewards === true || params.hasProtocolCustody === true) {
    return 'protocol_event';
  }

  return hasPrincipalOnBothSides(params.valuePostings) && hasDifferentPrincipalAssetsAcrossSides(params.valuePostings)
    ? 'trade'
    : 'transfer';
}

export function resolveDefaultJournalStableKey(journalKind: AccountingJournalKind): string {
  return journalKind === 'expense_only' ? 'network_fee' : journalKind;
}
