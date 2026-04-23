import { z } from 'zod';

import { AccountingJournalKindSchema } from '../journals/journal-kind.js';
import { AccountingPostingRoleSchema } from '../postings/posting-role.js';
import { AccountingSettlementSchema } from '../postings/settlement.js';

export const AccountingJournalKindOverridePatchSchema = z.object({
  kind: z.literal('journal_kind'),
  journalKind: AccountingJournalKindSchema,
});

export const AccountingPostingRoleOverridePatchSchema = z.object({
  kind: z.literal('posting_role'),
  role: AccountingPostingRoleSchema,
});

export const AccountingPostingSettlementOverridePatchSchema = z.object({
  kind: z.literal('posting_settlement'),
  settlement: AccountingSettlementSchema.nullable(),
});

export const AccountingOverridePatchSchema = z.discriminatedUnion('kind', [
  AccountingJournalKindOverridePatchSchema,
  AccountingPostingRoleOverridePatchSchema,
  AccountingPostingSettlementOverridePatchSchema,
]);

export type AccountingJournalKindOverridePatch = z.infer<typeof AccountingJournalKindOverridePatchSchema>;
export type AccountingPostingRoleOverridePatch = z.infer<typeof AccountingPostingRoleOverridePatchSchema>;
export type AccountingPostingSettlementOverridePatch = z.infer<typeof AccountingPostingSettlementOverridePatchSchema>;
export type AccountingOverridePatch = z.infer<typeof AccountingOverridePatchSchema>;
