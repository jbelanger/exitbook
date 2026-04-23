import { err, type Result } from '@exitbook/foundation';

import { canonicalStringify } from '../internal/canonical-json.js';
import { computeFingerprint } from '../internal/fingerprint-utils.js';

import { AccountingJournalDraftSchema, type AccountingJournalDraft } from './journal-draft.js';

const ACCOUNTING_JOURNAL_FINGERPRINT_PREFIX = 'ledger_journal:v1';

export function buildAccountingJournalFingerprintMaterial(journal: AccountingJournalDraft): Result<string, Error> {
  const validation = AccountingJournalDraftSchema.safeParse(journal);
  if (!validation.success) {
    return err(new Error(`Invalid accounting journal draft: ${validation.error.message}`));
  }

  return canonicalStringify({
    journalStableKey: journal.journalStableKey,
    sourceActivityFingerprint: journal.sourceActivityFingerprint,
  });
}

export function computeAccountingJournalFingerprint(journal: AccountingJournalDraft): Result<string, Error> {
  const materialResult = buildAccountingJournalFingerprintMaterial(journal);
  if (materialResult.isErr()) {
    return err(materialResult.error);
  }

  return computeFingerprint(ACCOUNTING_JOURNAL_FINGERPRINT_PREFIX, materialResult.value);
}
