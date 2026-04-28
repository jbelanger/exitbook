import type { AccountingDiagnosticDraft, AccountingJournalDraft, AccountingJournalKind } from '@exitbook/ledger';

import {
  hasProtocolCustodyPosting,
  resolveDefaultJournalStableKey,
  resolvePostingDrivenJournalKind,
} from '../shared/ledger-journal-kind-utils.js';

import type { SubstrateJournalAssemblyParts } from './journal-assembler-types.js';

function buildSubstrateDiagnostics(parts: SubstrateJournalAssemblyParts): AccountingDiagnosticDraft[] {
  const diagnostics = [...parts.diagnostics];
  if (hasProtocolCustodyPosting(parts.valuePostings) || (parts.isProtocolEvent && parts.valuePostings.length === 0)) {
    diagnostics.push({
      code: 'substrate_staking_custody',
      message: 'Substrate staking operation moved principal between liquid, staked, or unbonding balance categories.',
      severity: 'info',
    });
  }

  return diagnostics;
}

function resolveJournalStableKey(journalKind: AccountingJournalKind): string {
  if (journalKind === 'protocol_event') {
    return 'staking_lifecycle';
  }

  return resolveDefaultJournalStableKey(journalKind);
}

export function buildSubstrateJournals(parts: SubstrateJournalAssemblyParts): AccountingJournalDraft[] {
  const journalKind = resolvePostingDrivenJournalKind({
    protocolEventAfterRewards: parts.isProtocolEvent || hasProtocolCustodyPosting(parts.valuePostings),
    protocolEventOnEmpty: parts.isProtocolEvent,
    valuePostings: parts.valuePostings,
  });
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
