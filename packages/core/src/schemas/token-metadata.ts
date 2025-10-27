import { z } from 'zod';

import { DateSchema } from './money.ts';

/**
 * Schema for token metadata from API clients (write-side)
 * Used when fetching from providers - blockchain, source, and refreshedAt added during persistence
 */
export const TokenMetadataSchema = z.object({
  contractAddress: z.string(),
  symbol: z.string().optional(),
  name: z.string().optional(),
  decimals: z.number().int().nonnegative().optional(),
  logoUrl: z.string().optional(),
});

/**
 * Schema for token metadata after database persistence (read-side)
 * Extends base schema with database-specific fields
 */
export const TokenMetadataRecordSchema = TokenMetadataSchema.extend({
  blockchain: z.string(),
  source: z.string(),
  refreshedAt: DateSchema,
});

/**
 * Type exports inferred from schemas
 */
export type TokenMetadata = z.infer<typeof TokenMetadataSchema>;
export type TokenMetadataRecord = z.infer<typeof TokenMetadataRecordSchema>;
