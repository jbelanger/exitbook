/**
 * Zod validation schemas for Cardano transaction data formats
 *
 * These schemas validate the structure and content of transaction data
 * from different Cardano API providers before processing.
 */
import { DecimalStringSchema } from '@exitbook/foundation';
import { z } from 'zod';

import { NormalizedTransactionBaseSchema } from '../../contracts/normalized-transaction.js';

import { normalizeCardanoAddress } from './utils.js';

/**
 * Cardano address schema with normalization.
 *
 * Supports both Byron-era and Shelley-era addresses:
 *
 * Byron-era addresses (base58 encoding):
 * - Start with prefixes: Ae2, DdzFF
 * - Case-sensitive (preserved)
 * - Use base58 charset (alphanumeric excluding 0, O, I, l)
 *
 * Shelley-era addresses (Bech32 encoding):
 * - Mainnet payment addresses: addr1...
 * - Mainnet stake addresses: stake1...
 * - Testnet payment addresses: addr_test1...
 * - Testnet stake addresses: stake_test1...
 * - Normalized to lowercase (Bech32 must be lowercase)
 * - Uses charset: a-z and 0-9 (no uppercase)
 *
 * Examples:
 * - 'DdzFFzCqrht...' (Byron mainnet address - case preserved)
 * - 'addr1qxy...' (Shelley mainnet payment address - lowercased)
 * - 'stake1uxyz...' (Shelley mainnet stake address - lowercased)
 */
export const CardanoAddressSchema = z
  .string()
  .min(1, 'Cardano address must not be empty')
  .transform((val) => normalizeCardanoAddress(val))
  .refine(
    (val) => /^(addr1|addr_test1|stake1|stake_test1|Ae2|DdzFF)[A-Za-z0-9]+$/.test(val),
    'Cardano address must be a valid Byron (Ae2..., DdzFF...) or Shelley (addr1..., stake1...) address'
  );

/**
 * Schema for Cardano asset amount (ADA or native token)
 */
const CardanoAssetAmountSchema = z.object({
  decimals: z.number().nonnegative('Decimals must be non-negative').optional(),
  quantity: DecimalStringSchema,
  symbol: z.string().optional(),
  unit: z.string().min(1, 'Asset unit must not be empty'),
});

/**
 * Schema for Cardano transaction input
 */
const CardanoTransactionInputSchema = z.object({
  address: CardanoAddressSchema,
  amounts: z.array(CardanoAssetAmountSchema).min(1, 'Input must have at least one asset'),
  isCollateral: z.boolean().optional(),
  isReference: z.boolean().optional(),
  outputIndex: z.number().nonnegative('Output index must be non-negative'),
  txHash: z.string().min(1, 'Transaction hash must not be empty'),
});

/**
 * Schema for Cardano transaction output
 */
const CardanoTransactionOutputSchema = z.object({
  address: CardanoAddressSchema,
  amounts: z.array(CardanoAssetAmountSchema).min(1, 'Output must have at least one asset'),
  isCollateral: z.boolean().optional(),
  isReference: z.boolean().optional(),
  outputIndex: z.number().nonnegative('Output index must be non-negative'),
});

/**
 * Schema for Cardano staking reward withdrawals.
 *
 * Cardano reward withdrawals are wallet-scope balance movements sourced from a
 * stake address, not from a spent UTXO. Providers surface them separately from
 * normal inputs/outputs.
 */
const CardanoWithdrawalSchema = z.object({
  address: CardanoAddressSchema,
  amount: DecimalStringSchema,
  currency: z.literal('ADA'),
});

/**
 * Schema for Cardano stake address registration certificates.
 *
 * These certificates do not describe a token transfer by themselves. They
 * explain protocol-level balance changes such as refundable stake key
 * deposits and refunds, so processors must receive them alongside UTXOs.
 */
const CardanoStakeCertificateSchema = z.object({
  action: z.enum(['registration', 'deregistration']),
  address: CardanoAddressSchema,
  certificateIndex: z.number().int().nonnegative('Certificate index must be non-negative'),
});

/**
 * Schema for Cardano delegation certificates.
 *
 * Delegations change staking participation and pool routing. They usually
 * have no direct asset posting beyond the transaction fee, but they are
 * accounting-owned evidence because they disambiguate staking lifecycle events.
 */
const CardanoDelegationCertificateSchema = z.object({
  activeEpoch: z.number().int().nonnegative('Active epoch must be non-negative'),
  address: CardanoAddressSchema,
  certificateIndex: z.number().int().nonnegative('Certificate index must be non-negative'),
  poolId: z.string().min(1, 'Pool ID must not be empty'),
});

/**
 * Schema for Cardano MIR certificates.
 *
 * MIR certificates can credit stake addresses from reserves or treasury. They
 * are reward-like accounting facts, distinct from ordinary reward withdrawals.
 */
const CardanoMirCertificateSchema = z.object({
  address: CardanoAddressSchema,
  amount: DecimalStringSchema,
  certificateIndex: z.number().int().nonnegative('Certificate index must be non-negative'),
  pot: z.enum(['reserve', 'treasury']),
});

/**
 * Schema for normalized Cardano transaction
 *
 * Extends NormalizedTransactionBaseSchema to ensure consistent identity handling.
 * The eventId field is computed by providers during normalization using
 * generateUniqueTransactionEventId() with Cardano-specific discriminating fields
 * (e.g., output index and asset unit for transactions with multiple outputs/assets).
 */
export const CardanoTransactionSchema = NormalizedTransactionBaseSchema.extend({
  // Cardano-specific transaction data
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),
  currency: z.literal('ADA'),
  feeAmount: DecimalStringSchema.optional(),
  feeCurrency: z.string().optional(),
  inputs: z.array(CardanoTransactionInputSchema).min(1, 'Transaction must have at least one input'),
  outputs: z.array(CardanoTransactionOutputSchema).min(1, 'Transaction must have at least one output'),
  providerName: z.string().min(1, 'Provider Name must not be empty'),
  status: z.enum(['success', 'failed', 'pending']),
  timestamp: z.number().positive('Timestamp must be positive'),
  delegationCertificates: z.array(CardanoDelegationCertificateSchema).optional(),
  protocolDepositDeltaAmount: DecimalStringSchema.optional(),
  mirCertificates: z.array(CardanoMirCertificateSchema).optional(),
  stakeCertificates: z.array(CardanoStakeCertificateSchema).optional(),
  treasuryDonationAmount: DecimalStringSchema.optional(),
  withdrawals: z.array(CardanoWithdrawalSchema).optional(),
});

// Type exports inferred from schemas (single source of truth)
export type CardanoAssetAmount = z.infer<typeof CardanoAssetAmountSchema>;
export type CardanoTransactionInput = z.infer<typeof CardanoTransactionInputSchema>;
export type CardanoTransactionOutput = z.infer<typeof CardanoTransactionOutputSchema>;
export type CardanoWithdrawal = z.infer<typeof CardanoWithdrawalSchema>;
export type CardanoStakeCertificate = z.infer<typeof CardanoStakeCertificateSchema>;
export type CardanoDelegationCertificate = z.infer<typeof CardanoDelegationCertificateSchema>;
export type CardanoMirCertificate = z.infer<typeof CardanoMirCertificateSchema>;
export type CardanoTransaction = z.infer<typeof CardanoTransactionSchema>;
