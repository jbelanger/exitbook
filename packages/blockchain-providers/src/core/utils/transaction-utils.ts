import { createHash } from 'node:crypto';

/**
 * Minimum fields required for generating unique transaction IDs.
 * These fields should be present in all blockchain transactions.
 */
export interface TransactionIdFields {
  amount: string; // Transfer amount
  currency: string; // Currency/asset symbol
  from: string; // Source address
  id: string; // Transaction hash/signature
  timestamp: number; // Transaction timestamp
  to?: string | undefined; // Destination address (optional for some tx types)
  tokenAddress?: string | undefined; // Token contract address (for token transfers)
  traceId?: string | undefined; // Trace/event ID for distinguishing multiple events in same tx
  logIndex?: number | undefined; // Log index for token transfers (EVM)
  type: string; // Transaction type (transfer, token_transfer, etc.)
}

/**
 * Generates a unique, deterministic ID for blockchain transactions by hashing
 * normalized transaction fields. This ensures uniqueness across multiple events
 * within the same transaction hash (e.g., token transfers, internal calls).
 *
 * Fields included in hash:
 * - Transaction hash (id)
 * - From address
 * - To address
 * - Currency/asset
 * - Amount
 * - Transaction type
 * - Timestamp
 * - Token address (if present)
 * - Trace ID (if present)
 * - Log index (if present)
 *
 * Note: Each blockchain importer decides which fields to include based on
 * whether all providers for that blockchain consistently supply those fields.
 *
 * @param tx - Transaction with minimum required fields
 * @returns SHA-256 hash of transaction fields (lowercase hex)
 */
export function generateUniqueTransactionEventId(tx: TransactionIdFields): string {
  // Normalize addresses to lowercase for consistency
  const from = (tx.from || '').toLowerCase();
  const to = (tx.to || '').toLowerCase();

  // Build deterministic string from normalized fields
  // Order matters for deterministic hashing
  const parts = [
    tx.id, // Transaction hash
    from,
    to,
    tx.currency || '',
    tx.amount || '',
    tx.type || '',
    tx.timestamp?.toString() || '',
  ];

  // Add token-specific fields if present to differentiate token transfers
  if (tx.tokenAddress) {
    parts.push(tx.tokenAddress.toLowerCase());
  }

  // Add trace ID if present to differentiate internal transactions with same hash
  if (tx.traceId) {
    parts.push(tx.traceId);
  }

  // Add log index if present to differentiate token transfers with same hash
  if (tx.logIndex !== undefined) {
    parts.push(tx.logIndex.toString());
  }

  const dataString = parts.join('|');

  // Generate SHA-256 hash
  const hash = createHash('sha256').update(dataString).digest('hex');

  return hash;
}
