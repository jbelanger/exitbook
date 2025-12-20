import { z } from 'zod';

/**
 * Base schema for all normalized blockchain transactions.
 *
 * This schema defines the minimum required fields that all blockchain-specific
 * transaction schemas must implement. It ensures consistent identity handling
 * across all chains by moving eventId computation to the provider layer.
 *
 * Key fields:
 * - `id`: The raw blockchain transaction hash (unchanged, no suffixes)
 * - `eventId`: Unique deterministic event identifier computed by the provider
 *
 * Benefits:
 * - Eliminates downstream coupling to normalized schema internals
 * - Removes scattered eventId generation logic from importers
 * - Enforces consistent identity patterns across all blockchains
 * - Simplifies adding new blockchain integrations
 *
 * @see docs/specs/evm-raw-transaction-dedup-and-event-identity.md
 */
export const NormalizedTransactionBaseSchema = z.object({
  /**
   * Raw blockchain transaction hash/signature.
   * This is the on-chain transaction identifier without any modifications or suffixes.
   *
   * Examples:
   * - EVM: "0xabc123..." (transaction hash)
   * - Solana: "5j7s..." (transaction signature)
   * - Bitcoin: "abc123..." (transaction ID)
   */
  id: z.string().min(1, 'Transaction ID must not be empty'),

  /**
   * Unique deterministic event identifier.
   * Computed by the provider during normalization to uniquely identify
   * a single event within a transaction.
   *
   * This is critical for deduplication because a single on-chain transaction
   * can produce multiple events:
   * - EVM: multiple token transfers (logs), internal calls, or contract interactions
   * - Bitcoin: multiple outputs to different addresses
   * - Solana: multiple account changes or token transfers
   *
   * The eventId MUST be:
   * 1. Deterministic: same input data always produces same eventId
   * 2. Unique: different events in the same transaction produce different eventIds
   * 3. Stable: replay/re-import produces the same eventId
   *
   * Implementation:
   * - Providers compute this using generateUniqueTransactionEventId()
   * - Include discriminating fields like logIndex, traceId, output index, etc.
   * - See blockchain-specific mapper-utils for exact computation
   */
  eventId: z.string().min(1, 'Event ID must not be empty'),
});

/**
 * Base type for all normalized blockchain transactions.
 * All blockchain-specific transaction types should extend this.
 */
export type NormalizedTransactionBase = z.infer<typeof NormalizedTransactionBaseSchema>;
