import { z } from 'zod';

export const AccountingJournalRelationshipKindSchema = z.enum([
  'internal_transfer',
  'external_transfer',
  'same_hash_carryover',
  'bridge',
  'asset_migration',
]);

export type AccountingJournalRelationshipKind = z.infer<typeof AccountingJournalRelationshipKindSchema>;
