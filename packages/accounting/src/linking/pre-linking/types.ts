import type { Currency, TransactionLinkMetadata } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { LinkableMovement } from '../matching/linkable-movement.js';
import type { NewTransactionLink } from '../shared/types.js';

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
  metadata?: TransactionLinkMetadata | undefined;
}

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
