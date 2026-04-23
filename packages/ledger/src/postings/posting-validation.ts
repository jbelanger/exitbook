import { err, ok, type Result } from '@exitbook/foundation';

import { AccountingPostingDraftSchema, type AccountingPostingDraft } from './posting-draft.js';
import { isAccountingPostingRoleCompatibleWithQuantitySign } from './posting-role.js';

export function validateAccountingPostingDraft(posting: AccountingPostingDraft): Result<void, Error> {
  const validation = AccountingPostingDraftSchema.safeParse(posting);
  if (!validation.success) {
    return err(new Error(`Invalid accounting posting draft: ${validation.error.message}`));
  }

  if (posting.quantity.isZero()) {
    return err(new Error(`Posting ${posting.postingStableKey} quantity must not be zero`));
  }

  if (!isAccountingPostingRoleCompatibleWithQuantitySign(posting.quantity, posting.role)) {
    return err(
      new Error(
        `Posting ${posting.postingStableKey} role ${posting.role} is incompatible with quantity ${posting.quantity.toFixed()}`
      )
    );
  }

  if (posting.role === 'fee' && posting.settlement === undefined) {
    return err(new Error(`Posting ${posting.postingStableKey} with role fee requires settlement`));
  }

  return ok(undefined);
}
