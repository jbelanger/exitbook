export { LinkingOrchestrator } from './linking/orchestration/linking-orchestrator.js';
export type { LinkingRunParams, LinkingRunResult } from './linking/orchestration/linking-orchestrator.js';
export type { LinkingEvent } from './linking/orchestration/linking-events.js';
export {
  deriveTransferProposalStatus,
  getExplicitTransferProposalKey,
  getTransferProposalGroupKey,
  groupLinksByTransferProposal,
} from './linking/shared/transfer-proposals.js';
export {
  buildConfirmedLinkFromExactMovements,
  buildManualLinkOverrideMetadata,
  prepareManualLinkFromTransactions,
} from './linking/orchestration/manual-link-utils.js';
export type { PreparedManualLink } from './linking/orchestration/manual-link-utils.js';
export { analyzeLinkGaps, applyResolvedLinkGapVisibility } from './linking/gaps/gap-analysis.js';
export type { AnalyzeLinkGapsOptions, ResolvedLinkGapVisibilityResult } from './linking/gaps/gap-analysis.js';
export { buildLinkGapIssueKey } from './linking/gaps/gap-model.js';
export type {
  GapCueKind,
  LinkGapAnalysis,
  LinkGapAssetSummary,
  LinkGapDirection,
  LinkGapIssue,
  LinkGapIssueIdentity,
} from './linking/gaps/gap-model.js';
