import type { NewTransactionLink } from '@exitbook/core';

import type { LinkableMovement } from '../matching/linkable-movement.js';

/**
 * A NewTransactionLink before movement fingerprints have been resolved.
 * Used in the pre-linking stage where links are built from same-hash groups
 * before linkable movements (and their fingerprints) exist.
 */
export type PendingInternalLink = Omit<
  NewTransactionLink,
  'sourceMovementFingerprint' | 'targetMovementFingerprint' | 'linkType' | 'status' | 'reviewedBy'
> & {
  linkType: 'blockchain_internal';
  reviewedBy: 'auto';
  status: 'confirmed';
};
/**
 * Result of building linkable movements.
 */
export interface LinkableMovementBuildResult {
  /** Linkable movements to pass to matching strategies */
  linkableMovements: LinkableMovement[];
  /** Internal blockchain links (same tx hash, different tracked addresses) — always confirmed */
  internalLinks: NewTransactionLink[];
}

export type { LinkableMovement } from '../matching/linkable-movement.js';
