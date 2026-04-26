import { describe, expect, it } from 'vitest';

import {
  AccountingBalanceCategoryDocs,
  AccountingBalanceCategoryValues,
  AccountingJournalKindDocs,
  AccountingJournalKindValues,
  AccountingPostingRoleDocs,
  AccountingPostingRoleValues,
  AccountingSourceComponentKindDocs,
  AccountingSourceComponentKindValues,
  SourceActivityOriginDocs,
  SourceActivityOriginValues,
} from '../index.js';

function expectDocumentedEnum(values: readonly string[], docs: Record<string, unknown>): void {
  expect(Object.keys(docs).sort()).toEqual([...values].sort());
}

describe('ledger enum documentation', () => {
  it('documents every accounting journal kind', () => {
    expectDocumentedEnum(AccountingJournalKindValues, AccountingJournalKindDocs);
  });

  it('documents every accounting posting role', () => {
    expectDocumentedEnum(AccountingPostingRoleValues, AccountingPostingRoleDocs);
  });

  it('documents every accounting balance category', () => {
    expectDocumentedEnum(AccountingBalanceCategoryValues, AccountingBalanceCategoryDocs);
  });

  it('documents every source activity origin', () => {
    expectDocumentedEnum(SourceActivityOriginValues, SourceActivityOriginDocs);
  });

  it('documents every source component kind', () => {
    expectDocumentedEnum(AccountingSourceComponentKindValues, AccountingSourceComponentKindDocs);
  });
});
