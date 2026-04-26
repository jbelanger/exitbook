import type {
  AccountingDiagnosticDraft,
  AccountingJournalDraft,
  AccountingJournalKind,
  AccountingPostingDraft,
} from '@exitbook/ledger';

import type { CosmosPostingBuildParts } from './journal-assembler-types.js';

function hasProtocolCustodyPosting(postings: readonly AccountingPostingDraft[]): boolean {
  return postings.some(
    (posting) =>
      posting.role === 'protocol_deposit' ||
      posting.role === 'protocol_refund' ||
      posting.balanceCategory === 'staked' ||
      posting.balanceCategory === 'unbonding'
  );
}

function resolveCosmosJournalKind(valuePostings: readonly AccountingPostingDraft[]): AccountingJournalKind {
  if (valuePostings.length === 0) {
    return 'expense_only';
  }

  if (hasProtocolCustodyPosting(valuePostings)) {
    return 'protocol_event';
  }

  if (valuePostings.every((posting) => posting.role === 'staking_reward')) {
    return 'staking_reward';
  }

  const principalPostings = valuePostings.filter((posting) => posting.role === 'principal');
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

  return hasAcquisition && hasDisposition && hasDifferentAssetsAcrossSides ? 'trade' : 'transfer';
}

function buildCosmosDiagnostics(valuePostings: readonly AccountingPostingDraft[]): AccountingDiagnosticDraft[] {
  if (!hasProtocolCustodyPosting(valuePostings)) {
    return [];
  }

  return [
    {
      code: 'cosmos_staking_custody',
      message: 'Cosmos staking operation moved principal between liquid, staked, or unbonding balance categories.',
      severity: 'info',
    },
  ];
}

export function buildCosmosJournals(parts: CosmosPostingBuildParts): AccountingJournalDraft[] {
  const journalKind = resolveCosmosJournalKind(parts.valuePostings);
  const postings = parts.feePosting ? [...parts.valuePostings, parts.feePosting] : [...parts.valuePostings];

  if (postings.length === 0) {
    return [];
  }

  const diagnostics = buildCosmosDiagnostics(parts.valuePostings);
  const journalStableKey = journalKind === 'expense_only' ? 'network_fee' : journalKind;

  return [
    {
      sourceActivityFingerprint: parts.sourceActivityFingerprint,
      journalStableKey,
      journalKind,
      postings,
      ...(diagnostics.length === 0 ? {} : { diagnostics }),
    },
  ];
}
