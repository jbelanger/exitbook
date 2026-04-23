import { err, ok, type Result } from '@exitbook/foundation';

import type { AccountingJournalDraft, IdentifiedAccountingJournalDraft } from '../journals/journal-draft.js';
import { validateAccountingJournalDraft } from '../journals/journal-validation.js';
import type { IdentifiedAccountingPostingDraft } from '../postings/posting-draft.js';
import { validateAccountingPostingDraft } from '../postings/posting-validation.js';

import type { AccountingOverridePatch } from './override-patch.js';
import type { AccountingOverrideTarget } from './override-target.js';

function toAccountingJournalDraft(journal: IdentifiedAccountingJournalDraft): AccountingJournalDraft {
  return {
    sourceActivityFingerprint: journal.sourceActivityFingerprint,
    journalStableKey: journal.journalStableKey,
    journalKind: journal.journalKind,
    postings: journal.postings.map(({ postingFingerprint: _postingFingerprint, ...posting }) => posting),
    relationships: journal.relationships ? [...journal.relationships] : undefined,
    diagnostics: journal.diagnostics ? [...journal.diagnostics] : undefined,
  };
}

export function applyAccountingOverridePatchToJournal(
  journal: IdentifiedAccountingJournalDraft,
  target: AccountingOverrideTarget,
  patch: AccountingOverridePatch
): Result<IdentifiedAccountingJournalDraft, Error> {
  if (target.scope !== 'journal') {
    return err(new Error(`Expected journal override target, got ${target.scope}`));
  }

  if (target.journalFingerprint !== journal.journalFingerprint) {
    return err(
      new Error(
        `Journal fingerprint mismatch: expected ${journal.journalFingerprint}, got ${target.journalFingerprint}`
      )
    );
  }

  if (patch.kind !== 'journal_kind') {
    return err(new Error(`Patch kind ${patch.kind} does not apply to journals`));
  }

  const nextJournal: IdentifiedAccountingJournalDraft = {
    ...journal,
    journalKind: patch.journalKind,
  };
  const validation = validateAccountingJournalDraft(toAccountingJournalDraft(nextJournal));
  if (validation.isErr()) {
    return err(validation.error);
  }

  return ok(nextJournal);
}

export function applyAccountingOverridePatchToPosting(
  posting: IdentifiedAccountingPostingDraft,
  target: AccountingOverrideTarget,
  patch: AccountingOverridePatch
): Result<IdentifiedAccountingPostingDraft, Error> {
  if (target.scope !== 'posting') {
    return err(new Error(`Expected posting override target, got ${target.scope}`));
  }

  if (target.postingFingerprint !== posting.postingFingerprint) {
    return err(
      new Error(
        `Posting fingerprint mismatch: expected ${posting.postingFingerprint}, got ${target.postingFingerprint}`
      )
    );
  }

  let nextPosting: IdentifiedAccountingPostingDraft;
  switch (patch.kind) {
    case 'posting_role':
      nextPosting = {
        ...posting,
        role: patch.role,
      };
      break;
    case 'posting_settlement':
      nextPosting = {
        ...posting,
        settlement: patch.settlement ?? undefined,
      };
      break;
    case 'journal_kind':
      return err(new Error('Patch kind journal_kind does not apply to postings'));
  }

  const validation = validateAccountingPostingDraft(nextPosting);
  if (validation.isErr()) {
    return err(validation.error);
  }

  return ok(nextPosting);
}
