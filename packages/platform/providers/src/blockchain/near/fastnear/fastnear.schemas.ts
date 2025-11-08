/**
 * Zod schemas for FastNear API responses
 * API: https://api.fastnear.com (balance/account data)
 * Explorer API: https://explorer.main.fastnear.com/v0/ (transactions)
 * Documentation: https://github.com/vgrichina/fastnear-api
 */
import { z } from 'zod';

/**
 * Schema for FastNear fungible token entry
 */
export const FastNearFungibleTokenSchema = z.object({
  balance: z.string(),
  contract_id: z.string().min(1, 'Contract ID must not be empty'),
  last_update_block_height: z.number(),
});

/**
 * Schema for FastNear NFT entry
 */
export const FastNearNftSchema = z.object({
  contract_id: z.string().min(1, 'Contract ID must not be empty'),
  last_update_block_height: z.number(),
});

/**
 * Schema for FastNear staking pool entry
 */
export const FastNearStakingPoolSchema = z.object({
  last_update_block_height: z.number(),
  pool_id: z.string().min(1, 'Pool ID must not be empty'),
});

/**
 * Schema for FastNear account state
 * Contains native NEAR balance and account metadata
 */
export const FastNearAccountStateSchema = z.object({
  account_id: z.string().min(1, 'Account ID must not be empty'),
  amount: z.string().optional(),
  block_hash: z.string().optional(),
  block_height: z.number().optional(),
  code_hash: z.string().optional(),
  locked: z.string().optional(),
  storage_paid_at: z.number().optional(),
  storage_usage: z.number().optional(),
});

/**
 * Schema for FastNear account full response
 * From GET /v1/account/{account_id}/full endpoint
 * Note: All arrays (ft, nft, staking) may be null or undefined if data is unchanged since around block 115,000,000
 */
export const FastNearAccountFullResponseSchema = z.object({
  account: FastNearAccountStateSchema.nullish(),
  ft: z.array(FastNearFungibleTokenSchema).nullish(),
  nft: z.array(FastNearNftSchema).nullish(),
  staking: z.array(FastNearStakingPoolSchema).nullish(),
});

// Type exports
export type FastNearFungibleToken = z.infer<typeof FastNearFungibleTokenSchema>;
export type FastNearNft = z.infer<typeof FastNearNftSchema>;
export type FastNearStakingPool = z.infer<typeof FastNearStakingPoolSchema>;
export type FastNearAccountState = z.infer<typeof FastNearAccountStateSchema>;
export type FastNearAccountFullResponse = z.infer<typeof FastNearAccountFullResponseSchema>;

/**
 * FastNear Explorer API Schemas
 * From POST /v0/account endpoint
 */

/**
 * Schema for FastNear Explorer transaction action
 * Actions can be simple strings ("CreateAccount", "DeleteAccount")
 * or objects with specific action types (FunctionCall, Transfer, etc.)
 */
export const FastNearExplorerActionSchema = z.union([
  z.string(),
  z.object({
    FunctionCall: z.object({
      args: z.string(),
      deposit: z.string(),
      gas: z.number(),
      method_name: z.string(),
    }),
  }),
  z.object({
    Transfer: z.object({
      deposit: z.string(),
    }),
  }),
  z.object({
    AddKey: z.object({
      access_key: z.object({
        nonce: z.number(),
        permission: z.union([z.literal('FullAccess'), z.object({})]),
      }),
      public_key: z.string(),
    }),
  }),
  z.object({
    DeleteKey: z.object({
      public_key: z.string(),
    }),
  }),
  z.object({
    Stake: z.object({
      public_key: z.string(),
      stake: z.string(),
    }),
  }),
  z.object({
    DeployContract: z.object({
      code: z.string(),
    }),
  }),
  z.object({
    DeleteAccount: z.object({
      beneficiary_id: z.string(),
    }),
  }),
]);

/**
 * Schema for FastNear Explorer transaction
 */
export const FastNearExplorerTransactionSchema = z.object({
  actions: z.array(FastNearExplorerActionSchema),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  nonce: z.number(),
  public_key: z.string(),
  receiver_id: z.string().min(1, 'Receiver ID must not be empty'),
  signer_id: z.string().min(1, 'Signer ID must not be empty'),
});

/**
 * Schema for FastNear Explorer execution outcome status
 */
export const FastNearExplorerOutcomeStatusSchema = z.union([
  z.object({ SuccessValue: z.string() }),
  z.object({ SuccessReceiptId: z.string() }),
  z.object({ Failure: z.unknown() }),
]);

/**
 * Schema for FastNear Explorer execution outcome
 */
export const FastNearExplorerExecutionOutcomeSchema = z.object({
  block_hash: z.string(),
  outcome: z.object({
    executor_id: z.string(),
    gas_burnt: z.number(),
    logs: z.array(z.string()).optional(),
    receipt_ids: z.array(z.string()).optional(),
    status: FastNearExplorerOutcomeStatusSchema,
    tokens_burnt: z.string(),
  }),
});

/**
 * Schema for FastNear Explorer transaction data
 * Includes both transaction and execution outcome
 */
export const FastNearExplorerTransactionDataSchema = z.object({
  execution_outcome: FastNearExplorerExecutionOutcomeSchema,
  transaction: FastNearExplorerTransactionSchema,
});

/**
 * Schema for FastNear Explorer account transaction metadata
 */
export const FastNearExplorerAccountTxSchema = z.object({
  account_id: z.string().min(1, 'Account ID must not be empty'),
  signer_id: z.string().min(1, 'Signer ID must not be empty'),
  transaction_hash: z.string().min(1, 'Transaction hash must not be empty'),
  tx_block_height: z.number(),
  tx_block_timestamp: z.number(),
});

/**
 * Schema for FastNear Explorer account request body
 */
export const FastNearExplorerAccountRequestSchema = z.object({
  account_id: z.string().min(1, 'Account ID must not be empty'),
  max_block_height: z.number().optional(),
});

/**
 * Schema for FastNear Explorer account response
 * Returns metadata and expanded transactions
 */
export const FastNearExplorerAccountResponseSchema = z.object({
  account_txs: z.array(FastNearExplorerAccountTxSchema),
  transactions: z.array(FastNearExplorerTransactionDataSchema),
  txs_count: z.number().optional(),
});

// Type exports for Explorer API
export type FastNearExplorerAction = z.infer<typeof FastNearExplorerActionSchema>;
export type FastNearExplorerTransaction = z.infer<typeof FastNearExplorerTransactionSchema>;
export type FastNearExplorerOutcomeStatus = z.infer<typeof FastNearExplorerOutcomeStatusSchema>;
export type FastNearExplorerExecutionOutcome = z.infer<typeof FastNearExplorerExecutionOutcomeSchema>;
export type FastNearExplorerTransactionData = z.infer<typeof FastNearExplorerTransactionDataSchema>;
export type FastNearExplorerAccountTx = z.infer<typeof FastNearExplorerAccountTxSchema>;
export type FastNearExplorerAccountRequest = z.infer<typeof FastNearExplorerAccountRequestSchema>;
export type FastNearExplorerAccountResponse = z.infer<typeof FastNearExplorerAccountResponseSchema>;
