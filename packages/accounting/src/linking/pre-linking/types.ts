import type { LinkCandidate } from '../link-candidate.js';
import type { NewTransactionLink } from '../types.js';

/**
 * Result of building link candidates.
 */
export interface LinkCandidateBuildResult {
  /** Link candidates to pass to matching strategies */
  candidates: LinkCandidate[];
  /** Internal blockchain links (same tx hash, different tracked addresses) — always confirmed */
  internalLinks: NewTransactionLink[];
}

export type { LinkCandidate } from '../link-candidate.js';
