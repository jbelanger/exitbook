import { z } from 'zod';

const TokenMetadataRefreshedAtSchema = z
  .union([
    z.number().int().positive(),
    z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Invalid date string' }),
    z.date(),
  ])
  .transform((value) => {
    if (typeof value === 'number') {
      return new Date(value);
    }
    if (typeof value === 'string') {
      return new Date(value);
    }
    return value;
  });

/**
 * Normalized token metadata returned by blockchain providers before cache enrichment.
 */
export const TokenMetadataSchema = z.object({
  contractAddress: z.string(),
  symbol: z.string().optional(),
  name: z.string().optional(),
  decimals: z.number().int().nonnegative().optional(),
  logoUrl: z.string().optional(),
  possibleSpam: z.boolean().optional(),
  verifiedContract: z.boolean().optional(),
  description: z.string().optional(),
  externalUrl: z.string().optional(),
  totalSupply: z.string().optional(),
  createdAt: z.string().optional(),
  blockNumber: z.number().int().nonnegative().optional(),
});

/**
 * Cached token metadata enriched with blockchain/provider provenance.
 */
export const TokenMetadataRecordSchema = TokenMetadataSchema.extend({
  blockchain: z.string(),
  source: z.string(),
  refreshedAt: TokenMetadataRefreshedAtSchema,
});

export type TokenMetadata = z.infer<typeof TokenMetadataSchema>;
export type TokenMetadataRecord = z.infer<typeof TokenMetadataRecordSchema>;
