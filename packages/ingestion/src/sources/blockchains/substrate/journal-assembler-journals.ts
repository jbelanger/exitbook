import type { AccountingDiagnosticDraft, AccountingJournalDraft, AccountingJournalKind } from '@exitbook/ledger';

import type { SubstrateJournalAssemblyParts } from './journal-assembler-types.js';

function hasProtocolCustodyPosting(parts: SubstrateJournalAssemblyParts): boolean {
  return parts.valuePostings.some(
    (posting) =>
      posting.role === 'protocol_deposit' ||
      posting.role === 'protocol_refund' ||
      posting.balanceCategory === 'staked' ||
      posting.balanceCategory === 'unbonding'
  );
}

function resolveSubstrateJournalKind(parts: SubstrateJournalAssemblyParts): AccountingJournalKind {
  if (parts.valuePostings.length === 0) {
    return parts.isProtocolEvent ? 'protocol_event' : 'expense_only';
  }

  if (parts.valuePostings.every((posting) => posting.role === 'staking_reward')) {
    return 'staking_reward';
  }

  if (parts.isProtocolEvent || hasProtocolCustodyPosting(parts)) {
    return 'protocol_event';
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

  return hasAcquisition && hasDisposition && hasDifferentAssetsAcrossSides ? 'trade' : 'transfer';
}

function buildSubstrateDiagnostics(parts: SubstrateJournalAssemblyParts): AccountingDiagnosticDraft[] {
  const diagnostics = [...parts.diagnostics];
  if (hasProtocolCustodyPosting(parts) || (parts.isProtocolEvent && parts.valuePostings.length === 0)) {
    diagnostics.push({
      code: 'substrate_staking_custody',
      message: 'Substrate staking operation moved principal between liquid, staked, or unbonding balance categories.',
      severity: 'info',
    });
  }

  return diagnostics;
}

function resolveJournalStableKey(journalKind: AccountingJournalKind): string {
  if (journalKind === 'expense_only') {
    return 'network_fee';
  }

  if (journalKind === 'protocol_event') {
    return 'staking_lifecycle';
  }

  return journalKind;
}

export function buildSubstrateJournals(parts: SubstrateJournalAssemblyParts): AccountingJournalDraft[] {
  const journalKind = resolveSubstrateJournalKind(parts);
  const postings = parts.feePosting ? [...parts.valuePostings, parts.feePosting] : [...parts.valuePostings];

  if (postings.length === 0) {
    return [];
  }

  const diagnostics = buildSubstrateDiagnostics(parts);

  return [
    {
      sourceActivityFingerprint: parts.sourceActivityFingerprint,
      journalStableKey: resolveJournalStableKey(journalKind),
      journalKind,
      postings,
      ...(diagnostics.length === 0 ? {} : { diagnostics }),
    },
  ];
}
