import type { MatchingConfig, PotentialMatch } from './types.js';

/**
 * Check if a match should be auto-confirmed based on confidence threshold
 *
 * @param match - Potential match
 * @param config - Matching configuration
 * @returns True if match should be auto-confirmed
 */
export function shouldAutoConfirm(match: PotentialMatch, config: MatchingConfig): boolean {
  return match.confidenceScore.greaterThanOrEqualTo(config.autoConfirmThreshold);
}

/**
 * Allocate the best non-overlapping set of matches from all candidates.
 *
 * Greedy selection by confidence (highest first), ensuring:
 * - Each target is used at most once
 * - Each source is used at most once for non-hash matches
 * - Hash matches allow multiple targets per source (e.g., one blockchain tx → multiple exchange deposits)
 * - Hash and non-hash matches don't mix for the same source
 *
 * Separates results into confirmed vs suggested based on confidence threshold.
 *
 * @param matches - All potential matches
 * @param config - Matching configuration
 * @returns Object with confirmed and suggested matches
 */
export function allocateMatches(
  matches: PotentialMatch[],
  config: MatchingConfig
): {
  confirmed: PotentialMatch[];
  suggested: PotentialMatch[];
} {
  // Sort all matches by confidence (highest first), with hash matches prioritized as tiebreaker
  // This ensures hash matches are processed before non-hash matches at equal confidence
  const sortedMatches = [...matches].sort((a, b) => {
    const confidenceComparison = b.confidenceScore.comparedTo(a.confidenceScore);
    if (confidenceComparison !== 0) return confidenceComparison;

    // Tiebreaker: hash matches before non-hash matches
    const aIsHash = a.matchCriteria.hashMatch === true;
    const bIsHash = b.matchCriteria.hashMatch === true;
    if (aIsHash && !bIsHash) return -1;
    if (!aIsHash && bIsHash) return 1;
    return 0;
  });

  const usedSources = new Set<number>();
  const usedSourcesNonHash = new Set<number>();
  const usedTargets = new Set<number>();
  const deduplicatedMatches: PotentialMatch[] = [];

  // Greedily select matches, ensuring each source and target is used at most once
  // EXCEPT: Allow multiple hash matches per source (same tx hash, multiple outputs)
  for (const match of sortedMatches) {
    const sourceId = match.sourceTransaction.id;
    const targetId = match.targetTransaction.id;
    const isHashMatch = match.matchCriteria.hashMatch === true;

    // Skip if target is already used (one target can only match one source)
    if (usedTargets.has(targetId)) {
      continue;
    }

    // For non-hash matches: enforce 1:1 source matching
    // For hash matches: allow multiple per source (e.g., one blockchain tx → multiple exchange deposits)
    // But don't mix hash matches with non-hash matches for the same source
    if (!isHashMatch && usedSources.has(sourceId)) {
      continue;
    }
    if (isHashMatch && usedSourcesNonHash.has(sourceId)) {
      continue;
    }

    // Accept this match
    deduplicatedMatches.push(match);
    usedTargets.add(targetId);
    usedSources.add(sourceId);
    if (!isHashMatch) {
      usedSourcesNonHash.add(sourceId);
    }
  }

  const suggested: PotentialMatch[] = [];
  const confirmed: PotentialMatch[] = [];

  // Separate into confirmed vs suggested based on confidence threshold
  for (const match of deduplicatedMatches) {
    if (shouldAutoConfirm(match, config)) {
      confirmed.push(match);
    } else {
      suggested.push(match);
    }
  }

  return { suggested, confirmed };
}
