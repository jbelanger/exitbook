import { z } from 'zod';

import { EvmAddressSchema } from '../../schemas.js';

/**
 * Constant representing the beacon chain as a synthetic "from" address.
 * Used for consensus layer withdrawals since they don't originate from a specific address.
 */
export const BEACON_CHAIN_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Schema for Etherscan beacon chain withdrawal structure.
 *
 * Etherscan API returns withdrawals with amounts in Gwei.
 * These need to be converted to Wei (multiply by 10^9) during mapping.
 */
export const EtherscanBeaconWithdrawalSchema = z.object({
  withdrawalIndex: z.string().regex(/^\d+$/, 'Withdrawal index must be numeric string'),
  validatorIndex: z.string().regex(/^\d+$/, 'Validator index must be numeric string'),
  address: EvmAddressSchema,
  amount: z.string().regex(/^\d+$/, 'Amount must be numeric string (in Gwei)'),
  blockNumber: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
  timestamp: z.string().regex(/^\d+$/, 'Timestamp must be numeric string'),
});

/**
 * Schema for Etherscan API response wrapper.
 *
 * Status codes:
 * - '1': Success
 * - '0': Error
 */
export const EtherscanBeaconWithdrawalResponseSchema = z.object({
  status: z.enum(['0', '1']),
  message: z.string(),
  result: z.union([z.array(EtherscanBeaconWithdrawalSchema), z.string()]),
});

/**
 * Schema for Etherscan normal transaction (txlist endpoint).
 *
 * Returns standard EVM transactions including contract deployments.
 * V2 API changes: added gasPriceBid for L2 chains
 */
export const EtherscanNormalTransactionSchema = z.object({
  blockNumber: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
  timeStamp: z.string().regex(/^\d+$/, 'Timestamp must be numeric string'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  nonce: z.string().regex(/^\d+$/, 'Nonce must be numeric string'),
  blockHash: z.string().min(1, 'Block hash must not be empty'),
  transactionIndex: z.string().regex(/^\d+$/, 'Transaction index must be numeric string'),
  from: EvmAddressSchema,
  to: EvmAddressSchema.or(z.literal('')), // Empty string for contract deployments
  value: z.string().regex(/^\d+$/, 'Value must be numeric string (in Wei)'),
  gas: z.string().regex(/^\d+$/, 'Gas must be numeric string'),
  gasPrice: z.string().regex(/^\d+$/, 'Gas price must be numeric string'),
  gasPriceBid: z.string().regex(/^\d+$/, 'Gas price bid must be numeric string').nullish(), // V2 API: L2 chains (Arbitrum)
  isError: z.enum(['0', '1']), // '0' = success, '1' = error
  txreceipt_status: z.enum(['0', '1', '']).nullish(), // '0' = failed, '1' = success, '' = pre-byzantium
  input: z.string(), // Hex string of contract method call data
  contractAddress: z.string(), // Empty string or address for contract deployments
  cumulativeGasUsed: z.string().regex(/^\d+$/, 'Cumulative gas used must be numeric string'),
  gasUsed: z.string().regex(/^\d+$/, 'Gas used must be numeric string'),
  confirmations: z.string().regex(/^\d+$/, 'Confirmations must be numeric string'),
  methodId: z.string(), // First 4 bytes of input (function selector)
  functionName: z.string().nullish(), // Decoded function name if available (optional in Blockscout)
});

/**
 * Schema for Etherscan internal transaction (txlistinternal endpoint).
 *
 * Returns internal transactions (contract calls) triggered by smart contracts.
 */
export const EtherscanInternalTransactionSchema = z.object({
  blockNumber: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
  timeStamp: z.string().regex(/^\d+$/, 'Timestamp must be numeric string'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  from: EvmAddressSchema,
  to: EvmAddressSchema.nullish(), // Can be null for contract creation
  value: z.string().regex(/^\d+$/, 'Value must be numeric string (in Wei)'),
  contractAddress: EvmAddressSchema.nullish(), // Present for CREATE/CREATE2
  input: z.string(), // Hex string
  type: z.string(), // 'call', 'create', 'create2', 'delegatecall', 'staticcall', etc.
  gas: z.string().regex(/^\d+$/, 'Gas must be numeric string'),
  gasUsed: z.string().regex(/^\d+$/, 'Gas used must be numeric string'),
  traceId: z.string().nullish(), // Trace ID for ordering internal transactions
  isError: z.enum(['0', '1']), // '0' = success, '1' = error
  errCode: z.string().nullish(), // Error code if isError = '1'
});

/**
 * Schema for Etherscan ERC-20 token transfer (tokentx endpoint).
 *
 * Returns ERC-20 token transfer events.
 * V2 API changes: removed logIndex, added methodId and functionName
 */
export const EtherscanTokenTransactionSchema = z.object({
  blockNumber: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
  timeStamp: z.string().regex(/^\d+$/, 'Timestamp must be numeric string'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  nonce: z.string().regex(/^\d+$/, 'Nonce must be numeric string'),
  blockHash: z.string().min(1, 'Block hash must not be empty'),
  from: EvmAddressSchema,
  contractAddress: EvmAddressSchema, // Token contract address
  to: EvmAddressSchema,
  value: z.string().regex(/^\d+$/, 'Value must be numeric string (in smallest token unit)'),
  tokenName: z.string(),
  tokenSymbol: z.string(),
  tokenDecimal: z.string().regex(/^\d+$/, 'Token decimal must be numeric string'),
  transactionIndex: z.string().regex(/^\d+$/, 'Transaction index must be numeric string'),
  gas: z.string().regex(/^\d+$/, 'Gas must be numeric string'),
  gasPrice: z.string().regex(/^\d+$/, 'Gas price must be numeric string'),
  gasUsed: z.string().regex(/^\d+$/, 'Gas used must be numeric string'),
  cumulativeGasUsed: z.string().regex(/^\d+$/, 'Cumulative gas used must be numeric string'),
  input: z.string(), // Deprecated field in V2
  methodId: z.string(), // V2 API: function signature hash
  functionName: z.string().nullish(), // V2 API: decoded function name (optional in Blockscout)
  confirmations: z.string().regex(/^\d+$/, 'Confirmations must be numeric string'),
});

/**
 * Schema for Etherscan ERC-721/ERC-1155 NFT transfer (tokennfttx endpoint).
 *
 * Returns ERC-721 and ERC-1155 token transfer events.
 */
export const EtherscanNftTransactionSchema = z.object({
  blockNumber: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
  timeStamp: z.string().regex(/^\d+$/, 'Timestamp must be numeric string'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  nonce: z.string().regex(/^\d+$/, 'Nonce must be numeric string'),
  blockHash: z.string().min(1, 'Block hash must not be empty'),
  from: EvmAddressSchema,
  contractAddress: EvmAddressSchema, // NFT contract address
  to: EvmAddressSchema,
  tokenID: z.string(), // Token ID (can be very large number as string)
  tokenName: z.string().nullish(),
  tokenSymbol: z.string().nullish(),
  tokenDecimal: z.string().regex(/^\d+$/, 'Token decimal must be numeric string').nullish(), // Usually 0 for NFTs
  transactionIndex: z.string().regex(/^\d+$/, 'Transaction index must be numeric string'),
  gas: z.string().regex(/^\d+$/, 'Gas must be numeric string'),
  gasPrice: z.string().regex(/^\d+$/, 'Gas price must be numeric string'),
  gasUsed: z.string().regex(/^\d+$/, 'Gas used must be numeric string'),
  cumulativeGasUsed: z.string().regex(/^\d+$/, 'Cumulative gas used must be numeric string'),
  input: z.string().nullish(), // Deprecated field
  confirmations: z.string().regex(/^\d+$/, 'Confirmations must be numeric string'),
});

/**
 * Schema for Etherscan API response wrapper for normal transactions.
 */
export const EtherscanNormalTransactionResponseSchema = z.object({
  status: z.enum(['0', '1']),
  message: z.string(),
  result: z.union([z.array(EtherscanNormalTransactionSchema), z.string()]),
});

/**
 * Schema for Etherscan API response wrapper for internal transactions.
 */
export const EtherscanInternalTransactionResponseSchema = z.object({
  status: z.enum(['0', '1']),
  message: z.string(),
  result: z.union([z.array(EtherscanInternalTransactionSchema), z.string()]),
});

/**
 * Schema for Etherscan API response wrapper for token transactions.
 */
export const EtherscanTokenTransactionResponseSchema = z.object({
  status: z.enum(['0', '1']),
  message: z.string(),
  result: z.union([z.array(EtherscanTokenTransactionSchema), z.string()]),
});

/**
 * Schema for Etherscan API response wrapper for NFT transactions.
 */
export const EtherscanNftTransactionResponseSchema = z.object({
  status: z.enum(['0', '1']),
  message: z.string(),
  result: z.union([z.array(EtherscanNftTransactionSchema), z.string()]),
});

// Type exports
export type EtherscanBeaconWithdrawal = z.infer<typeof EtherscanBeaconWithdrawalSchema>;
export type EtherscanBeaconWithdrawalResponse = z.infer<typeof EtherscanBeaconWithdrawalResponseSchema>;
export type EtherscanNormalTransaction = z.infer<typeof EtherscanNormalTransactionSchema>;
export type EtherscanInternalTransaction = z.infer<typeof EtherscanInternalTransactionSchema>;
export type EtherscanTokenTransaction = z.infer<typeof EtherscanTokenTransactionSchema>;
export type EtherscanNftTransaction = z.infer<typeof EtherscanNftTransactionSchema>;
export type EtherscanNormalTransactionResponse = z.infer<typeof EtherscanNormalTransactionResponseSchema>;
export type EtherscanInternalTransactionResponse = z.infer<typeof EtherscanInternalTransactionResponseSchema>;
export type EtherscanTokenTransactionResponse = z.infer<typeof EtherscanTokenTransactionResponseSchema>;
export type EtherscanNftTransactionResponse = z.infer<typeof EtherscanNftTransactionResponseSchema>;
