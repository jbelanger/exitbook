/**
 * Re-export EvmTransaction type from schemas (single source of truth)
 * Types are inferred from Zod schemas to eliminate duplication
 */
export type { EvmTransaction } from './schemas.js';
