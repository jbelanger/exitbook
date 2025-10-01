import { z } from 'zod';

/**
 * Schema for ThetaScan transaction structure
 */
export const ThetaScanTransactionSchema = z.object({
  block: z.string().min(1, 'Block must not be empty'),
  fee_tfuel: z.number(),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  recieving_address: z.string().min(1, 'Receiving address must not be empty'),
  sending_address: z.string().min(1, 'Sending address must not be empty'),
  tfuel: z.string(),
  theta: z.string(),
  timestamp: z.number(),
  // Optional fields for token transfers
  contract_address: z.string().optional(),
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
  tfuel: z.string(),
  tfuel_staked: z.string(),
  theta: z.string(),
  theta_staked: z.string(),
});

/**
 * Schema for ThetaScan token balance
 */
export const ThetaScanTokenBalanceSchema = z.object({
  balance: z.string(),
  contract_address: z.string(),
  token_decimals: z.number().optional(),
  token_name: z.string().optional(),
  token_symbol: z.string().optional(),
});
