import { z } from 'zod';

/**
 * Schema for ThetaScan transaction structure
 */
export const ThetaScanTransactionSchema = z.object({
  block: z.string().regex(/^\d+$/, 'Block must be numeric string'),
  fee_tfuel: z.number(),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  recieving_address: z.string().min(1, 'Receiving address must not be empty'),
  sending_address: z.string().min(1, 'Sending address must not be empty'),
  tfuel: z.string().regex(/^-?\d{1,3}(,\d{3})*(\.\d+)?$/, 'TFuel must be numeric string with optional commas'),
  theta: z.string().regex(/^-?\d{1,3}(,\d{3})*(\.\d+)?$/, 'Theta must be numeric string with optional commas'),
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
  tfuel: z.string().regex(/^-?\d{1,3}(,\d{3})*(\.\d+)?$/, 'TFuel must be numeric string with optional commas'),
  tfuel_staked: z
    .string()
    .regex(/^-?\d{1,3}(,\d{3})*(\.\d+)?$/, 'TFuel staked must be numeric string with optional commas'),
  theta: z.string().regex(/^-?\d{1,3}(,\d{3})*(\.\d+)?$/, 'Theta must be numeric string with optional commas'),
  theta_staked: z
    .string()
    .regex(/^-?\d{1,3}(,\d{3})*(\.\d+)?$/, 'Theta staked must be numeric string with optional commas'),
});

/**
 * Schema for ThetaScan token balance
 */
export const ThetaScanTokenBalanceSchema = z.object({
  balance: z.string().regex(/^-?\d{1,3}(,\d{3})*(\.\d+)?$/, 'Balance must be numeric string with optional commas'),
  contract_address: z.string(),
  token_decimals: z.number().optional(),
  token_name: z.string().optional(),
  token_symbol: z.string().optional(),
});
