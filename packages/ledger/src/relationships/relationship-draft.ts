import { DecimalSchema } from '@exitbook/foundation';
import { z } from 'zod';

import { AccountingJournalRelationshipKindSchema } from './relationship-kind.js';

export const AccountingRelationshipAllocationSideSchema = z.enum(['source', 'target']);

export const AccountingRelationshipAllocationDraftSchema = z.object({
  allocationSide: AccountingRelationshipAllocationSideSchema,
  quantity: DecimalSchema.refine((quantity) => quantity.gt(0), 'Relationship allocation quantity must be positive'),
  sourceActivityFingerprint: z.string().min(1, 'Source activity fingerprint must not be empty'),
  journalStableKey: z.string().min(1, 'Journal stable key must not be empty'),
  postingStableKey: z.string().min(1, 'Posting stable key must not be empty'),
});

export const AccountingJournalRelationshipDraftSchema = z
  .object({
    relationshipStableKey: z.string().min(1, 'Relationship stable key must not be empty'),
    relationshipKind: AccountingJournalRelationshipKindSchema,
    allocations: z.array(AccountingRelationshipAllocationDraftSchema).min(2, 'Relationship requires allocations'),
  })
  .refine((relationship) => relationship.allocations.some((allocation) => allocation.allocationSide === 'source'), {
    message: 'Relationship requires at least one source allocation',
    path: ['allocations'],
  })
  .refine((relationship) => relationship.allocations.some((allocation) => allocation.allocationSide === 'target'), {
    message: 'Relationship requires at least one target allocation',
    path: ['allocations'],
  });

export type AccountingRelationshipAllocationSide = z.infer<typeof AccountingRelationshipAllocationSideSchema>;
export type AccountingRelationshipAllocationDraft = z.infer<typeof AccountingRelationshipAllocationDraftSchema>;
export type AccountingJournalRelationshipDraft = z.infer<typeof AccountingJournalRelationshipDraftSchema>;
