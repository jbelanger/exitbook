import { Effect, Layer } from 'effect';

import { TransactionClassification } from '../../core/aggregates/transaction.aggregate.js';
import type { TransactionClassifier } from '../../ports/transaction-classifier.port.js';
import {
  TransactionClassifierTag,
  type RawTransactionData,
} from '../../ports/transaction-classifier.port.js';

export interface ClassificationRule {
  classify(data: RawTransactionData): TransactionClassification;
  matches(data: RawTransactionData): boolean;
}

export class RuleBasedTransactionClassifier implements TransactionClassifier {
  constructor(private rules: ClassificationRule[]) {}

  classify(rawData: RawTransactionData): Effect.Effect<TransactionClassification, never> {
    return Effect.sync(() => {
      for (const rule of this.rules) {
        if (rule.matches(rawData)) {
          return rule.classify(rawData);
        }
      }
      return TransactionClassification.unknown();
    });
  }
}

export const RuleBasedTransactionClassifierLayer = (rules: ClassificationRule[]) =>
  Layer.succeed(TransactionClassifierTag, new RuleBasedTransactionClassifier(rules));
