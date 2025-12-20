/**
 * Zod validation schemas for Subscan API response data
 */
import { z } from 'zod';

import { hexOrNumericToNumericRequired, timestampToDate } from '../../../../core/utils/zod-utils.js';
import { SubstrateAddressSchema } from '../../schemas.js';

/**
 * Schema for account display metadata
 */
const SubscanAccountDisplaySchema = z.object({
  account_index: z.string().nullish(),
  address: SubstrateAddressSchema.nullish(),
  display: z.string().nullish(),
  evm_address: z.string().nullish(),
  evm_contract: z
    .object({
      contract_name: z.string().nullish(),
      verify_source: z.string().nullish(),
    })
    .nullish(),
  identity: z.boolean().nullish(),
  judgements: z
    .array(
      z.object({
        index: z.number(),
        judgement: z.string(),
      })
    )
    .nullish(),
  merkle: z
    .object({
      address_type: z.string().nullish(),
      tag_name: z.string().nullish(),
      tag_subtype: z.string().nullish(),
      tag_type: z.string().nullish(),
    })
    .nullish(),
  parent: z
    .object({
      address: SubstrateAddressSchema.nullish(),
      display: z.string().nullish(),
      identity: z.boolean().nullish(),
      sub_symbol: z.string().nullish(),
    })
    .nullish(),
  people: z
    .object({
      display: z.string().nullish(),
      identity: z.boolean().nullish(),
      judgements: z
        .array(
          z.object({
            index: z.number(),
            judgement: z.string(),
          })
        )
        .nullish(),
      parent: z
        .object({
          address: SubstrateAddressSchema.nullish(),
          display: z.string().nullish(),
          identity: z.boolean().nullish(),
          sub_symbol: z.string().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

/**
 * Schema for NFT/Item metadata
 */
const SubscanItemDetailSchema = z.object({
  collection_symbol: z.string().nullish(),
  fallback_image: z.string().nullish(),
  image: z.string().nullish(),
  local_image: z.string().nullish(),
  media: z
    .array(
      z.object({
        types: z.string().nullish(),
        url: z.string().nullish(),
      })
    )
    .nullish(),
  symbol: z.string().nullish(),
  thumbnail: z.string().nullish(),
});

/**
 * Schema for Subscan transfer structure
 */
export const SubscanTransferBaseSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'Amount must be numeric string (integer or decimal)'),
  amount_v2: z.string().nullish(),
  asset_symbol: z.string().nullish(),
  asset_type: z.string().nullish(),
  asset_unique_id: z.string().nullish(),
  block_num: z.number().nonnegative('Block number must be non-negative'),
  block_timestamp: timestampToDate,
  currency_amount: z.string().nullish(),
  current_currency_amount: z.string().nullish(),
  event_idx: z.number().nullish(),
  extrinsic_index: z.string().min(1, 'Extrinsic index must not be empty'),
  fee: hexOrNumericToNumericRequired,
  from: SubstrateAddressSchema,
  from_account_display: SubscanAccountDisplaySchema.nullish(),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  is_lock: z.boolean().nullish(),
  item_detail: SubscanItemDetailSchema.nullish(),
  item_id: z.string().nullish(),
  module: z.string().min(1, 'Module must not be empty'),
  nonce: z.number().nullish(),
  success: z.boolean(),
  to: SubstrateAddressSchema,
  to_account_display: SubscanAccountDisplaySchema.nullish(),
  transfer_id: z.number().nullish(),
});

/**
 * Schema for Subscan transfers response
 */
export const SubscanTransfersResponseSchema = z.object({
  code: z.number(),
  data: z
    .object({
      count: z.number().nullish(),
      total: z
        .record(
          z.string(),
          z.object({
            received: z.string().nullish(),
            sent: z.string().nullish(),
            total: z.string().nullish(),
          })
        )
        .nullish(),
      transfers: z.array(SubscanTransferBaseSchema),
    })
    .nullish(),
  generated_at: z.number().nullish(),
  message: z.string().nullish(),
});

/**
 * Schema for Subscan account response
 */
export const SubscanAccountResponseSchema = z.object({
  code: z.number(),
  data: z
    .object({
      account: SubstrateAddressSchema.nullish(),
      balance: hexOrNumericToNumericRequired.nullish(),
      reserved: hexOrNumericToNumericRequired.nullish(),
    })
    .nullish(),
  message: z.string().nullish(),
});

// Type exports inferred from schemas
export type SubscanAccountDisplay = z.infer<typeof SubscanAccountDisplaySchema>;
export type SubscanItemDetail = z.infer<typeof SubscanItemDetailSchema>;
export type SubscanTransfer = z.infer<typeof SubscanTransferBaseSchema>;
export type SubscanTransfersResponse = z.infer<typeof SubscanTransfersResponseSchema>;
export type SubscanAccountResponse = z.infer<typeof SubscanAccountResponseSchema>;
