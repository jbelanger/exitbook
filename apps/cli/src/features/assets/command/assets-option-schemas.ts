import { z } from 'zod';

import { ProfileFlagSchema } from '../../shared/option-schema-primitives.js';

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
  profile: ProfileFlagSchema.shape.profile,
  reason: z.string().min(1).optional(),
  json: z.boolean().optional(),
});

export const AssetsIncludeCommandOptionsSchema = AssetSelectionCommandOptionsSchema.extend({
  profile: ProfileFlagSchema.shape.profile,
  reason: z.string().min(1).optional(),
  json: z.boolean().optional(),
});

export const AssetsConfirmCommandOptionsSchema = AssetSelectionCommandOptionsSchema.extend({
  profile: ProfileFlagSchema.shape.profile,
  reason: z.string().min(1).optional(),
  json: z.boolean().optional(),
});

export const AssetsClearReviewCommandOptionsSchema = AssetSelectionCommandOptionsSchema.extend({
  profile: ProfileFlagSchema.shape.profile,
  reason: z.string().min(1).optional(),
  json: z.boolean().optional(),
});

export const AssetsExclusionsCommandOptionsSchema = z.object({
  profile: ProfileFlagSchema.shape.profile,
  json: z.boolean().optional(),
});

export const AssetsViewCommandOptionsSchema = z.object({
  actionRequired: z.boolean().optional(),
  needsReview: z.boolean().optional(),
  profile: ProfileFlagSchema.shape.profile,
  json: z.boolean().optional(),
});
