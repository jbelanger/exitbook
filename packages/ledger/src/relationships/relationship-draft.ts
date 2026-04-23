import { z } from 'zod';

import { AccountingJournalRelationshipKindSchema } from './relationship-kind.js';

export const AccountingRelationshipEndpointRefSchema = z.object({
  sourceActivityFingerprint: z.string().min(1, 'Source activity fingerprint must not be empty'),
  journalStableKey: z.string().min(1, 'Journal stable key must not be empty'),
  postingStableKey: z.string().min(1, 'Posting stable key must not be empty').optional(),
});

export const AccountingJournalRelationshipDraftSchema = z.object({
  relationshipStableKey: z.string().min(1, 'Relationship stable key must not be empty'),
  relationshipKind: AccountingJournalRelationshipKindSchema,
  source: AccountingRelationshipEndpointRefSchema,
  target: AccountingRelationshipEndpointRefSchema,
});

export type AccountingRelationshipEndpointRef = z.infer<typeof AccountingRelationshipEndpointRefSchema>;
export type AccountingJournalRelationshipDraft = z.infer<typeof AccountingJournalRelationshipDraftSchema>;
