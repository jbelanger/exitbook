import { z } from 'zod';

export const AccountingJournalOverrideTargetSchema = z.object({
  scope: z.literal('journal'),
  journalFingerprint: z.string().min(1, 'Journal fingerprint must not be empty'),
});

export const AccountingPostingOverrideTargetSchema = z.object({
  scope: z.literal('posting'),
  postingFingerprint: z.string().min(1, 'Posting fingerprint must not be empty'),
});

export const AccountingOverrideTargetSchema = z.discriminatedUnion('scope', [
  AccountingJournalOverrideTargetSchema,
  AccountingPostingOverrideTargetSchema,
]);

export type AccountingJournalOverrideTarget = z.infer<typeof AccountingJournalOverrideTargetSchema>;
export type AccountingPostingOverrideTarget = z.infer<typeof AccountingPostingOverrideTargetSchema>;
export type AccountingOverrideTarget = z.infer<typeof AccountingOverrideTargetSchema>;
