import { UnifiedEventBusDefault } from '@exitbook/platform-event-bus';
import { Layer } from 'effect';

import { TransactionRepositoryLive } from '../adapters/repositories/transaction.repository.js';
import {
  RuleBasedTransactionClassifierLayer,
  type ClassificationRule,
} from '../adapters/services/rule-based-transaction-classifier.adapter.js';

// Default classification rules for production
const defaultClassificationRules: ClassificationRule[] = [
  // Add specific classification rules here
];

// Production runtime layer composition
// This assembles all the live implementations for production use
export const TradingRuntimeDefault = Layer.mergeAll(
  UnifiedEventBusDefault,
  RuleBasedTransactionClassifierLayer(defaultClassificationRules),
  TransactionRepositoryLive,
);
