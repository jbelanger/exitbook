import { z } from 'zod';

export const AccountingJournalKindSchema = z.enum([
  'transfer',
  'trade',
  'staking_reward',
  'protocol_event',
  'refund_rebate',
  'internal_transfer',
  'expense_only',
  'unknown',
]);

export type AccountingJournalKind = z.infer<typeof AccountingJournalKindSchema>;
