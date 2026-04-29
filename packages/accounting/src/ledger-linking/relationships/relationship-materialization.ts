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

export interface LedgerLinkingPersistedRelationshipEndpoint {
  sourceActivityFingerprint: string;
  journalFingerprint: string;
  postingFingerprint: string | undefined;
  currentJournalId: number | undefined;
  currentPostingId: number | undefined;
}

export interface LedgerLinkingPersistedRelationship {
  id: number;
  relationshipStableKey: string;
  relationshipKind: z.infer<typeof AccountingJournalRelationshipKindSchema>;
  source: LedgerLinkingPersistedRelationshipEndpoint;
  target: LedgerLinkingPersistedRelationshipEndpoint;
  createdAt: string;
  updatedAt: string | undefined;
}

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

export interface ILedgerLinkingRelationshipReader {
  loadLedgerLinkingRelationships(profileId: number): Promise<Result<LedgerLinkingPersistedRelationship[], Error>>;
}
