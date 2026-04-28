import type { AccountingJournalDraft, AccountingPostingDraft } from '@exitbook/ledger';

import {
  resolveDefaultJournalStableKey,
  resolvePostingDrivenJournalKind,
} from '../shared/ledger-journal-kind-utils.js';

import type { NearJournalAssemblyParts } from './journal-assembler-types.js';

function buildPostings(parts: NearJournalAssemblyParts): AccountingPostingDraft[] {
  return [...parts.valuePostings, ...parts.feePostings];
}

export function buildNearJournals(parts: NearJournalAssemblyParts): AccountingJournalDraft[] {
  const postings = buildPostings(parts);
  if (postings.length === 0) {
    return [];
  }

  const journalKind = resolvePostingDrivenJournalKind({
    valuePostings: parts.valuePostings,
  });
  return [
    {
      sourceActivityFingerprint: parts.sourceActivityFingerprint,
      journalStableKey: resolveDefaultJournalStableKey(journalKind),
      journalKind,
      postings,
    },
  ];
}
