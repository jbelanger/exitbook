import { z } from 'zod';

import { timestampToDate } from '../../../../shared/blockchain/utils/zod-utils.js';
import { EvmAddressSchema } from '../../schemas.js';

const ThetaScanNumericStringSchema = z
  .string()
  .regex(/^-?\d{1,3}(,\d{3})*(\.\d+)?$/, 'Value must be numeric string with optional commas');

const ThetaScanNumericValueSchema = z.union([ThetaScanNumericStringSchema, z.number()]);

/**
 * Schema for ThetaScan transaction structure
 */
export const ThetaScanTransactionSchema = z.object({
  block: z.string().regex(/^\d+$/, 'Block must be numeric string'),
  fee_tfuel: z.number(),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  recieving_address: EvmAddressSchema,
  sending_address: EvmAddressSchema,
  tfuel: ThetaScanNumericStringSchema,
  theta: ThetaScanNumericStringSchema,
  timestamp: timestampToDate,
  // Optional fields for token transfers
  contract_address: EvmAddressSchema.optional(),
  token_name: z.string().optional(),
  token_symbol: z.string().optional(),
  type: z.string().optional(),
});

/**
 * Schema for arrays of ThetaScan transactions
 */
export const ThetaScanTransactionArraySchema = z.array(ThetaScanTransactionSchema);

/**
 * Schema for ThetaScan balance response
 */
export const ThetaScanBalanceResponseSchema = z.object({
  tfuel: ThetaScanNumericValueSchema,
  tfuel_staked: ThetaScanNumericValueSchema,
  theta: ThetaScanNumericValueSchema,
  theta_staked: ThetaScanNumericValueSchema,
});

/**
 * Schema for ThetaScan token balance
 */
export const ThetaScanTokenBalanceSchema = z.object({
  balance: ThetaScanNumericValueSchema,
  contract_address: EvmAddressSchema,
  token_decimals: z.number().optional(),
  token_name: z.string().optional(),
  token_symbol: z.string().optional(),
});

// Type exports inferred from schemas
export type ThetaScanTransaction = z.infer<typeof ThetaScanTransactionSchema>;
export type ThetaScanBalanceResponse = z.infer<typeof ThetaScanBalanceResponseSchema>;
export type ThetaScanTokenBalance = z.infer<typeof ThetaScanTokenBalanceSchema>;
