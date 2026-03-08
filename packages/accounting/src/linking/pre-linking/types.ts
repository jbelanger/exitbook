import type { Currency } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { LinkCandidate } from '../link-candidate.js';
import type { NewTransactionLink } from '../types.js';

export interface PendingInternalLink {
  sourceTransactionId: number;
  targetTransactionId: number;
  assetSymbol: Currency;
  sourceAssetId: string;
  targetAssetId: string;
  sourceAmount: Decimal;
  targetAmount: Decimal;
  linkType: 'blockchain_internal';
  confidenceScore: Decimal;
  matchCriteria: {
    addressMatch?: boolean | undefined;
    amountSimilarity: Decimal;
    assetMatch: boolean;
    timingHours: number;
    timingValid: boolean;
  };
  status: 'confirmed';
  reviewedBy: 'auto';
  reviewedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown> | undefined;
}

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
