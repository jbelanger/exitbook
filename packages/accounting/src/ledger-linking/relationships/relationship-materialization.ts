import type { Result } from '@exitbook/foundation';
import { AccountingJournalRelationshipKindSchema } from '@exitbook/ledger';
import { z } from 'zod';

export const LedgerLinkingRelationshipEndpointRefSchema = z.object({
  sourceActivityFingerprint: z.string().min(1, 'Source activity fingerprint must not be empty'),
  journalFingerprint: z.string().min(1, 'Journal fingerprint must not be empty'),
  postingFingerprint: z.string().min(1, 'Posting fingerprint must not be empty').optional(),
});

export const LedgerLinkingRelationshipDraftSchema = z.object({
  relationshipStableKey: z.string().min(1, 'Relationship stable key must not be empty'),
  relationshipKind: AccountingJournalRelationshipKindSchema,
  source: LedgerLinkingRelationshipEndpointRefSchema,
  target: LedgerLinkingRelationshipEndpointRefSchema,
});

export type LedgerLinkingRelationshipEndpointRef = z.infer<typeof LedgerLinkingRelationshipEndpointRefSchema>;
export type LedgerLinkingRelationshipDraft = z.infer<typeof LedgerLinkingRelationshipDraftSchema>;

export interface LedgerLinkingRelationshipMaterializationResult {
  previousCount: number;
  savedCount: number;
  resolvedEndpointCount: number;
  unresolvedEndpointCount: number;
}

export interface ILedgerLinkingRelationshipStore {
  replaceLedgerLinkingRelationships(
    profileId: number,
    relationships: readonly LedgerLinkingRelationshipDraft[]
  ): Promise<Result<LedgerLinkingRelationshipMaterializationResult, Error>>;
}
