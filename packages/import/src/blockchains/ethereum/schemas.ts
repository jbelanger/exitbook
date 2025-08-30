/**
 * Zod validation schemas for Ethereum transaction data formats
 *
 * These schemas validate the structure and content of transaction data
 * from different Ethereum API providers (Alchemy, Moralis)
 * before processing.
 */
import { z } from 'zod';

/**
 * Schema for Alchemy raw contract structure
 */
export const AlchemyRawContractSchema = z.object({
  address: z.union([z.string(), z.null()]).optional(),
  decimal: z.union([z.string(), z.number(), z.null()]).optional(),
});

/**
 * Schema for Alchemy metadata structure
 */
export const AlchemyMetadataSchema = z.object({
  blockTimestamp: z.string().optional(),
});

/**
 * Schema for Alchemy asset transfer structure
 */
export const AlchemyAssetTransferSchema = z.object({
  asset: z.string().optional(),
  blockNum: z.string().min(1, 'Block number must not be empty'),
  category: z.string().min(1, 'Category must not be empty'),
  from: z.string().min(1, 'From address must not be empty'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  metadata: AlchemyMetadataSchema.optional(),
  rawContract: AlchemyRawContractSchema.optional(),
  to: z.string().min(1, 'To address must not be empty'),
  value: z.union([z.string(), z.number(), z.null()]).optional(),
});

/**
 * Schema for arrays of Alchemy asset transfers
 */
export const AlchemyAssetTransferArraySchema = z.array(AlchemyAssetTransferSchema);

/**
 * Schema for Alchemy asset transfers response
 */
export const AlchemyAssetTransfersResponseSchema = z.object({
  pageKey: z.string().optional(),
  transfers: z.array(AlchemyAssetTransferSchema),
});

/**
 * Schema for Alchemy token balance
 */
export const AlchemyTokenBalanceSchema = z.object({
  contractAddress: z.string().min(1, 'Contract address must not be empty'),
  error: z.string().optional(),
  tokenBalance: z.string().min(1, 'Token balance must not be empty'),
});

/**
 * Schema for Alchemy token balances response
 */
export const AlchemyTokenBalancesResponseSchema = z.object({
  address: z.string().min(1, 'Address must not be empty'),
  tokenBalances: z.array(AlchemyTokenBalanceSchema),
});

/**
 * Schema for Alchemy token metadata
 */
export const AlchemyTokenMetadataSchema = z.object({
  decimals: z.number().min(0, 'Decimals must be non-negative'),
  logo: z.string().optional(),
  name: z.string().optional(),
  symbol: z.string().optional(),
});

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

/**
 * Schema for Etherscan transaction structure
 */
export const EtherscanTransactionSchema = z.object({
  blockHash: z.string().min(1, 'Block hash must not be empty'),
  blockNumber: z.string().min(1, 'Block number must not be empty'),
  confirmations: z.string().min(1, 'Confirmations must not be empty'),
  cumulativeGasUsed: z.string().min(1, 'Cumulative gas used must not be empty'),
  from: z.string().min(1, 'From address must not be empty'),
  functionName: z.string().optional(),
  gas: z.string().min(1, 'Gas must not be empty'),
  gasPrice: z.string().min(1, 'Gas price must not be empty'),
  gasUsed: z.string().min(1, 'Gas used must not be empty'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  input: z.string(),
  isError: z.string().optional(),
  methodId: z.string().optional(),
  nonce: z.string().min(1, 'Nonce must not be empty'),
  timeStamp: z.string().min(1, 'Timestamp must not be empty'),
  to: z.string().min(1, 'To address must not be empty'),
  transactionIndex: z.string().min(1, 'Transaction index must not be empty'),
  txreceipt_status: z.string().optional(),
  value: z.string().min(1, 'Value must not be empty'),
});

/**
 * Schema for Etherscan balance structure
 */
export const EtherscanBalanceSchema = z.object({
  account: z.string().min(1, 'Account address must not be empty'),
  balance: z.string().min(1, 'Balance must not be empty'),
});

/**
 * Schema for Etherscan token balance
 */
export const EtherscanTokenBalanceSchema = z.object({
  TokenAddress: z.string().min(1, 'Token address must not be empty'),
  TokenDivisor: z.string().min(1, 'Token divisor must not be empty'),
  TokenName: z.string().min(1, 'Token name must not be empty'),
  TokenQuantity: z.string().min(1, 'Token quantity must not be empty'),
  TokenSymbol: z.string().min(1, 'Token symbol must not be empty'),
});

/**
 * Schema for generic Etherscan API response
 */
export const EtherscanResponseSchema = z.object({
  message: z.string().min(1, 'Message must not be empty'),
  result: z.any(), // Can be various types depending on endpoint
  status: z.string().min(1, 'Status must not be empty'),
});
