import { z } from 'zod';

/**
 * Scope/domain of the override
 */
export const ScopeSchema = z.enum(['price', 'fx', 'link', 'unlink']);

/**
 * Link action type - confirm an existing suggested link
 */
export const LinkActionSchema = z.enum(['confirm']);

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
export const LinkOverridePayloadSchema = z.object({
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
 * Union of all override payload types
 */
export const OverridePayloadSchema = z.discriminatedUnion('type', [
  PriceOverridePayloadSchema,
  FxOverridePayloadSchema,
  LinkOverridePayloadSchema,
  UnlinkOverridePayloadSchema,
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
export type OverrideLinkType = z.infer<typeof OverrideLinkTypeSchema>;
export type PriceOverridePayload = z.infer<typeof PriceOverridePayloadSchema>;
export type FxOverridePayload = z.infer<typeof FxOverridePayloadSchema>;
export type LinkOverridePayload = z.infer<typeof LinkOverridePayloadSchema>;
export type UnlinkOverridePayload = z.infer<typeof UnlinkOverridePayloadSchema>;
export type OverridePayload = z.infer<typeof OverridePayloadSchema>;
export type OverrideEvent = z.infer<typeof OverrideEventSchema>;

/**
 * Options for creating an override event
 * Actor and source are hardcoded in the store (always 'user'/'cli')
 */
export interface CreateOverrideEventOptions {
  scope: Scope;
  payload: OverrideEvent['payload'];
  reason?: string | undefined;
}

/**
 * Transaction fingerprint components
 * Simplified version using source_name:external_id pattern
 */
export interface TransactionFingerprintInput {
  source: string;
  externalId: string;
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

/**
 * Movement fingerprint components
 * Deterministic identity for a movement within a transaction.
 * Uses position-based identity (not DB row ids) so it survives movement rebuilds.
 */
export interface MovementFingerprintInput {
  txFingerprint: string; // source_name:external_id
  movementType: 'inflow' | 'outflow' | 'fee';
  position: number; // 0-based index within movements of this type
}
