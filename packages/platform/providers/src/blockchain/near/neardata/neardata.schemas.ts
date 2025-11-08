/**
 * Zod schemas for NearData API responses
 * API: https://mainnet.neardata.xyz
 * Documentation: https://github.com/vgrichina/neardata-server
 */
import { z } from 'zod';

/**
 * Schema for NearData action within a transaction
 */
export const NearDataActionSchema = z.object({
  action_kind: z.string().min(1, 'Action kind must not be empty'),
  args: z.union([z.record(z.string(), z.unknown()), z.string(), z.null()]).optional(),
  deposit: z.string().optional(),
  gas: z.number().optional(),
  method_name: z.string().nullable().optional(),
});

/**
 * Schema for NearData transaction outcome
 */
export const NearDataOutcomeSchema = z.object({
  execution_outcome: z
    .object({
      block_hash: z.string(),
      id: z.string(),
      outcome: z.object({
        executor_id: z.string(),
        gas_burnt: z.number(),
        logs: z.array(z.string()).optional(),
        receipt_ids: z.array(z.string()).optional(),
        status: z.union([
          z.object({ SuccessValue: z.string() }),
          z.object({ SuccessReceiptId: z.string() }),
          z.object({ Failure: z.unknown() }),
        ]),
        tokens_burnt: z.string(),
      }),
      proof: z.array(z.unknown()).optional(),
    })
    .optional(),
  receipts_outcome: z.array(z.unknown()).optional(),
});

/**
 * Schema for NearData transaction data
 * From POST /v0/account endpoint
 */
export const NearDataTransactionSchema = z.object({
  actions: z.array(NearDataActionSchema).optional(),
  block_hash: z.string().optional(),
  block_height: z.number().optional(),
  block_timestamp: z.number(),
  nonce: z.number().optional(),
  outcome: NearDataOutcomeSchema.optional(),
  public_key: z.string().optional(),
  receiver_id: z.string().min(1, 'Receiver ID must not be empty'),
  signature: z.string().optional(),
  signer_id: z.string().min(1, 'Signer ID must not be empty'),
  tx_hash: z.string().min(1, 'Transaction hash must not be empty'),
});

/**
 * Schema for NearData account request body
 */
export const NearDataAccountRequestSchema = z.object({
  account_id: z.string().min(1, 'Account ID must not be empty'),
  max_block_height: z.number().nullable().optional(),
});

/**
 * Schema for NearData account response
 * Returns array of transactions
 */
export const NearDataAccountResponseSchema = z.array(NearDataTransactionSchema);

// Type exports
export type NearDataAction = z.infer<typeof NearDataActionSchema>;
export type NearDataOutcome = z.infer<typeof NearDataOutcomeSchema>;
export type NearDataTransaction = z.infer<typeof NearDataTransactionSchema>;
export type NearDataAccountRequest = z.infer<typeof NearDataAccountRequestSchema>;
export type NearDataAccountResponse = z.infer<typeof NearDataAccountResponseSchema>;
