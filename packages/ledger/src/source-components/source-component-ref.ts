import { AssetIdSchema, type AssetMovement } from '@exitbook/core';
import { DecimalSchema } from '@exitbook/foundation';
import { z } from 'zod';

import { AccountingSourceComponentKindSchema } from './source-component-kind.js';

const PositiveDecimalSchema = DecimalSchema.refine((value) => value.gt(0), {
  message: 'Source component quantity must be positive',
});

export const SourceComponentRefSchema = z.object({
  sourceActivityFingerprint: z.string().min(1, 'Source activity fingerprint must not be empty'),
  componentKind: AccountingSourceComponentKindSchema,
  componentId: z.string().min(1, 'Source component ID must not be empty'),
  occurrence: z.number().int().positive().optional(),
  assetId: AssetIdSchema.optional(),
});

export const SourceComponentQuantityRefSchema = z.object({
  component: SourceComponentRefSchema,
  quantity: PositiveDecimalSchema,
});

export type SourceComponentRef = z.infer<typeof SourceComponentRefSchema>;
export type SourceComponentQuantityRef = z.infer<typeof SourceComponentQuantityRefSchema>;

export type SourceComponentAssetId = AssetMovement['assetId'];
