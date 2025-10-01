import { z } from 'zod';

/**
 * Zod schemas for Ethereum JSON-RPC types
 */

export const EvmRpcTransactionSchema = z.object({
  accessList: z
    .array(
      z.object({
        address: z.string(),
        storageKeys: z.array(z.string()),
      })
    )
    .optional(),
  blockHash: z.string().nullable(),
  blockNumber: z.string().nullable(),
  chainId: z.string().optional(),
  from: z.string(),
  gas: z.string(),
  gasPrice: z.string(),
  hash: z.string(),
  input: z.string(),
  maxFeePerGas: z.string().optional(),
  maxPriorityFeePerGas: z.string().optional(),
  nonce: z.string(),
  r: z.string(),
  s: z.string(),
  to: z.string().nullable(),
  transactionIndex: z.string().nullable(),
  type: z.string(),
  v: z.string(),
  value: z.string(),
});

export const EvmRpcLogSchema = z.object({
  address: z.string(),
  blockHash: z.string(),
  blockNumber: z.string(),
  data: z.string(),
  logIndex: z.string(),
  removed: z.boolean(),
  topics: z.array(z.string()),
  transactionHash: z.string(),
  transactionIndex: z.string(),
});

export const EvmRpcTransactionReceiptSchema = z.object({
  blockHash: z.string(),
  blockNumber: z.string(),
  contractAddress: z.string().nullable(),
  cumulativeGasUsed: z.string(),
  effectiveGasPrice: z.string(),
  from: z.string(),
  gasUsed: z.string(),
  logs: z.array(EvmRpcLogSchema),
  logsBloom: z.string(),
  status: z.string(),
  to: z.string().nullable(),
  transactionHash: z.string(),
  transactionIndex: z.string(),
  type: z.string(),
});

export const EvmRpcBlockSchema = z.object({
  baseFeePerGas: z.string().optional(),
  difficulty: z.string(),
  extraData: z.string(),
  gasLimit: z.string(),
  gasUsed: z.string(),
  hash: z.string(),
  logsBloom: z.string(),
  miner: z.string(),
  mixHash: z.string(),
  nonce: z.string(),
  number: z.string(),
  parentHash: z.string(),
  receiptsRoot: z.string(),
  sha3Uncles: z.string(),
  size: z.string(),
  stateRoot: z.string(),
  timestamp: z.string(),
  totalDifficulty: z.string(),
  transactions: z.union([z.array(z.string()), z.array(EvmRpcTransactionSchema)]),
  transactionsRoot: z.string(),
  uncles: z.array(z.string()),
});

export const EvmRpcRawDataSchema = z.object({
  block: EvmRpcBlockSchema.optional(),
  receipt: EvmRpcTransactionReceiptSchema,
  transaction: EvmRpcTransactionSchema,
});

export const EvmRpcBalanceSchema = z.object({
  balance: z.string(),
});
