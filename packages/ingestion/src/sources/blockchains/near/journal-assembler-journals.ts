import type { AccountingJournalDraft, AccountingJournalKind, AccountingPostingDraft } from '@exitbook/ledger';

import type { NearJournalAssemblyParts } from './journal-assembler-types.js';

function resolveNearJournalKind(parts: NearJournalAssemblyParts): AccountingJournalKind {
  if (parts.valuePostings.length === 0) {
    return 'expense_only';
  }

  if (parts.valuePostings.every((posting) => posting.role === 'staking_reward')) {
    return 'staking_reward';
  }

  const principalPostings = parts.valuePostings.filter((posting) => posting.role === 'principal');
  const positivePrincipalAssets = new Set(
    principalPostings.filter((posting) => posting.quantity.gt(0)).map((posting) => posting.assetId)
  );
  const negativePrincipalAssets = new Set(
    principalPostings.filter((posting) => posting.quantity.lt(0)).map((posting) => posting.assetId)
  );

  const hasAcquisition = positivePrincipalAssets.size > 0;
  const hasDisposition = negativePrincipalAssets.size > 0;
  const hasDifferentAssetsAcrossSides =
    [...positivePrincipalAssets].some((assetId) => !negativePrincipalAssets.has(assetId)) ||
    [...negativePrincipalAssets].some((assetId) => !positivePrincipalAssets.has(assetId));

  if (hasAcquisition && hasDisposition && hasDifferentAssetsAcrossSides) {
    return 'trade';
  }

  return 'transfer';
}

function buildPostings(parts: NearJournalAssemblyParts): AccountingPostingDraft[] {
  return [...parts.valuePostings, ...parts.feePostings];
}

export function buildNearJournals(parts: NearJournalAssemblyParts): AccountingJournalDraft[] {
  const postings = buildPostings(parts);
  if (postings.length === 0) {
    return [];
  }

  const journalKind = resolveNearJournalKind(parts);
  return [
    {
      sourceActivityFingerprint: parts.sourceActivityFingerprint,
      journalStableKey: journalKind === 'expense_only' ? 'network_fee' : journalKind,
      journalKind,
      postings,
    },
  ];
}
