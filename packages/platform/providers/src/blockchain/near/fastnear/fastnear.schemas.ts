/**
 * Zod schemas for FastNear API responses
 * API: https://api.fastnear.com
 * Documentation: https://github.com/vgrichina/fastnear-api
 */
import { z } from 'zod';

/**
 * Schema for FastNear fungible token entry
 */
export const FastNearFungibleTokenSchema = z.object({
  balance: z.string(),
  contract_id: z.string().min(1, 'Contract ID must not be empty'),
  last_update_block_height: z.number(),
});

/**
 * Schema for FastNear NFT entry
 */
export const FastNearNftSchema = z.object({
  contract_id: z.string().min(1, 'Contract ID must not be empty'),
  last_update_block_height: z.number(),
});

/**
 * Schema for FastNear staking pool entry
 */
export const FastNearStakingPoolSchema = z.object({
  last_update_block_height: z.number(),
  pool_id: z.string().min(1, 'Pool ID must not be empty'),
});

/**
 * Schema for FastNear account state
 * Contains native NEAR balance and account metadata
 */
export const FastNearAccountStateSchema = z.object({
  account_id: z.string().min(1, 'Account ID must not be empty'),
  amount: z.string().optional(),
  block_hash: z.string().optional(),
  block_height: z.number().optional(),
  code_hash: z.string().optional(),
  locked: z.string().optional(),
  storage_paid_at: z.number().optional(),
  storage_usage: z.number().optional(),
});

/**
 * Schema for FastNear account full response
 * From GET /v1/account/{account_id}/full endpoint
 * Note: All arrays (ft, nft, staking) may be null if data is unchanged since around block 115,000,000
 */
export const FastNearAccountFullResponseSchema = z.object({
  account: FastNearAccountStateSchema.nullable(),
  ft: z.array(FastNearFungibleTokenSchema).nullable(),
  nft: z.array(FastNearNftSchema).nullable(),
  staking: z.array(FastNearStakingPoolSchema).nullable(),
});

// Type exports
export type FastNearFungibleToken = z.infer<typeof FastNearFungibleTokenSchema>;
export type FastNearNft = z.infer<typeof FastNearNftSchema>;
export type FastNearStakingPool = z.infer<typeof FastNearStakingPoolSchema>;
export type FastNearAccountState = z.infer<typeof FastNearAccountStateSchema>;
export type FastNearAccountFullResponse = z.infer<typeof FastNearAccountFullResponseSchema>;
