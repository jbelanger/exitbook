import { z } from 'zod';

import { AccountingPostingDraftSchema, type IdentifiedAccountingPostingDraft } from '../postings/posting-draft.js';
import { AccountingJournalRelationshipDraftSchema } from '../relationships/relationship-draft.js';

import { AccountingJournalKindSchema } from './journal-kind.js';

export const AccountingDiagnosticDraftSchema = z.object({
  code: z.string().min(1, 'Diagnostic code must not be empty'),
  message: z.string().min(1, 'Diagnostic message must not be empty'),
  severity: z.enum(['info', 'warning', 'error']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const AccountingJournalDraftSchema = z.object({
  sourceActivityFingerprint: z.string().min(1, 'Source activity fingerprint must not be empty'),
  journalStableKey: z.string().min(1, 'Journal stable key must not be empty'),
  journalKind: AccountingJournalKindSchema,
  postings: z.array(AccountingPostingDraftSchema).min(1, 'Journal must have at least one posting'),
  relationships: z.array(AccountingJournalRelationshipDraftSchema).optional(),
  diagnostics: z.array(AccountingDiagnosticDraftSchema).optional(),
});

export type AccountingDiagnosticDraft = z.infer<typeof AccountingDiagnosticDraftSchema>;
export type AccountingJournalDraft = z.infer<typeof AccountingJournalDraftSchema>;

export interface IdentifiedAccountingJournalDraft extends Omit<AccountingJournalDraft, 'postings'> {
  journalFingerprint: string;
  postings: readonly IdentifiedAccountingPostingDraft[];
}
