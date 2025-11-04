// Types and schemas
export type {
  LinkType,
  LinkStatus,
  MatchCriteria,
  TransactionLink,
  PotentialMatch,
  TransactionCandidate,
  MatchingConfig,
  LinkingResult,
} from './types.js';

export {
  LinkTypeSchema,
  LinkStatusSchema,
  MatchCriteriaSchema,
  TransactionLinkSchema,
  TransactionCandidateSchema,
  PotentialMatchSchema,
  MatchingConfigSchema,
  LinkingResultSchema,
} from './schemas.js';

// Matching and validation utilities (functional core)
export {
  DEFAULT_MATCHING_CONFIG,
  calculateAmountSimilarity,
  calculateTimeDifferenceHours,
  calculateVarianceMetadata,
  isTimingValid,
  determineLinkType,
  checkAddressMatch,
  calculateConfidenceScore,
  buildMatchCriteria,
  findPotentialMatches,
  shouldAutoConfirm,
  validateLinkAmounts,
  convertToCandidates,
  separateSourcesAndTargets,
  deduplicateAndConfirm,
  createTransactionLink,
} from './matching-utils.js';

// Service (imperative shell)
export { TransactionLinkingService } from './transaction-linking-service.js';

// Link index for efficient lookups
export { LinkIndex } from './link-index.js';
