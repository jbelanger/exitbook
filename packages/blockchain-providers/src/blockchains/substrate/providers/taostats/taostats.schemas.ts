/**
 * Zod validation schemas for Taostats API response data (Bittensor network)
 */
import { z } from 'zod';

import { timestampToDate } from '../../../../core/utils/zod-utils.js';
import { SubstrateAddressSchema } from '../../schemas.js';

/**
 * Schema for Taostats address structure
 */
export const TaostatsAddressSchema = z.object({
  hex: z.string().min(1, 'Hex address must not be empty'),
  ss58: SubstrateAddressSchema,
});

/**
 * Schema for raw Taostats transaction structure (actual API response)
 */
export const TaostatsTransactionSchema = z.object({
  amount: z.string().regex(/^\d+$/, 'Amount must be a numeric string'),
  block_number: z.number().nonnegative('Block number must be non-negative'),
  extrinsic_id: z.string().min(1, 'Extrinsic ID must not be empty'),
  fee: z.string().regex(/^\d+$/, 'Fee must be a numeric string').optional(),
  from: TaostatsAddressSchema,
  id: z.string().min(1, 'ID must not be empty'),
  network: z.string().min(1, 'Network must not be empty'),
  timestamp: timestampToDate,
  to: TaostatsAddressSchema,
  transaction_hash: z.string().min(1, 'Transaction hash must not be empty'),
});

/**
 * Schema for Taostats account data in balance response
 */
export const TaostatsAccountDataSchema = z.object({
  address: TaostatsAddressSchema,
  alpha_balances: z.unknown().optional(),
  alpha_balances_24hr_ago: z.unknown().optional(),
  balance_free: z.string(),
  balance_free_24hr_ago: z.string().optional(),
  balance_staked: z.string(),
  balance_staked_24hr_ago: z.string().optional(),
  balance_staked_alpha_as_tao: z.string(),
  balance_staked_alpha_as_tao_24hr_ago: z.string().optional(),
  balance_staked_root: z.string(),
  balance_staked_root_24hr_ago: z.string().optional(),
  balance_total: z.string(),
  balance_total_24hr_ago: z.string().optional(),
  block_number: z.number(),
  coldkey_swap: z.string().optional(),
  created_on_date: z.string(),
  created_on_network: z.string(),
  network: z.string(),
  rank: z.number(),
  timestamp: z.string(),
});

/**
 * Schema for Taostats balance response
 */
export const TaostatsBalanceResponseSchema = z.object({
  data: z.array(TaostatsAccountDataSchema).optional(),
});

// Type exports inferred from schemas
export type TaostatsAddress = z.infer<typeof TaostatsAddressSchema>;
export type TaostatsTransaction = z.infer<typeof TaostatsTransactionSchema>;
export type TaostatsAccountData = z.infer<typeof TaostatsAccountDataSchema>;
export type TaostatsBalanceResponse = z.infer<typeof TaostatsBalanceResponseSchema>;
