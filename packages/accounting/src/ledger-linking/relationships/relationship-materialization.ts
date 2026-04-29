import { DecimalSchema, type Result } from '@exitbook/foundation';
import { AccountingJournalRelationshipKindSchema } from '@exitbook/ledger';
import { z } from 'zod';

export const LedgerLinkingRelationshipAllocationSideSchema = z.enum(['source', 'target']);

export const LedgerLinkingRelationshipAllocationDraftSchema = z.object({
  allocationSide: LedgerLinkingRelationshipAllocationSideSchema,
  quantity: DecimalSchema.refine((quantity) => quantity.gt(0), 'Allocation quantity must be positive'),
  sourceActivityFingerprint: z.string().min(1, 'Source activity fingerprint must not be empty'),
  journalFingerprint: z.string().min(1, 'Journal fingerprint must not be empty'),
  postingFingerprint: z.string().min(1, 'Posting fingerprint must not be empty'),
});

export const LedgerLinkingRelationshipDraftSchema = z
  .object({
    allocations: z.array(LedgerLinkingRelationshipAllocationDraftSchema).min(2, 'Relationship requires allocations'),
    relationshipStableKey: z.string().min(1, 'Relationship stable key must not be empty'),
    relationshipKind: AccountingJournalRelationshipKindSchema,
  })
  .refine((relationship) => relationship.allocations.some((allocation) => allocation.allocationSide === 'source'), {
    message: 'Relationship requires at least one source allocation',
    path: ['allocations'],
  })
  .refine((relationship) => relationship.allocations.some((allocation) => allocation.allocationSide === 'target'), {
    message: 'Relationship requires at least one target allocation',
    path: ['allocations'],
  });

export type LedgerLinkingRelationshipAllocationSide = z.infer<typeof LedgerLinkingRelationshipAllocationSideSchema>;
export type LedgerLinkingRelationshipAllocationDraft = z.infer<typeof LedgerLinkingRelationshipAllocationDraftSchema>;
export type LedgerLinkingRelationshipDraft = z.infer<typeof LedgerLinkingRelationshipDraftSchema>;

export interface LedgerLinkingPersistedRelationshipAllocation {
  allocationSide: LedgerLinkingRelationshipAllocationSide;
  assetId: string;
  assetSymbol: string;
  id: number;
  quantity: string;
  sourceActivityFingerprint: string;
  journalFingerprint: string;
  postingFingerprint: string | undefined;
  currentJournalId: number | undefined;
  currentPostingId: number | undefined;
}

export interface LedgerLinkingPersistedRelationship {
  allocations: readonly LedgerLinkingPersistedRelationshipAllocation[];
  id: number;
  relationshipStableKey: string;
  relationshipKind: z.infer<typeof AccountingJournalRelationshipKindSchema>;
  createdAt: string;
  updatedAt: string | undefined;
}

export interface LedgerLinkingRelationshipMaterializationResult {
  previousCount: number;
  resolvedAllocationCount: number;
  savedCount: number;
  unresolvedAllocationCount: number;
}

export interface ILedgerLinkingRelationshipStore {
  replaceLedgerLinkingRelationships(
    profileId: number,
    relationships: readonly LedgerLinkingRelationshipDraft[]
  ): Promise<Result<LedgerLinkingRelationshipMaterializationResult, Error>>;
}

export interface ILedgerLinkingRelationshipReader {
  loadLedgerLinkingRelationships(profileId: number): Promise<Result<LedgerLinkingPersistedRelationship[], Error>>;
}
