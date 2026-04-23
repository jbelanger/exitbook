import { z } from 'zod';

export const AccountingOverrideKindSchema = z.enum(['journal_kind', 'posting_role', 'posting_settlement']);

export type AccountingOverrideKind = z.infer<typeof AccountingOverrideKindSchema>;
