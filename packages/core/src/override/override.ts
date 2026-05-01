import { Decimal } from 'decimal.js';
import { z } from 'zod';

import { MovementRoleSchema, NonPrincipalMovementRoleSchema } from '../transaction/movement.js';

/**
 * Scope/domain of the override
 */
export const ScopeSchema = z.enum([
  'price',
  'fx',
  'link',
  'unlink',
  'link-gap-resolve',
  'link-gap-reopen',
  'transaction-movement-role',
  'transaction-user-note',
  'asset-exclude',
  'asset-include',
  'asset-review-confirm',
  'asset-review-clear',
  'ledger-linking-asset-identity-accept',
  'ledger-linking-asset-identity-revoke',
  'ledger-linking-relationship-accept',
  'ledger-linking-relationship-revoke',
  'ledger-linking-gap-resolution-accept',
  'ledger-linking-gap-resolution-revoke',
]);

/**
 * Link action type - confirm an existing suggested link
 */
export const LinkActionSchema = z.enum(['confirm']);

export const LinkGapDirectionSchema = z.enum(['inflow', 'outflow']);

/**
 * Override link type - transfer or trade (user-facing category, distinct from DB LinkType)
 */
export const OverrideLinkTypeSchema = z.enum(['transfer', 'trade']);

/**
 * Price override payload
 * User sets manual price for an asset at a given timestamp.
 * tx_fingerprint is optional — the `prices set` CLI operates at asset+timestamp level.
 */
export const PriceOverridePayloadSchema = z.object({
  type: z.literal('price_override'),
  tx_fingerprint: z.string().min(1, 'Transaction fingerprint must not be empty').optional(),
  asset: z.string().min(1, 'Asset must not be empty'),
  quote_asset: z.string().min(1, 'Quote asset must not be empty'),
  price: z.string().min(1, 'Price must not be empty'),
  price_source: z.string().default('manual'),
  timestamp: z.string().datetime(),
});

/**
 * FX override payload
 * User corrects FX rate at a given timestamp.
 * tx_fingerprint is optional — the `prices set-fx` CLI operates at currency-pair+timestamp level.
 */
export const FxOverridePayloadSchema = z.object({
  type: z.literal('fx_override'),
  tx_fingerprint: z.string().min(1, 'Transaction fingerprint must not be empty').optional(),
  fx_pair: z.string().min(1, 'FX pair must not be empty'),
  rate: z.string().min(1, 'Rate must not be empty'),
  timestamp: z.string().datetime(),
});

/**
 * Link override payload
 * User confirms a suggested link
 */
export const LinkOverridePayloadSchema = z
  .object({
    type: z.literal('link_override'),
    action: LinkActionSchema,
    link_type: OverrideLinkTypeSchema,
    source_fingerprint: z.string().min(1, 'Source fingerprint must not be empty'),
    target_fingerprint: z.string().min(1, 'Target fingerprint must not be empty'),
    asset: z.string().min(1, 'Asset must not be empty'),
    resolved_link_fingerprint: z.string().min(1, 'Resolved link fingerprint must not be empty'),
    source_asset_id: z.string().min(1, 'Source asset ID must not be empty'),
    target_asset_id: z.string().min(1, 'Target asset ID must not be empty'),
    source_movement_fingerprint: z.string().min(1, 'Source movement fingerprint must not be empty'),
    target_movement_fingerprint: z.string().min(1, 'Target movement fingerprint must not be empty'),
    source_amount: z.string().min(1, 'Source amount must not be empty'),
    target_amount: z.string().min(1, 'Target amount must not be empty'),
    explained_target_residual_amount: z
      .string()
      .min(1, 'Explained target residual amount must not be empty')
      .optional(),
    explained_target_residual_role: NonPrincipalMovementRoleSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const hasAmount = data.explained_target_residual_amount !== undefined;
    const hasRole = data.explained_target_residual_role !== undefined;

    if (hasAmount !== hasRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'explained target residual amount and role must be provided together',
        path: hasAmount ? ['explained_target_residual_role'] : ['explained_target_residual_amount'],
      });
    }
  });

/**
 * Unlink override payload
 * User explicitly prevents auto-linking
 */
export const UnlinkOverridePayloadSchema = z.object({
  type: z.literal('unlink_override'),
  resolved_link_fingerprint: z.string().min(1, 'Resolved link fingerprint must not be empty'),
});

/**
 * Link gap resolve payload
 * User marks a specific asset-direction link gap as intentionally resolved without a link.
 */
export const LinkGapResolvePayloadSchema = z.object({
  type: z.literal('link_gap_resolve'),
  asset_id: z.string().min(1, 'Asset ID must not be empty'),
  direction: LinkGapDirectionSchema,
  tx_fingerprint: z.string().min(1, 'Transaction fingerprint must not be empty'),
});

/**
 * Link gap reopen payload
 * User reopens a previously-resolved asset-direction link gap.
 */
export const LinkGapReopenPayloadSchema = z.object({
  type: z.literal('link_gap_reopen'),
  asset_id: z.string().min(1, 'Asset ID must not be empty'),
  direction: LinkGapDirectionSchema,
  tx_fingerprint: z.string().min(1, 'Transaction fingerprint must not be empty'),
});

/**
 * Transaction movement-role override payload
 * User sets or clears a durable manual movement role on a specific processed movement fingerprint.
 */
export const TransactionMovementRoleOverridePayloadSchema = z
  .object({
    type: z.literal('transaction_movement_role_override'),
    movement_fingerprint: z.string().min(1, 'Movement fingerprint must not be empty'),
    action: z.enum(['set', 'clear']),
    movement_role: MovementRoleSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === 'set' && data.movement_role === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "action 'set' requires movement_role",
        path: ['movement_role'],
      });
    }

    if (data.action === 'clear' && data.movement_role !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "action 'clear' must not include movement_role",
        path: ['movement_role'],
      });
    }
  });

/**
 * Transaction user-note override payload
 * User attaches or clears a durable note on a specific transaction fingerprint.
 */
export const TransactionUserNoteOverridePayloadSchema = z
  .object({
    type: z.literal('transaction_user_note_override'),
    tx_fingerprint: z.string().min(1, 'Transaction fingerprint must not be empty'),
    action: z.enum(['set', 'clear']),
    message: z.string().min(1, 'Note message must not be empty').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === 'set' && !data.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "action 'set' requires message",
        path: ['message'],
      });
    }

    if (data.action === 'clear' && data.message !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "action 'clear' must not include message",
        path: ['message'],
      });
    }
  });

/**
 * Asset exclusion payload
 * User excludes an asset from accounting-scoped processing.
 */
export const AssetExcludePayloadSchema = z.object({
  type: z.literal('asset_exclude'),
  asset_id: z.string().min(1, 'Asset ID must not be empty'),
});

/**
 * Asset inclusion payload
 * User re-includes a previously excluded asset.
 */
export const AssetIncludePayloadSchema = z.object({
  type: z.literal('asset_include'),
  asset_id: z.string().min(1, 'Asset ID must not be empty'),
});

/**
 * Asset review confirmation payload
 * User confirms the current evidence for a suspicious asset.
 */
export const AssetReviewConfirmPayloadSchema = z.object({
  type: z.literal('asset_review_confirm'),
  asset_id: z.string().min(1, 'Asset ID must not be empty'),
  evidence_fingerprint: z.string().min(1, 'Evidence fingerprint must not be empty'),
});

/**
 * Asset review clear payload
 * User clears a prior review confirmation so the asset re-enters review if needed.
 */
export const AssetReviewClearPayloadSchema = z.object({
  type: z.literal('asset_review_clear'),
  asset_id: z.string().min(1, 'Asset ID must not be empty'),
});

/**
 * Ledger-linking asset identity assertion accepted by the user.
 *
 * The accounting package validates relationship/evidence semantics during
 * replay; the override event only enforces stable, non-empty persisted input.
 */
export const LedgerLinkingAssetIdentityAcceptPayloadSchema = z.object({
  type: z.literal('ledger_linking_asset_identity_accept'),
  asset_id_a: z.string().min(1, 'Asset ID A must not be empty'),
  asset_id_b: z.string().min(1, 'Asset ID B must not be empty'),
  evidence_kind: z.enum(['manual', 'seeded', 'exact_hash_observed', 'amount_time_observed']).default('manual'),
  relationship_kind: z.string().min(1, 'Relationship kind must not be empty'),
});

export const LedgerLinkingAssetIdentityRevokePayloadSchema = z.object({
  type: z.literal('ledger_linking_asset_identity_revoke'),
  asset_id_a: z.string().min(1, 'Asset ID A must not be empty'),
  asset_id_b: z.string().min(1, 'Asset ID B must not be empty'),
  relationship_kind: z.string().min(1, 'Relationship kind must not be empty'),
});

/**
 * Ledger-linking relationship accepted by the user from a review proposal.
 *
 * The payload stores allocation rows so reviewed truth can represent partial,
 * bridge, and asset-migration relationships without assuming one shared amount.
 */
export const LedgerLinkingRelationshipAcceptAllocationPayloadSchema = z.object({
  allocation_side: z.enum(['source', 'target']),
  asset_id: z.string().min(1, 'Asset ID must not be empty'),
  asset_symbol: z.string().min(1, 'Asset symbol must not be empty'),
  journal_fingerprint: z.string().min(1, 'Journal fingerprint must not be empty'),
  posting_fingerprint: z.string().min(1, 'Posting fingerprint must not be empty'),
  quantity: z
    .string()
    .min(1, 'Quantity must not be empty')
    .refine(isPositiveDecimalString, 'Quantity must be a positive decimal'),
  source_activity_fingerprint: z.string().min(1, 'Source activity fingerprint must not be empty'),
});

export const LedgerLinkingRelationshipAcceptPayloadSchema = z
  .object({
    type: z.literal('ledger_linking_relationship_accept'),
    allocations: z.array(LedgerLinkingRelationshipAcceptAllocationPayloadSchema).min(2),
    evidence: z.record(z.string(), z.unknown()),
    proposal_kind: z.string().min(1, 'Proposal kind must not be empty'),
    relationship_kind: z.string().min(1, 'Relationship kind must not be empty'),
    review_id: z.string().min(1, 'Review ID must not be empty'),
  })
  .superRefine((payload, ctx) => {
    if (!payload.allocations.some((allocation) => allocation.allocation_side === 'source')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Relationship accept allocations require at least one source allocation',
        path: ['allocations'],
      });
    }

    if (!payload.allocations.some((allocation) => allocation.allocation_side === 'target')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Relationship accept allocations require at least one target allocation',
        path: ['allocations'],
      });
    }
  });

export const LedgerLinkingRelationshipRevokePayloadSchema = z.object({
  type: z.literal('ledger_linking_relationship_revoke'),
  relationship_stable_key: z.string().min(1, 'Relationship stable key must not be empty'),
});

export const LedgerLinkingGapResolutionKindSchema = z.enum([
  'accepted_transfer_residual',
  'fiat_cash_movement',
  'likely_dust_airdrop',
  'likely_spam_airdrop',
]);

/**
 * Ledger-linking unmatched posting intentionally resolved without creating a
 * relationship.
 *
 * The payload is posting-native so replay fails closed when a reprocess changes
 * ledger identity.
 */
export const LedgerLinkingGapResolutionAcceptPayloadSchema = z.object({
  type: z.literal('ledger_linking_gap_resolution_accept'),
  asset_id: z.string().min(1, 'Asset ID must not be empty'),
  asset_symbol: z.string().min(1, 'Asset symbol must not be empty'),
  claimed_amount: z.string().min(1, 'Claimed amount must not be empty').refine(isNonNegativeDecimalString),
  direction: z.enum(['source', 'target']),
  journal_fingerprint: z.string().min(1, 'Journal fingerprint must not be empty'),
  original_amount: z.string().min(1, 'Original amount must not be empty').refine(isPositiveDecimalString),
  platform_key: z.string().min(1, 'Platform key must not be empty'),
  platform_kind: z.enum(['exchange', 'blockchain']),
  posting_fingerprint: z.string().min(1, 'Posting fingerprint must not be empty'),
  remaining_amount: z.string().min(1, 'Remaining amount must not be empty').refine(isPositiveDecimalString),
  resolution_kind: LedgerLinkingGapResolutionKindSchema,
  review_id: z.string().min(1, 'Review ID must not be empty'),
  source_activity_fingerprint: z.string().min(1, 'Source activity fingerprint must not be empty'),
});

export const LedgerLinkingGapResolutionRevokePayloadSchema = z.object({
  type: z.literal('ledger_linking_gap_resolution_revoke'),
  posting_fingerprint: z.string().min(1, 'Posting fingerprint must not be empty'),
});

function isPositiveDecimalString(value: string): boolean {
  try {
    return new Decimal(value).gt(0);
  } catch {
    return false;
  }
}

function isNonNegativeDecimalString(value: string): boolean {
  try {
    return new Decimal(value).gte(0);
  } catch {
    return false;
  }
}

/**
 * Union of all override payload types
 */
export const OverridePayloadSchema = z.discriminatedUnion('type', [
  PriceOverridePayloadSchema,
  FxOverridePayloadSchema,
  LinkOverridePayloadSchema,
  UnlinkOverridePayloadSchema,
  LinkGapResolvePayloadSchema,
  LinkGapReopenPayloadSchema,
  TransactionMovementRoleOverridePayloadSchema,
  TransactionUserNoteOverridePayloadSchema,
  AssetExcludePayloadSchema,
  AssetIncludePayloadSchema,
  AssetReviewConfirmPayloadSchema,
  AssetReviewClearPayloadSchema,
  LedgerLinkingAssetIdentityAcceptPayloadSchema,
  LedgerLinkingAssetIdentityRevokePayloadSchema,
  LedgerLinkingRelationshipAcceptPayloadSchema,
  LedgerLinkingRelationshipRevokePayloadSchema,
  LedgerLinkingGapResolutionAcceptPayloadSchema,
  LedgerLinkingGapResolutionRevokePayloadSchema,
]);

/**
 * Required pairing between scope and payload.type.
 * Prevents invalid combinations like scope:'link' with a price_override payload.
 */
const SCOPE_TO_PAYLOAD_TYPE: Record<Scope, string> = {
  price: 'price_override',
  fx: 'fx_override',
  link: 'link_override',
  unlink: 'unlink_override',
  'link-gap-resolve': 'link_gap_resolve',
  'link-gap-reopen': 'link_gap_reopen',
  'transaction-movement-role': 'transaction_movement_role_override',
  'transaction-user-note': 'transaction_user_note_override',
  'asset-exclude': 'asset_exclude',
  'asset-include': 'asset_include',
  'asset-review-confirm': 'asset_review_confirm',
  'asset-review-clear': 'asset_review_clear',
  'ledger-linking-asset-identity-accept': 'ledger_linking_asset_identity_accept',
  'ledger-linking-asset-identity-revoke': 'ledger_linking_asset_identity_revoke',
  'ledger-linking-relationship-accept': 'ledger_linking_relationship_accept',
  'ledger-linking-relationship-revoke': 'ledger_linking_relationship_revoke',
  'ledger-linking-gap-resolution-accept': 'ledger_linking_gap_resolution_accept',
  'ledger-linking-gap-resolution-revoke': 'ledger_linking_gap_resolution_revoke',
};

/**
 * Override event schema
 * Represents a single override event in the SQLite override store.
 * Enforces that scope and payload.type are consistent.
 */
export const OverrideEventSchema = z
  .object({
    id: z.string().min(1, 'Event ID must not be empty'),
    created_at: z.string().datetime(),
    profile_key: z.string().min(1, 'Profile key must not be empty'),
    actor: z.string(),
    reason: z.string().optional(),
    source: z.string(),
    scope: ScopeSchema,
    payload: OverridePayloadSchema,
  })
  .superRefine((data, ctx) => {
    const expectedType = SCOPE_TO_PAYLOAD_TYPE[data.scope];
    if (data.payload.type !== expectedType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `scope '${data.scope}' requires payload type '${expectedType}', got '${data.payload.type}'`,
        path: ['payload', 'type'],
      });
    }
  });

/**
 * Type exports inferred from schemas
 */
export type Scope = z.infer<typeof ScopeSchema>;
export type LinkAction = z.infer<typeof LinkActionSchema>;
export type LinkGapDirection = z.infer<typeof LinkGapDirectionSchema>;
export type OverrideLinkType = z.infer<typeof OverrideLinkTypeSchema>;
export type PriceOverridePayload = z.infer<typeof PriceOverridePayloadSchema>;
export type FxOverridePayload = z.infer<typeof FxOverridePayloadSchema>;
export type LinkOverridePayload = z.infer<typeof LinkOverridePayloadSchema>;
export type UnlinkOverridePayload = z.infer<typeof UnlinkOverridePayloadSchema>;
export type LinkGapResolvePayload = z.infer<typeof LinkGapResolvePayloadSchema>;
export type LinkGapReopenPayload = z.infer<typeof LinkGapReopenPayloadSchema>;
export type TransactionMovementRoleOverridePayload = z.infer<typeof TransactionMovementRoleOverridePayloadSchema>;
export type TransactionUserNoteOverridePayload = z.infer<typeof TransactionUserNoteOverridePayloadSchema>;
export type AssetExcludePayload = z.infer<typeof AssetExcludePayloadSchema>;
export type AssetIncludePayload = z.infer<typeof AssetIncludePayloadSchema>;
export type AssetReviewConfirmPayload = z.infer<typeof AssetReviewConfirmPayloadSchema>;
export type AssetReviewClearPayload = z.infer<typeof AssetReviewClearPayloadSchema>;
export type LedgerLinkingAssetIdentityAcceptPayload = z.infer<typeof LedgerLinkingAssetIdentityAcceptPayloadSchema>;
export type LedgerLinkingAssetIdentityRevokePayload = z.infer<typeof LedgerLinkingAssetIdentityRevokePayloadSchema>;
export type LedgerLinkingRelationshipAcceptPayload = z.infer<typeof LedgerLinkingRelationshipAcceptPayloadSchema>;
export type LedgerLinkingRelationshipRevokePayload = z.infer<typeof LedgerLinkingRelationshipRevokePayloadSchema>;
export type LedgerLinkingGapResolutionAcceptPayload = z.infer<typeof LedgerLinkingGapResolutionAcceptPayloadSchema>;
export type LedgerLinkingGapResolutionRevokePayload = z.infer<typeof LedgerLinkingGapResolutionRevokePayloadSchema>;
export type LedgerLinkingGapResolutionKind = z.infer<typeof LedgerLinkingGapResolutionKindSchema>;
export type OverridePayload = z.infer<typeof OverridePayloadSchema>;
export type OverrideEvent = z.infer<typeof OverrideEventSchema>;

/**
 * Options for creating an override event
 * Actor and source are hardcoded in the store (always 'user'/'cli')
 */
export interface CreateOverrideEventOptions {
  profileKey: string;
  scope: Scope;
  payload: OverrideEvent['payload'];
  reason?: string | undefined;
}

/**
 * Exact persisted link identity for override replay.
 * This matches the stricter movement/asset identity already persisted on
 * TransactionLink rows.
 */
export interface ResolvedLinkIdentity {
  sourceAssetId: string;
  sourceMovementFingerprint: string;
  targetAssetId: string;
  targetMovementFingerprint: string;
}
