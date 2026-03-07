import type { LinkCandidate } from '../link-candidate.js';

/**
 * Normalize a blockchain transaction hash by removing log index suffix.
 * Some providers (e.g., Moralis) append `-{logIndex}` to differentiate token transfers
 * within the same transaction, while others (e.g., Routescan) don't provide log index.
 *
 * Examples:
 * - 0xabc123-819 → 0xabc123
 * - 0xabc123 → 0xabc123
 *
 * @param txHash - Transaction hash, potentially with log index suffix
 * @returns Normalized transaction hash without suffix
 */
export function normalizeTransactionHash(txHash: string): string {
  // Strip -<number> suffix if present (log index from Moralis, etc.)
  return txHash.replace(/-\d+$/, '');
}

/**
 * Check if blockchain transaction hashes match (if both available).
 * Uses hash normalization to handle provider inconsistencies (e.g., log index suffixes).
 *
 * Safety: Only strips log index when one side has it and the other doesn't. If both
 * sides have log indices, requires exact match to prevent batched transfers from
 * collapsing into the same match.
 *
 * @param source - Source candidate
 * @param target - Target candidate
 * @returns True if hashes match, undefined if either hash not available
 */
export function checkTransactionHashMatch(source: LinkCandidate, target: LinkCandidate): boolean | undefined {
  const sourceHash = source.blockchainTxHash;
  const targetHash = target.blockchainTxHash;

  // Both must have hashes to compare
  if (!sourceHash || !targetHash) {
    return undefined;
  }

  // Check if each hash has a log index suffix
  const sourceHasLogIndex = /-\d+$/.test(sourceHash);
  const targetHasLogIndex = /-\d+$/.test(targetHash);

  let normalizedSource: string;
  let normalizedTarget: string;

  if (sourceHasLogIndex && targetHasLogIndex) {
    // Both have log indices - require exact match (don't strip)
    // This prevents batched transfers from collapsing into the same match
    normalizedSource = sourceHash;
    normalizedTarget = targetHash;
  } else if (sourceHasLogIndex || targetHasLogIndex) {
    // Only one has log index - strip it for comparison
    normalizedSource = normalizeTransactionHash(sourceHash);
    normalizedTarget = normalizeTransactionHash(targetHash);
  } else {
    // Neither has log index - compare as-is
    normalizedSource = sourceHash;
    normalizedTarget = targetHash;
  }

  // Only lowercase hex hashes (0x prefix) - Solana/Cardano hashes are case-sensitive
  const isHexHash = normalizedSource.startsWith('0x') || normalizedTarget.startsWith('0x');
  if (isHexHash) {
    return normalizedSource.toLowerCase() === normalizedTarget.toLowerCase();
  }

  // Case-sensitive comparison for non-hex hashes (Solana base58, etc.)
  return normalizedSource === normalizedTarget;
}
