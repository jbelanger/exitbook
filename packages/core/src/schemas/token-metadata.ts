import { z } from 'zod';

import { DateSchema } from './primitives.js';

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

  // Professional spam detection (Moralis, Helius, etc.)
  possibleSpam: z.boolean().optional(),
  verifiedContract: z.boolean().optional(),

  // Additional metadata for pattern-based detection (fallback)
  description: z.string().optional(),
  externalUrl: z.string().optional(),

  // Additional useful fields from providers
  totalSupply: z.string().optional(),
  createdAt: z.string().optional(),
  blockNumber: z.number().int().nonnegative().optional(),
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
