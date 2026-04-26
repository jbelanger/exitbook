import { z } from 'zod';

/**
 * Cosmos SDK REST API schemas for /cosmos/tx/v1beta1/txs
 * Compatible with all Cosmos SDK chains (Fetch.ai, Osmosis, Cosmos Hub, etc.)
 */

/**
 * Pagination response from Cosmos SDK
 */
const CosmosPaginationSchema = z.object({
  next_key: z.string().nullable().optional(),
  total: z.string().optional(),
});

const CosmosCoinSchema = z.object({
  denom: z.string(),
  amount: z.string(),
});

/**
 * Cosmos SDK Message schema
 * Represents individual messages within a transaction
 */
export const CosmosMessageSchema = z.object({
  '@type': z.string(),
  from_address: z.string().optional(),
  to_address: z.string().optional(),
  amount: z.union([CosmosCoinSchema, z.array(CosmosCoinSchema)]).optional(),
  sender: z.string().optional(),
  receiver: z.string().optional(),
  delegator_address: z.string().optional(),
  validator_address: z.string().optional(),
  validator_src_address: z.string().optional(),
  validator_dst_address: z.string().optional(),
  source_port: z.string().optional(),
  source_channel: z.string().optional(),
  token: z
    .object({
      denom: z.string(),
      amount: z.string(),
    })
    .optional(),
  timeout_height: z
    .object({
      revision_number: z.string().optional(),
      revision_height: z.string().optional(),
    })
    .optional(),
  timeout_timestamp: z.string().optional(),
  memo: z.string().optional(),
  // MsgMultiSend fields
  inputs: z
    .array(
      z.object({
        address: z.string(),
        coins: z.array(
          z.object({
            denom: z.string(),
            amount: z.string(),
          })
        ),
      })
    )
    .optional(),
  outputs: z
    .array(
      z.object({
        address: z.string(),
        coins: z.array(
          z.object({
            denom: z.string(),
            amount: z.string(),
          })
        ),
      })
    )
    .optional(),
  // CosmWasm contract execution fields
  contract: z.string().optional(),
  funds: z
    .array(
      z.object({
        denom: z.string(),
        amount: z.string(),
      })
    )
    .optional(),
  msg: z.any().optional(),
});

/**
 * Cosmos SDK Event Attribute
 */
export const CosmosEventAttributeSchema = z.object({
  key: z.string(),
  value: z.string(),
  index: z.boolean().optional(),
});

/**
 * Cosmos SDK Event
 */
export const CosmosEventSchema = z.object({
  type: z.string(),
  attributes: z.array(CosmosEventAttributeSchema),
});

/**
 * Cosmos SDK Log entry
 */
const CosmosLogSchema = z.object({
  msg_index: z.number().optional(),
  log: z.string().optional(),
  events: z.array(CosmosEventSchema),
});

/**
 * Cosmos SDK Transaction Body
 */
const CosmosTxBodySchema = z.object({
  messages: z.array(CosmosMessageSchema),
  memo: z.string().optional(),
  timeout_height: z.string().optional(),
  extension_options: z.array(z.any()).optional(),
  non_critical_extension_options: z.array(z.any()).optional(),
});

/**
 * Cosmos SDK Fee
 */
const CosmosFeeSchema = z.object({
  amount: z.array(
    z.object({
      denom: z.string(),
      amount: z.string(),
    })
  ),
  gas_limit: z.string(),
  payer: z.string().optional(),
  granter: z.string().optional(),
});

/**
 * Cosmos SDK Auth Info
 */
const CosmosAuthInfoSchema = z.object({
  signer_infos: z.array(z.any()).optional(),
  fee: CosmosFeeSchema,
  tip: z.any().optional(),
});

/**
 * Cosmos SDK Transaction
 */
const CosmosTxSchema = z.object({
  body: CosmosTxBodySchema,
  auth_info: CosmosAuthInfoSchema,
  signatures: z.array(z.string()),
});

/**
 * Cosmos SDK Transaction Response
 */
export const CosmosTxResponseSchema = z.object({
  height: z.string(),
  txhash: z.string(),
  codespace: z.string().optional(),
  code: z.number().optional(),
  data: z.string().optional(),
  raw_log: z.string().optional(),
  logs: z.array(CosmosLogSchema).optional(),
  info: z.string().optional(),
  gas_wanted: z.string().optional(),
  gas_used: z.string().optional(),
  tx: CosmosTxSchema.optional(),
  timestamp: z.string(),
  events: z.array(CosmosEventSchema).optional(),
});

/**
 * Main API Response schema for GetTxsEvent
 */
export const CosmosRestApiResponseSchema = z.object({
  txs: z.array(CosmosTxSchema).optional(),
  tx_responses: z.array(CosmosTxResponseSchema),
  pagination: CosmosPaginationSchema.nullish(),
  total: z.string().optional(),
});

/**
 * Balance response from /cosmos/bank/v1beta1/balances/{address}
 */
const CosmosBalanceSchema = z.object({
  denom: z.string(),
  amount: z.string(),
});

export const CosmosBalanceResponseSchema = z.object({
  balances: z.array(CosmosBalanceSchema),
  pagination: CosmosPaginationSchema.nullish(),
});

/**
 * Types inferred from schemas
 */
export type CosmosMessage = z.infer<typeof CosmosMessageSchema>;
export type CosmosEvent = z.infer<typeof CosmosEventSchema>;
export type CosmosEventAttribute = z.infer<typeof CosmosEventAttributeSchema>;
export type CosmosTxResponse = z.infer<typeof CosmosTxResponseSchema>;
export type CosmosRestApiResponse = z.infer<typeof CosmosRestApiResponseSchema>;
export type CosmosBalanceResponse = z.infer<typeof CosmosBalanceResponseSchema>;
