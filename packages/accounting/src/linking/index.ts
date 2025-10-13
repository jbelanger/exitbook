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

// Matching utilities
export {
  DEFAULT_MATCHING_CONFIG,
  calculateAmountSimilarity,
  calculateTimeDifferenceHours,
  isTimingValid,
  determineLinkType,
  checkAddressMatch,
  calculateConfidenceScore,
  buildMatchCriteria,
  findPotentialMatches,
  shouldAutoConfirm,
} from './matching-utils.js';

// Service
export { TransactionLinkingService } from './transaction-linking-service.js';
