import { z } from 'zod';

/**
 * Schema for blockchain balance snapshots
 * Validates balance data returned from blockchain provider APIs
 */
export const BlockchainBalanceSnapshotSchema = z.object({
  total: z.string().regex(/^\d+(\.\d+)?$/, 'Total must be a valid decimal string'),
  asset: z.string().min(1, 'Asset must not be empty'),
});

export type BlockchainBalanceSnapshot = z.infer<typeof BlockchainBalanceSnapshotSchema>;
