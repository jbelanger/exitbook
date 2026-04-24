import type { TransactionDiagnostic } from '@exitbook/core';
import type {
  AccountingDiagnosticDraft,
  AccountingJournalDraft,
  AccountingJournalKind,
  AccountingPostingDraft,
} from '@exitbook/ledger';

import type { EvmJournalAssemblyParts } from './journal-assembler-types.js';

function resolveEvmJournalKind(valuePostings: readonly AccountingPostingDraft[]): AccountingJournalKind {
  if (valuePostings.length === 0) {
    return 'expense_only';
  }

  const hasOnlyStakingReward = valuePostings.every((posting) => posting.role === 'staking_reward');
  if (hasOnlyStakingReward) {
    return 'staking_reward';
  }

  const principalPostings = valuePostings.filter((posting) => posting.role === 'principal');
  const positivePrincipalAssets = new Set(
    principalPostings.filter((posting) => posting.quantity.gt(0)).map((posting) => posting.assetId)
  );
  const negativePrincipalAssets = new Set(
    principalPostings.filter((posting) => posting.quantity.lt(0)).map((posting) => posting.assetId)
  );

  if (
    positivePrincipalAssets.size === 1 &&
    negativePrincipalAssets.size === 1 &&
    [...positivePrincipalAssets][0] !== [...negativePrincipalAssets][0]
  ) {
    return 'trade';
  }

  return 'transfer';
}

export function buildEvmJournals(parts: EvmJournalAssemblyParts): AccountingJournalDraft[] {
  const journalKind = resolveEvmJournalKind(parts.valuePostings);
  const postings = parts.feePosting ? [...parts.valuePostings, parts.feePosting] : [...parts.valuePostings];

  if (postings.length === 0) {
    return [];
  }

  return [
    {
      sourceActivityFingerprint: parts.sourceActivityFingerprint,
      journalStableKey: journalKind === 'expense_only' ? 'network_fee' : journalKind,
      journalKind,
      postings,
      ...(parts.diagnostics.length === 0 ? {} : { diagnostics: [...parts.diagnostics] }),
    },
  ];
}

export function mapTransactionDiagnostics(
  diagnostics: readonly TransactionDiagnostic[] | undefined
): AccountingDiagnosticDraft[] {
  return (diagnostics ?? []).map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.severity === undefined ? {} : { severity: diagnostic.severity }),
    ...(diagnostic.metadata === undefined ? {} : { metadata: diagnostic.metadata }),
  }));
}
