export { LinkingOrchestrator } from './linking/orchestration/linking-orchestrator.js';
export type { LinkingRunParams, LinkingRunResult } from './linking/orchestration/linking-orchestrator.js';
export type { LinkingEvent } from './linking/orchestration/linking-events.js';
export {
  deriveTransferProposalStatus,
  getExplicitTransferProposalKey,
  getTransferProposalGroupKey,
  groupLinksByTransferProposal,
} from './linking/shared/transfer-proposals.js';
export { buildMatchingConfig } from './linking/matching/matching-config.js';
export {
  filterConfirmableTransferProposals,
  validateTransferProposalConfirmability,
} from './linking/shared/transfer-proposal-confirmability.js';
export type { TransferProposalLink } from './linking/shared/transfer-proposals.js';
export {
  buildConfirmedLinkFromExactMovements,
  buildManualLinkOverrideMetadata,
  prepareGroupedManualLinksFromTransactions,
  prepareManualLinkFromTransactions,
} from './linking/orchestration/manual-link-utils.js';
export type { PreparedGroupedManualLinks, PreparedManualLink } from './linking/orchestration/manual-link-utils.js';
export { analyzeLinkGaps, applyResolvedLinkGapVisibility } from './linking/gaps/gap-analysis.js';
export type { AnalyzeLinkGapsOptions, ResolvedLinkGapVisibilityResult } from './linking/gaps/gap-analysis.js';
export {
  buildProfileLinkGapAnalysis,
  buildVisibleProfileLinkGapAnalysis,
  loadVisibleProfileLinkGapAnalysis,
} from './linking/gaps/profile-link-gap-analysis.js';
export { buildLinkGapCrossProfileCounterpartsByIssueKey } from './linking/gaps/cross-profile-gap-counterparts.js';
export { buildLinkGapIssueKey } from './linking/gaps/gap-model.js';
export type {
  GapCueKind,
  LinkGapAnalysis,
  LinkGapAssetSummary,
  LinkGapDirection,
  LinkGapIssue,
  LinkGapIssueIdentity,
} from './linking/gaps/gap-model.js';
export type { LinkGapCrossProfileCounterpart } from './linking/gaps/cross-profile-gap-counterparts.js';
