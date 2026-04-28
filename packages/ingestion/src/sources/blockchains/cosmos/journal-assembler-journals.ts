import type { AccountingDiagnosticDraft, AccountingJournalDraft, AccountingPostingDraft } from '@exitbook/ledger';

import {
  hasProtocolCustodyPosting,
  resolveDefaultJournalStableKey,
  resolvePostingDrivenJournalKind,
} from '../shared/ledger-journal-kind-utils.js';

import type { CosmosPostingBuildParts } from './journal-assembler-types.js';

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
  const journalKind = resolvePostingDrivenJournalKind({
    hasProtocolCustody: hasProtocolCustodyPosting(parts.valuePostings),
    valuePostings: parts.valuePostings,
  });
  const postings = parts.feePosting ? [...parts.valuePostings, parts.feePosting] : [...parts.valuePostings];

  if (postings.length === 0) {
    return [];
  }

  const diagnostics = buildCosmosDiagnostics(parts.valuePostings);
  const journalStableKey = resolveDefaultJournalStableKey(journalKind);

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
