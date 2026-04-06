import { z } from 'zod';

const AssetSelectionCommandOptionsSchema = z
  .object({
    assetId: z.string().min(1).optional(),
    symbol: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.assetId || data.symbol), {
    message: 'Either --asset-id or --symbol is required',
  })
  .refine((data) => !(data.assetId && data.symbol), {
    message: 'Specify only one of --asset-id or --symbol',
  });

export const AssetsExcludeCommandOptionsSchema = AssetSelectionCommandOptionsSchema.extend({
  reason: z.string().min(1).optional(),
  json: z.boolean().optional(),
});

export const AssetsIncludeCommandOptionsSchema = AssetSelectionCommandOptionsSchema.extend({
  reason: z.string().min(1).optional(),
  json: z.boolean().optional(),
});

export const AssetsConfirmCommandOptionsSchema = AssetSelectionCommandOptionsSchema.extend({
  reason: z.string().min(1).optional(),
  json: z.boolean().optional(),
});

export const AssetsClearReviewCommandOptionsSchema = AssetSelectionCommandOptionsSchema.extend({
  reason: z.string().min(1).optional(),
  json: z.boolean().optional(),
});

export const AssetsExclusionsCommandOptionsSchema = z.object({
  json: z.boolean().optional(),
});

export const AssetsBrowseCommandOptionsSchema = z.object({
  actionRequired: z.boolean().optional(),
  needsReview: z.boolean().optional(),
  json: z.boolean().optional(),
});
