import { z } from 'zod';

/**
 * Schema for Moralis transaction structure
 */
export const MoralisTransactionSchema = z.object({
  block_hash: z.string().min(1, 'Block hash must not be empty'),
  block_number: z.string().min(1, 'Block number must not be empty'),
  block_timestamp: z.string().min(1, 'Block timestamp must not be empty'),
  from_address: z.string().min(1, 'From address must not be empty'),
  gas: z.string().min(1, 'Gas must not be empty'),
  gas_price: z.string().min(1, 'Gas price must not be empty'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  input: z.string(),
  nonce: z.string().min(1, 'Nonce must not be empty'),
  receipt_contract_address: z.string().nullable(),
  receipt_cumulative_gas_used: z.string().min(1, 'Receipt cumulative gas used must not be empty'),
  receipt_gas_used: z.string().min(1, 'Receipt gas used must not be empty'),
  receipt_root: z.string(),
  receipt_status: z.string().min(1, 'Receipt status must not be empty'),
  to_address: z.string().min(1, 'To address must not be empty'),
  transaction_index: z.string().min(1, 'Transaction index must not be empty'),
  value: z.string().min(1, 'Value must not be empty'),
});

/**
 * Schema for arrays of Moralis transactions
 */
export const MoralisTransactionArraySchema = z.array(MoralisTransactionSchema);

/**
 * Schema for Moralis transaction response
 */
export const MoralisTransactionResponseSchema = z.object({
  result: z.array(MoralisTransactionSchema),
});

/**
 * Schema for Moralis token transfer structure
 */
export const MoralisTokenTransferSchema = z.object({
  address: z.string().min(1, 'Address must not be empty'),
  block_hash: z.string().min(1, 'Block hash must not be empty'),
  block_number: z.string().min(1, 'Block number must not be empty'),
  block_timestamp: z.string().min(1, 'Block timestamp must not be empty'),
  contract_type: z.string().min(1, 'Contract type must not be empty'),
  from_address: z.string().min(1, 'From address must not be empty'),
  to_address: z.string().min(1, 'To address must not be empty'),
  token_decimals: z.string().min(1, 'Token decimals must not be empty'),
  token_logo: z.string(),
  token_name: z.string().min(1, 'Token name must not be empty'),
  token_symbol: z.string().min(1, 'Token symbol must not be empty'),
  transaction_hash: z.string().min(1, 'Transaction hash must not be empty'),
  value: z.string().min(1, 'Value must not be empty'),
});

/**
 * Schema for Moralis token transfer response
 */
export const MoralisTokenTransferResponseSchema = z.object({
  result: z.array(MoralisTokenTransferSchema),
});

/**
 * Schema for Moralis token balance
 */
export const MoralisTokenBalanceSchema = z.object({
  balance: z.string().min(1, 'Balance must not be empty'),
  decimals: z.number().min(0, 'Decimals must be non-negative'),
  logo: z.string().optional(),
  name: z.string().min(1, 'Name must not be empty'),
  symbol: z.string().min(1, 'Symbol must not be empty'),
  token_address: z.string().min(1, 'Token address must not be empty'),
});

/**
 * Schema for Moralis native balance
 */
export const MoralisNativeBalanceSchema = z.object({
  balance: z.string().min(1, 'Balance must not be empty'),
});
