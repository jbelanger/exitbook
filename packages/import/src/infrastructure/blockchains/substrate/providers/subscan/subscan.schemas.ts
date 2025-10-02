/**
 * Zod validation schemas for Subscan API response data
 */
import { z } from 'zod';

/**
 * Schema for account display metadata
 */
const SubscanAccountDisplaySchema = z.object({
  account_index: z.string().optional(),
  address: z.string().optional(),
  display: z.string().optional(),
  evm_address: z.string().optional(),
  evm_contract: z
    .object({
      contract_name: z.string().optional(),
      verify_source: z.string().optional(),
    })
    .optional(),
  identity: z.boolean().optional(),
  judgements: z
    .array(
      z.object({
        index: z.number(),
        judgement: z.string(),
      })
    )
    .optional(),
  merkle: z
    .object({
      address_type: z.string().optional(),
      tag_name: z.string().optional(),
      tag_subtype: z.string().optional(),
      tag_type: z.string().optional(),
    })
    .optional(),
  parent: z
    .object({
      address: z.string().optional(),
      display: z.string().optional(),
      identity: z.boolean().optional(),
      sub_symbol: z.string().optional(),
    })
    .optional(),
  people: z
    .object({
      display: z.string().optional(),
      identity: z.boolean().optional(),
      judgements: z
        .array(
          z.object({
            index: z.number(),
            judgement: z.string(),
          })
        )
        .optional(),
      parent: z
        .object({
          address: z.string().optional(),
          display: z.string().optional(),
          identity: z.boolean().optional(),
          sub_symbol: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

/**
 * Schema for NFT/Item metadata
 */
const SubscanItemDetailSchema = z.object({
  collection_symbol: z.string().optional(),
  fallback_image: z.string().optional(),
  image: z.string().optional(),
  local_image: z.string().optional(),
  media: z
    .array(
      z.object({
        types: z.string().optional(),
        url: z.string().optional(),
      })
    )
    .optional(),
  symbol: z.string().optional(),
  thumbnail: z.string().optional(),
});

/**
 * Schema for Subscan transfer structure
 */
export const SubscanTransferSchema = z.object({
  amount: z.string().regex(/^\d+$/, 'Amount must be numeric string'),
  amount_v2: z.string().nullish(),
  asset_symbol: z.string().nullish(),
  asset_type: z.string().nullish(),
  asset_unique_id: z.string().nullish(),
  block_num: z.number().nonnegative('Block number must be non-negative'),
  block_timestamp: z.number().nonnegative('Block timestamp must be non-negative'),
  currency_amount: z.string().nullish(),
  current_currency_amount: z.string().nullish(),
  event_idx: z.number().nullish(),
  extrinsic_index: z.string().min(1, 'Extrinsic index must not be empty'),
  fee: z.string().regex(/^\d+$/, 'Fee must be numeric string'),
  from: z.string().min(1, 'From address must not be empty'),
  from_account_display: SubscanAccountDisplaySchema.nullish(),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  is_lock: z.boolean().nullish(),
  item_detail: SubscanItemDetailSchema.nullish(),
  item_id: z.string().nullish(),
  module: z.string().min(1, 'Module must not be empty'),
  nonce: z.number().nullish(),
  success: z.boolean(),
  to: z.string().min(1, 'To address must not be empty'),
  to_account_display: SubscanAccountDisplaySchema.nullish(),
  transfer_id: z.number().nullish(),
  // Augmented fields added by API client
  _nativeCurrency: z.string().min(1, 'Native currency must not be empty'),
  _nativeDecimals: z.number().nonnegative('Native decimals must be non-negative'),
  _chainDisplayName: z.string().min(1, 'Chain display name must not be empty'),
});

/**
 * Schema for Subscan transfers response
 */
export const SubscanTransfersResponseSchema = z.object({
  code: z.number(),
  data: z
    .object({
      count: z.number().optional(),
      total: z
        .record(
          z.object({
            received: z.string().optional(),
            sent: z.string().optional(),
            total: z.string().optional(),
          })
        )
        .optional(),
      transfers: z.array(SubscanTransferSchema),
    })
    .optional(),
  generated_at: z.number().optional(),
  message: z.string().optional(),
});

/**
 * Schema for Subscan account response
 */
export const SubscanAccountResponseSchema = z.object({
  code: z.number(),
  data: z
    .object({
      balance: z.string().regex(/^\d+$/, 'Balance must be numeric string').optional(),
      reserved: z.string().regex(/^\d+$/, 'Reserved must be numeric string').optional(),
    })
    .optional(),
  message: z.string().optional(),
});
