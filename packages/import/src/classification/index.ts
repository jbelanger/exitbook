/**
 * Purpose Classification Module
 *
 * Provides deterministic business purpose classification for processed transactions.
 * Implements three-stage pipeline: Processor → Classifier → Transformer
 */

// Core interfaces
export type {
  PurposeClassifier,
  PurposeClassifierBatch,
  ClassificationRule,
  ClassificationResult,
  ClassificationMetrics,
  ClassifierConfig,
} from './interfaces/purpose-classifier.interface.js';
export type {
  ProcessorValidator,
  ClassifierValidator,
  TransformerValidator,
  ValidationIssue,
  ValidationResult,
  ValidationCode,
  ValidatorConfig,
} from './interfaces/validation.interface.js';

// Classification error
export { ClassificationError } from './interfaces/purpose-classifier.interface.js';

// Validation codes
export { ValidationCodes } from './interfaces/validation.interface.js';

// Core implementation (when implemented)
// export { PurposeClassifierImpl } from './purpose-classifier.js';

// Rule implementations (when implemented)
// export { ExchangeTradingRules } from './rules/exchange-trading-rules.js';
// export { BlockchainTransferRules } from './rules/blockchain-transfer-rules.js';
// export { FeeClassificationRules } from './rules/fee-classification-rules.js';

// Validators (when implemented)
// export { ProcessorValidatorImpl } from './validators/processor-validator.js';
// export { ClassifierValidatorImpl } from './validators/classifier-validator.js';
// export { TransformerValidatorImpl } from './validators/transformer-validator.js';

// Metrics (when implemented)
// export { ClassificationMetricsCollector } from './classification-metrics.js';
