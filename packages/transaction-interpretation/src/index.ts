export {
  ANNOTATION_KINDS,
  ANNOTATION_PROVENANCE_INPUTS,
  ANNOTATION_ROLES,
  ANNOTATION_TIERS,
  AnnotationKindSchema,
  AnnotationProvenanceInputSchema,
  AnnotationRoleSchema,
  AnnotationTargetSchema,
  AnnotationTierSchema,
  TransactionAnnotationSchema,
  canonicalizeDerivedFromTxIds,
  computeAnnotationFingerprint,
  getStakingRewardComponents,
  sumDetectedStakingRewardComponentsForTransactions,
  sumUniqueStakingRewardComponents,
  toDerivedFromTxIds,
  type AnnotationFingerprintInput,
  type AnnotationKind,
  type AnnotationProvenanceInput,
  type AnnotationRole,
  type StakingRewardComponent,
  type AnnotationTarget,
  type AnnotationTier,
  type DerivedFromTxIds,
  type TransactionAnnotation,
} from './annotations/index.js';
export {
  deriveOperationLabel,
  type DerivedOperationGroup,
  type DerivedOperationLabel,
} from './labels/derive-operation-label.js';
export {
  collectTransactionReadinessIssues,
  type TransactionReadinessIssue,
  type TransactionReadinessIssueCode,
} from './readiness/transaction-readiness-issues.js';
export {
  deriveTransactionGapContextHint,
  hasLikelyDustSignal,
  shouldSuppressTransactionGapIssue,
  type TransactionGapContextHint,
} from './gap/transaction-gap-policy.js';

export type {
  DetectorInput,
  DetectorOutput,
  ITransactionAnnotationDetector,
} from './detectors/transaction-annotation-detector.js';
export type {
  ITransactionAnnotationProfileDetector,
  ProfileDetectorInput,
} from './detectors/transaction-annotation-profile-detector.js';
export { AssetMigrationParticipantDetector } from './detectors/asset-migration-participant-detector.js';
export { BridgeParticipantDetector } from './detectors/bridge-participant-detector.js';
export { HeuristicBridgeParticipantDetector } from './detectors/heuristic-bridge-participant-detector.js';
export { StakingRewardDetector } from './detectors/staking-reward-detector.js';
export { StakingRewardComponentDetector } from './detectors/staking-reward-component-detector.js';

export type { TransactionAnnotationQuery } from './persistence/transaction-annotation-query.js';
export type {
  ITransactionAnnotationStore,
  ReplaceByDetectorGroupInput,
  ReplaceByDetectorInput,
  ReplaceByTransactionInput,
} from './persistence/transaction-annotation-store.js';

export { TransactionAnnotationDetectorRegistry } from './runtime/transaction-annotation-detector-registry.js';
export { TransactionAnnotationProfileDetectorRegistry } from './runtime/transaction-annotation-profile-detector-registry.js';
export {
  InterpretationRuntime,
  type InterpretationRuntimeDeps,
  type RunDetectorForProfileInput,
  type RunDetectorForTransactionInput,
} from './runtime/interpretation-runtime.js';
export type {
  ITransactionInterpretationSourceReader,
  InterpretationAccountContext,
  LoadTransactionForInterpretationInput,
  LoadProfileInterpretationScopeInput,
  ProfileInterpretationScope,
} from './runtime/transaction-interpretation-source-reader.js';
