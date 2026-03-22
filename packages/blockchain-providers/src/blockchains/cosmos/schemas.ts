import { DecimalStringSchema } from '@exitbook/foundation';
import { z } from 'zod';

import { NormalizedTransactionBaseSchema } from '../../contracts/normalized-transaction.js';

import { validateBech32Address } from './utils.js';

/** Normalizes any address-like string to lowercase without structural validation (for Ethereum hex addresses, denoms, etc.). */
const LowercaseStringSchema = z.string().transform((s) => s.toLowerCase());

/**
 * Cosmos address schema with Bech32 validation and automatic lowercase normalization.
 *
 * Validates that the input is a structurally valid Bech32 address (correct checksum,
 * non-empty data payload) before normalizing to lowercase.
 *
 * Examples:
 * - "inj1abc..." → "inj1abc..." (already lowercase)
 * - "INJ1ABC..." → "inj1abc..." (normalized to lowercase)
 * - "not-an-address" → validation error
 */
export const CosmosAddressSchema = z
  .string()
  .refine((addr) => validateBech32Address(addr.toLowerCase()), { message: 'Invalid Bech32 address' })
  .transform((addr) => addr.toLowerCase());

/**
 * Schema for unified Cosmos SDK transaction
 *
 * Validates transactions from all Cosmos SDK-based chains (Injective, Osmosis, Cosmos Hub, etc.)
 * Supports the superset of features across all Cosmos SDK chains including:
 * - Message-based transactions (MsgSend, MsgTransfer, MsgExecuteContract)
 * - IBC transfers
 * - Bridge operations (Peggy, Gravity Bridge)
 * - CosmWasm contract interactions
 *
 * Extends NormalizedTransactionBaseSchema to ensure consistent identity handling.
 * The eventId field is computed by providers during normalization using
 * generateUniqueTransactionEventId() with Cosmos-specific discriminating fields
 * (e.g., message index, event attributes for transactions with multiple messages).
 */
export const CosmosTransactionSchema = NormalizedTransactionBaseSchema.extend({
  // Core transaction data
  timestamp: z.number().positive('Timestamp must be positive'),
  status: z.enum(['success', 'failed', 'pending']),

  // Transaction flow. Cosmos bech32 for native/IBC txns; Ethereum hex for Peggy bridge deposits/withdrawals.
  from: LowercaseStringSchema,
  to: LowercaseStringSchema,

  // Value information
  amount: DecimalStringSchema,
  currency: z.string().min(1, 'Currency must not be empty'),

  // Block context
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),

  // Provider identification
  providerName: z.string().min(1, 'Provider Name must not be empty'),

  // Cosmos-specific metadata
  messageType: z.string().optional(),
  memo: z.string().optional(),
  txType: z.string().optional(),

  // Gas information
  gasUsed: z.number().nonnegative().optional(),
  gasWanted: z.number().nonnegative().optional(),
  gasPrice: DecimalStringSchema.optional(),

  // Fee information
  feeAmount: DecimalStringSchema.optional(),
  feeCurrency: z.string().optional(),

  // Token-specific information (tokenAddress can be a bech32 contract address OR a denom string like 'usdc', 'uakt')
  tokenAddress: LowercaseStringSchema.optional(),
  tokenDecimals: z.number().nonnegative().optional(),
  tokenSymbol: z.string().optional(),
  tokenType: z.enum(['cw20', 'native', 'ibc']).optional(),

  // IBC-specific information
  sourceChannel: z.string().optional(),
  sourcePort: z.string().optional(),
  destinationChannel: z.string().optional(),
  destinationPort: z.string().optional(),
  ibcDenom: z.string().optional(),

  // Bridge information
  bridgeType: z.enum(['peggy', 'gravity', 'ibc', 'native']).optional(),
  bridgeId: z.string().optional(),

  // Injective Peggy bridge-specific (Ethereum hex addresses, normalized to lowercase)
  ethereumSender: LowercaseStringSchema.optional(),
  ethereumReceiver: LowercaseStringSchema.optional(),
  eventNonce: z.string().optional(),
  claimId: z.array(z.number()).optional(),

  // Gravity Bridge-specific
  gravityNonce: z.string().optional(),
  gravityBatchNonce: z.string().optional(),

  // CosmWasm contract-specific
  contractAddress: CosmosAddressSchema.optional(),
  contractAction: z.string().optional(),
  contractResult: z.string().optional(),
}).refine(
  (data) => {
    // Validation: CW20 and IBC token transfers MUST have tokenAddress (denom)
    if (data.tokenType && (data.tokenType === 'cw20' || data.tokenType === 'ibc')) {
      if (!data.tokenAddress) {
        return false;
      }
    }
    return true;
  },
  {
    message:
      'CW20 and IBC token transfers must have tokenAddress (denom). ' +
      'Import should fail if this data is missing from provider.',
  }
);

/**
 * Type inferred from schema (schema-first approach)
 */
export type CosmosTransaction = z.infer<typeof CosmosTransactionSchema>;
