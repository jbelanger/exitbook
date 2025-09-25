// Legacy types (kept for compatibility)
export * from './types.js';
export * from './schemas/universal-schemas.js';

// New ProcessedTransaction + Purpose Classifier types
export * from './types/primitives.js';
export * from './types/Money.js';
export * from './types/SourceDetails.js';
export * from './types/MovementUnclassified.js';
export * from './types/ClassificationInfo.js';
export * from './types/MovementClassified.js';
export * from './types/ProcessedTransaction.js';
export * from './types/ClassifiedTransaction.js';

// Schemas
export * from './schemas/processed-transaction-schemas.js';

// Utilities
export * from './utils/zod-utils.js';

// Errors
export * from './errors/index.js';
