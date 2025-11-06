import { z } from 'zod';

/**
 * Substrate address schema (SS58 format)
 *
 * SS58 addresses are base58-encoded strings that represent public keys on Substrate-based
 * chains (Polkadot, Kusama, Bittensor, etc.). Unlike EVM addresses, SS58 addresses are
 * case-sensitive because they use base58 encoding (similar to Bitcoin and Solana).
 *
 * The same public key can have different SS58 address representations depending on the
 * network format prefix (e.g., Polkadot format 0, Kusama format 2, Generic format 42).
 * Use `isSamePolkadotAddress()` from utils.js to compare addresses by their underlying
 * public key.
 *
 * IMPORTANT: No transformation is applied. Different casing = different addresses.
 * Example: '5GrwvaEF...' and '5grwvaef...' are DIFFERENT addresses.
 *
 * @see {@link https://docs.substrate.io/reference/address-formats/}
 */
export const SubstrateAddressSchema = z.string().min(1, 'Address must not be empty');

/**
 * Numeric string validator for amounts/values
 */
const numericString = z
  .string()
  .refine((val) => !isNaN(parseFloat(val)) && isFinite(parseFloat(val)), { message: 'Must be a valid numeric string' });

/**
 * Schema for Substrate event data
 */
export const SubstrateEventDataSchema = z.object({
  data: z.array(z.unknown()),
  method: z.string(),
  section: z.string(),
});

/**
 * Schema for normalized Substrate transaction
 */
export const SubstrateTransactionSchema = z.object({
  amount: numericString,
  args: z.unknown().optional(),
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),
  call: z.string().optional(),
  chainName: z.string().optional(),
  currency: z.string().min(1, 'Currency must not be empty'),
  events: z.array(SubstrateEventDataSchema).optional(),
  extrinsicIndex: z.string().optional(),
  feeAmount: numericString.optional(),
  feeCurrency: z.string().optional(),
  from: SubstrateAddressSchema,
  genesisHash: z.string().optional(),
  id: z.string().min(1, 'Transaction ID must not be empty'),
  module: z.string().optional(),
  nonce: z.number().nonnegative().optional(),
  providerId: z.string().min(1, 'Provider ID must not be empty'),
  signature: z.string().optional(),
  ss58Format: z.number().nonnegative().optional(),
  status: z.enum(['success', 'failed', 'pending']),
  timestamp: z.number().positive('Timestamp must be positive'),
  tip: numericString.optional(),
  to: SubstrateAddressSchema,
});

// Type exports inferred from schemas (single source of truth)
export type SubstrateTransaction = z.infer<typeof SubstrateTransactionSchema>;
export type SubstrateEventData = z.infer<typeof SubstrateEventDataSchema>;
