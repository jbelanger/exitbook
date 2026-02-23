import { ExchangeLedgerEntrySchema, type ExchangeLedgerEntry } from '@exitbook/exchange-providers';
import { z } from 'zod';

/**
 * Represents a transaction with both raw exchange-specific data and normalized common data.
 *
 * @template TRaw - The raw exchange-specific type (e.g., CoinbaseLedgerEntry, KrakenLedgerEntry)
 */
export interface RawTransactionWithMetadata<TRaw = unknown> {
  /** Full exchange-specific data for processor access */
  raw: TRaw;
  /** Validated common contract (invariants enforced) */
  normalized: ExchangeLedgerEntry;
  /** Unique transaction ID from source */
  eventId: string;
  /** Cursor for resuming imports */
  cursor: Record<string, number>;
}

export const RawTransactionWithMetadataSchema = z.object({
  raw: z.unknown(),
  normalized: ExchangeLedgerEntrySchema,
  eventId: z.string(),
  cursor: z.record(z.string(), z.number()),
});

/**
 * Strategy for grouping ledger entries into atomic transactions.
 *
 * Determines which entries belong together (e.g., both sides of a swap).
 * Uses normalized.correlationId (guaranteed to exist after validation).
 */
export interface GroupingStrategy {
  group<TRaw>(entries: RawTransactionWithMetadata<TRaw>[]): Map<string, RawTransactionWithMetadata<TRaw>[]>;
}

/**
 * Group entries by correlationId (most exchanges use this).
 * Uses entry.normalized.correlationId (guaranteed to exist after validation).
 */
export const byCorrelationId: GroupingStrategy = {
  group<TRaw>(entries: RawTransactionWithMetadata<TRaw>[]): Map<string, RawTransactionWithMetadata<TRaw>[]> {
    const groups = new Map<string, RawTransactionWithMetadata<TRaw>[]>();

    for (const entry of entries) {
      if (!entry.normalized?.id) continue;

      const corrId = entry.normalized.correlationId;
      if (!groups.has(corrId)) {
        groups.set(corrId, []);
      }
      groups.get(corrId)!.push(entry);
    }

    return groups;
  },
};

/**
 * Group entries by timestamp (some exchanges correlate by time).
 */
export const byTimestamp: GroupingStrategy = {
  group<TRaw>(entries: RawTransactionWithMetadata<TRaw>[]): Map<string, RawTransactionWithMetadata<TRaw>[]> {
    const groups = new Map<string, RawTransactionWithMetadata<TRaw>[]>();

    for (const entry of entries) {
      const key = entry.normalized.timestamp.toString();
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(entry);
    }

    return groups;
  },
};

/**
 * No grouping - each entry is its own transaction (for CSV processors, etc.).
 */
export const noGrouping: GroupingStrategy = {
  group<TRaw>(entries: RawTransactionWithMetadata<TRaw>[]): Map<string, RawTransactionWithMetadata<TRaw>[]> {
    return new Map(entries.map((e) => [e.normalized.id, [e]]));
  },
};
