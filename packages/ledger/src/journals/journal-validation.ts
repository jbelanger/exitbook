import { err, ok, type Result } from '@exitbook/foundation';

import { validateAccountingPostingDraft } from '../postings/posting-validation.js';
import { AccountingJournalRelationshipDraftSchema } from '../relationships/relationship-draft.js';

import { AccountingJournalDraftSchema, type AccountingJournalDraft } from './journal-draft.js';

export function validateAccountingJournalDraft(journal: AccountingJournalDraft): Result<void, Error> {
  const validation = AccountingJournalDraftSchema.safeParse(journal);
  if (!validation.success) {
    return err(new Error(`Invalid accounting journal draft: ${validation.error.message}`));
  }

  const postingStableKeys = new Set<string>();
  for (const posting of journal.postings) {
    if (postingStableKeys.has(posting.postingStableKey)) {
      return err(
        new Error(
          `Journal ${journal.journalStableKey} contains duplicate posting stable key ${posting.postingStableKey}`
        )
      );
    }

    postingStableKeys.add(posting.postingStableKey);
    const postingResult = validateAccountingPostingDraft(posting);
    if (postingResult.isErr()) {
      return err(postingResult.error);
    }
  }

  const relationshipStableKeys = new Set<string>();
  for (const relationship of journal.relationships ?? []) {
    const relationshipValidation = AccountingJournalRelationshipDraftSchema.safeParse(relationship);
    if (!relationshipValidation.success) {
      return err(new Error(`Invalid accounting journal relationship: ${relationshipValidation.error.message}`));
    }

    if (relationshipStableKeys.has(relationship.relationshipStableKey)) {
      return err(
        new Error(
          `Journal ${journal.journalStableKey} contains duplicate relationship stable key ${relationship.relationshipStableKey}`
        )
      );
    }

    relationshipStableKeys.add(relationship.relationshipStableKey);
  }

  if (journal.journalKind === 'expense_only' && journal.postings.some((posting) => posting.quantity.gt(0))) {
    return err(
      new Error(`Journal ${journal.journalStableKey} with kind expense_only must not contain positive postings`)
    );
  }

  return ok(undefined);
}
