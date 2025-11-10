/**
 * Zod validation schemas for Cardano transaction data formats
 *
 * These schemas validate the structure and content of transaction data
 * from different Cardano API providers before processing.
 */
import { z } from 'zod';

/**
 * Cardano address schema with validation but NO case transformation.
 *
 * Supports both Byron-era and Shelley-era addresses:
 *
 * Byron-era addresses (base58 encoding):
 * - Start with prefixes: Ae2, DdzFF
 * - Case-sensitive
 * - Use base58 charset (alphanumeric excluding 0, O, I, l)
 *
 * Shelley-era addresses (Bech32 encoding):
 * - Mainnet payment addresses: addr1...
 * - Mainnet stake addresses: stake1...
 * - Testnet payment addresses: addr_test1...
 * - Testnet stake addresses: stake_test1...
 * - Case-sensitive (must be lowercase)
 * - Uses charset: a-z and 0-9 (no uppercase)
 *
 * Examples:
 * - 'DdzFFzCqrht...' (Byron mainnet address)
 * - 'addr1qxy...' (Shelley mainnet payment address)
 * - 'stake1uxyz...' (Shelley mainnet stake address)
 *
 * Invalid casing will fail validation naturally through the regex pattern.
 */
export const CardanoAddressSchema = z
  .string()
  .min(1, 'Cardano address must not be empty')
  .regex(
    /^(addr1|addr_test1|stake1|stake_test1|Ae2|DdzFF)[A-Za-z0-9]+$/,
    'Cardano address must be a valid Byron (Ae2..., DdzFF...) or Shelley (addr1..., stake1...) address'
  );

/**
 * Numeric string validator for amounts/values
 * Ensures string can be parsed as a valid number
 */
const numericString = z
  .string()
  .refine((val) => !isNaN(parseFloat(val)) && isFinite(parseFloat(val)), { message: 'Must be a valid numeric string' });

/**
 * Schema for Cardano asset amount (ADA or native token)
 */
export const CardanoAssetAmountSchema = z.object({
  decimals: z.number().nonnegative('Decimals must be non-negative').optional(),
  quantity: numericString,
  symbol: z.string().optional(),
  unit: z.string().min(1, 'Asset unit must not be empty'),
});

/**
 * Schema for Cardano transaction input
 */
export const CardanoTransactionInputSchema = z.object({
  address: CardanoAddressSchema,
  amounts: z.array(CardanoAssetAmountSchema).min(1, 'Input must have at least one asset'),
  outputIndex: z.number().nonnegative('Output index must be non-negative'),
  txHash: z.string().min(1, 'Transaction hash must not be empty'),
});

/**
 * Schema for Cardano transaction output
 */
export const CardanoTransactionOutputSchema = z.object({
  address: CardanoAddressSchema,
  amounts: z.array(CardanoAssetAmountSchema).min(1, 'Output must have at least one asset'),
  outputIndex: z.number().nonnegative('Output index must be non-negative'),
});

/**
 * Schema for normalized Cardano transaction
 */
export const CardanoTransactionSchema = z.object({
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),
  currency: z.literal('ADA'),
  feeAmount: numericString.optional(),
  feeCurrency: z.string().optional(),
  id: z.string().min(1, 'Transaction ID must not be empty'),
  inputs: z.array(CardanoTransactionInputSchema).min(1, 'Transaction must have at least one input'),
  outputs: z.array(CardanoTransactionOutputSchema).min(1, 'Transaction must have at least one output'),
  providerName: z.string().min(1, 'Provider Name must not be empty'),
  status: z.enum(['success', 'failed', 'pending']),
  timestamp: z.number().positive('Timestamp must be positive'),
});

// Type exports inferred from schemas (single source of truth)
export type CardanoAssetAmount = z.infer<typeof CardanoAssetAmountSchema>;
export type CardanoTransactionInput = z.infer<typeof CardanoTransactionInputSchema>;
export type CardanoTransactionOutput = z.infer<typeof CardanoTransactionOutputSchema>;
export type CardanoTransaction = z.infer<typeof CardanoTransactionSchema>;
