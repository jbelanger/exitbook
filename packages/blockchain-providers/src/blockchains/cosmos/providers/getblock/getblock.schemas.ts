import { z } from 'zod';

import { CosmosEventSchema } from '../cosmos-rest/cosmos-rest.schemas.js';

const JsonRpcIdSchema = z.union([z.number(), z.string(), z.null()]).optional();

const StringNumberSchema = z.union([z.number(), z.string()]).transform((value) => String(value));

const GetBlockJsonRpcErrorSchema = z.object({
  code: z.number(),
  data: z.unknown().optional(),
  message: z.string(),
});

export const GetBlockStatusResponseSchema = z.object({
  error: GetBlockJsonRpcErrorSchema.optional(),
  id: JsonRpcIdSchema,
  jsonrpc: z.string().optional(),
  result: z
    .object({
      node_info: z.object({
        network: z.string(),
        other: z
          .object({
            tx_index: z.string().optional(),
          })
          .optional(),
      }),
      sync_info: z.object({
        catching_up: z.boolean(),
        earliest_block_height: StringNumberSchema.optional(),
        latest_block_height: StringNumberSchema,
        tx_index: z.string().optional(),
      }),
    })
    .optional(),
});

export const GetBlockTxSearchTxSchema = z.object({
  hash: z.string(),
  height: StringNumberSchema,
  index: z.number().optional(),
  tx: z.string().optional(),
  tx_result: z.object({
    code: z.number().optional(),
    codespace: z.string().optional(),
    data: z.string().optional(),
    events: z.array(CosmosEventSchema).optional(),
    gas_used: StringNumberSchema.optional(),
    gas_wanted: StringNumberSchema.optional(),
    info: z.string().optional(),
    log: z.string().optional(),
  }),
});

export const GetBlockTxSearchResponseSchema = z.object({
  error: GetBlockJsonRpcErrorSchema.optional(),
  id: JsonRpcIdSchema,
  jsonrpc: z.string().optional(),
  result: z
    .object({
      total_count: StringNumberSchema.optional(),
      txs: z.array(GetBlockTxSearchTxSchema).optional(),
    })
    .optional(),
});

export const GetBlockBlockResponseSchema = z.object({
  error: GetBlockJsonRpcErrorSchema.optional(),
  id: JsonRpcIdSchema,
  jsonrpc: z.string().optional(),
  result: z
    .object({
      block: z.object({
        header: z.object({
          height: StringNumberSchema.optional(),
          time: z.string(),
        }),
      }),
    })
    .optional(),
});

export type GetBlockStatusResponse = z.infer<typeof GetBlockStatusResponseSchema>;
export type GetBlockTxSearchTx = z.infer<typeof GetBlockTxSearchTxSchema>;
export type GetBlockTxSearchResponse = z.infer<typeof GetBlockTxSearchResponseSchema>;
export type GetBlockBlockResponse = z.infer<typeof GetBlockBlockResponseSchema>;

export type GetBlockHydratedTx = GetBlockTxSearchTx & {
  timestamp: string;
};
