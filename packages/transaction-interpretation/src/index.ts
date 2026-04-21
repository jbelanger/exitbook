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
  toDerivedFromTxIds,
  type AnnotationFingerprintInput,
  type AnnotationKind,
  type AnnotationProvenanceInput,
  type AnnotationRole,
  type AnnotationTarget,
  type AnnotationTier,
  type DerivedFromTxIds,
  type TransactionAnnotation,
} from './annotations/index.js';

export type {
  DetectorInput,
  DetectorOutput,
  ITransactionAnnotationDetector,
} from './detectors/transaction-annotation-detector.js';
export type {
  ITransactionAnnotationProfileDetector,
  ProfileDetectorInput,
} from './detectors/transaction-annotation-profile-detector.js';
export { BridgeParticipantDetector } from './detectors/bridge-participant-detector.js';
export { HeuristicBridgeParticipantDetector } from './detectors/heuristic-bridge-participant-detector.js';

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
