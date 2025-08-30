/**
 * Zod validation schemas for Polkadot/Substrate transaction data formats
 *
 * These schemas validate the structure and content of transaction data
 * from different Substrate-based blockchain API providers (Subscan, Taostats, RPC)
 * before processing.
 */
import { z } from 'zod';

/**
 * Schema for Substrate event structure
 */
export const SubstrateEventSchema = z.object({
  data: z.array(z.unknown()),
  method: z.string().min(1, 'Method must not be empty'),
  section: z.string().min(1, 'Section must not be empty'),
});

/**
 * Schema for Substrate transaction structure
 */
export const SubstrateTransactionSchema = z.object({
  amount: z.string().min(1, 'Amount must not be empty'),
  args: z.unknown().optional(),
  blockHash: z.string().min(1, 'Block hash must not be empty'),
  blockNumber: z.number().nonnegative('Block number must be non-negative'),
  call: z.string().min(1, 'Call must not be empty'),
  events: z.array(SubstrateEventSchema).optional(),
  fee: z.string().min(1, 'Fee must not be empty'),
  from: z.string().min(1, 'From address must not be empty'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  module: z.string().min(1, 'Module must not be empty'),
  success: z.boolean(),
  timestamp: z.number().nonnegative('Timestamp must be non-negative'),
  to: z.string().optional(),
});

/**
 * Schema for Substrate extrinsic structure
 */
export const SubstrateExtrinsicSchema = z.object({
  args: z.unknown(),
  error: z
    .object({
      docs: z.array(z.string()),
      module: z.string().min(1, 'Error module must not be empty'),
      name: z.string().min(1, 'Error name must not be empty'),
    })
    .optional(),
  hash: z.string().min(1, 'Hash must not be empty'),
  method: z.string().min(1, 'Method must not be empty'),
  nonce: z.number().nonnegative('Nonce must be non-negative'),
  section: z.string().min(1, 'Section must not be empty'),
  signature: z.string().min(1, 'Signature must not be empty'),
  signer: z.string().min(1, 'Signer must not be empty'),
  success: z.boolean(),
  tip: z.string().min(1, 'Tip must not be empty'),
});

/**
 * Schema for Substrate balance structure
 */
export const SubstrateBalanceSchema = z.object({
  free: z.string().min(1, 'Free balance must not be empty'),
  frozen: z.string().min(1, 'Frozen balance must not be empty'),
  reserved: z.string().min(1, 'Reserved balance must not be empty'),
  total: z.string().min(1, 'Total balance must not be empty'),
});

/**
 * Schema for Substrate account info structure
 */
export const SubstrateAccountInfoSchema = z.object({
  consumers: z.number().nonnegative('Consumers must be non-negative'),
  data: SubstrateBalanceSchema,
  nonce: z.number().nonnegative('Nonce must be non-negative'),
  providers: z.number().nonnegative('Providers must be non-negative'),
  sufficients: z.number().nonnegative('Sufficients must be non-negative'),
});

/**
 * Schema for Substrate block structure
 */
export const SubstrateBlockSchema = z.object({
  events: z.array(SubstrateEventSchema),
  extrinsics: z.array(SubstrateExtrinsicSchema),
  hash: z.string().min(1, 'Block hash must not be empty'),
  number: z.number().nonnegative('Block number must be non-negative'),
  parentHash: z.string().min(1, 'Parent hash must not be empty'),
  timestamp: z.number().nonnegative('Timestamp must be non-negative'),
});

/**
 * Schema for Substrate chain configuration
 */
export const SubstrateChainConfigSchema = z.object({
  apiKey: z.string().optional(),
  chainId: z.string().optional(),
  displayName: z.string().min(1, 'Display name must not be empty'),
  explorerApiUrl: z.string().optional(),
  explorerUrls: z.array(z.string().min(1, 'Explorer URL must not be empty')),
  genesisHash: z.string().optional(),
  name: z.string().min(1, 'Name must not be empty'),
  rpcEndpoints: z.array(z.string().min(1, 'RPC endpoint must not be empty')),
  ss58Format: z.number().nonnegative('SS58 format must be non-negative'),
  tokenDecimals: z.number().nonnegative('Token decimals must be non-negative'),
  tokenSymbol: z.string().min(1, 'Token symbol must not be empty'),
});

/**
 * Schema for Subscan transfer structure
 */
export const SubscanTransferSchema = z.object({
  amount: z.string().min(1, 'Amount must not be empty'),
  block_hash: z.string().min(1, 'Block hash must not be empty'),
  block_num: z.number().nonnegative('Block number must be non-negative'),
  block_timestamp: z.number().nonnegative('Block timestamp must be non-negative'),
  call: z.string().min(1, 'Call must not be empty'),
  extrinsic_index: z.string().min(1, 'Extrinsic index must not be empty'),
  fee: z.string().min(1, 'Fee must not be empty'),
  from: z.string().min(1, 'From address must not be empty'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  module: z.string().min(1, 'Module must not be empty'),
  success: z.boolean(),
  to: z.string().min(1, 'To address must not be empty'),
});

/**
 * Schema for Subscan transfers response
 */
export const SubscanTransfersResponseSchema = z.object({
  code: z.number(),
  data: z
    .object({
      transfers: z.array(SubscanTransferSchema),
    })
    .optional(),
});

/**
 * Schema for Taostats transaction structure (Bittensor)
 */
export const TaostatsTransactionSchema = z.object({
  amount: z.string().min(1, 'Amount must not be empty'),
  block: z.number().nonnegative('Block must be non-negative'),
  block_hash: z.string().min(1, 'Block hash must not be empty'),
  block_number: z.number().nonnegative('Block number must be non-negative'),
  confirmations: z.number().nonnegative('Confirmations must be non-negative'),
  fee: z.string().optional(),
  from: z.string().min(1, 'From address must not be empty'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  success: z.boolean(),
  timestamp: z.number().nonnegative('Timestamp must be non-negative'),
  to: z.string().min(1, 'To address must not be empty'),
});

/**
 * Schema for Taostats balance response
 */
export const TaostatsBalanceResponseSchema = z.object({
  balance: z.string().min(1, 'Balance must not be empty'),
});

/**
 * Schema for Subscan account response
 */
export const SubscanAccountResponseSchema = z.object({
  code: z.number(),
  data: z
    .object({
      balance: z.string().optional(),
      reserved: z.string().optional(),
    })
    .optional(),
});

/**
 * Schema for Substrate raw data (composite structure for multiple providers)
 */
export const SubstrateRawDataSchema = z.object({
  accountInfo: SubstrateAccountInfoSchema.optional(),
  balance: z.string().optional(),
  currency: z.string().optional(),
  data: z.union([z.array(SubscanTransferSchema), z.array(TaostatsTransactionSchema), z.array(z.unknown())]),
  provider: z.enum(['subscan', 'taostats', 'rpc', 'unknown'], {
    message: 'Provider must be one of: subscan, taostats, rpc, unknown',
  }),
  reserved: z.string().optional(),
  since: z.number().optional(),
});
