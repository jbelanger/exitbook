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
