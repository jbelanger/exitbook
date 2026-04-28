import type { TransactionDiagnostic } from '@exitbook/core';
import type { AccountingDiagnosticDraft, AccountingJournalDraft } from '@exitbook/ledger';

import {
  hasProtocolCustodyPosting,
  resolveDefaultJournalStableKey,
  resolvePostingDrivenJournalKind,
} from '../shared/ledger-journal-kind-utils.js';

import type { SolanaJournalAssemblyParts } from './journal-assembler-types.js';

function mapTransactionDiagnostics(
  diagnostics: readonly TransactionDiagnostic[] | undefined
): AccountingDiagnosticDraft[] {
  return (diagnostics ?? []).map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.severity === undefined ? {} : { severity: diagnostic.severity }),
    ...(diagnostic.metadata === undefined ? {} : { metadata: diagnostic.metadata }),
  }));
}

function buildSolanaDiagnostics(
  diagnostics: readonly TransactionDiagnostic[] | undefined
): AccountingDiagnosticDraft[] {
  return mapTransactionDiagnostics(diagnostics);
}

export function buildSolanaJournals(parts: SolanaJournalAssemblyParts): AccountingJournalDraft[] {
  const journalKind = resolvePostingDrivenJournalKind({
    hasProtocolCustody: hasProtocolCustodyPosting(parts.valuePostings),
    valuePostings: parts.valuePostings,
  });
  const postings = parts.feePosting ? [...parts.valuePostings, parts.feePosting] : [...parts.valuePostings];

  if (postings.length === 0) {
    return [];
  }

  const journalStableKey = resolveDefaultJournalStableKey(journalKind);

  return [
    {
      sourceActivityFingerprint: parts.sourceActivityFingerprint,
      journalStableKey,
      journalKind,
      postings,
      ...(parts.diagnostics.length === 0 ? {} : { diagnostics: [...parts.diagnostics] }),
    },
  ];
}

export { buildSolanaDiagnostics };
