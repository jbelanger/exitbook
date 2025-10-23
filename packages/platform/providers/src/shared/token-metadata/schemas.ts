import { DateSchema } from '@exitbook/core';
import { z } from 'zod';

/**
 * Token metadata schema for blockchain tokens
 * Validates token data from provider APIs and cache storage
 */
export const TokenMetadataSchema = z.object({
  blockchain: z.string().min(1, 'Blockchain must not be empty'),
  contractAddress: z.string().min(1, 'Contract address must not be empty'),
  symbol: z.string().min(1, 'Symbol must not be empty').optional(),
  name: z.string().min(1, 'Name must not be empty').optional(),
  decimals: z.number().int().nonnegative().optional(),
  logoUrl: z.string().url('Logo URL must be valid').optional(),
  source: z.string().min(1, 'Source must not be empty'),
  updatedAt: DateSchema,
  createdAt: DateSchema,
});

export type TokenMetadata = z.infer<typeof TokenMetadataSchema>;
