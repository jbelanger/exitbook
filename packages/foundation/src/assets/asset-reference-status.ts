import { z } from 'zod';

export const AssetReferenceStatusSchema = z.enum(['matched', 'unmatched', 'unknown']);

export type AssetReferenceStatus = z.infer<typeof AssetReferenceStatusSchema>;
