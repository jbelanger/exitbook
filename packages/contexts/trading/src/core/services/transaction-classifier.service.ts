import { Effect, Context, Layer, Data } from 'effect';

export class TransactionClassification extends Data.Class<{
  readonly confidence: number;
  readonly protocol?: string;
  readonly subType?: string;
  readonly type: string;
}> {
  static unknown(): TransactionClassification {
    return new TransactionClassification({
      confidence: 0,
      type: 'UNKNOWN',
    });
  }
}

export interface RawTransactionData {
  readonly amount?: string;
  readonly currency?: string;
  readonly fee?: string;
  readonly metadata?: Record<string, unknown>;
  readonly source: string;
  readonly type?: string;
}

// Service interface
export interface TransactionClassifier {
  classify(rawData: RawTransactionData): Effect.Effect<TransactionClassification, never>;
}

export const TransactionClassifier =
  Context.GenericTag<TransactionClassifier>('TransactionClassifier');

// Implementation
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

export interface ClassificationRule {
  classify(data: RawTransactionData): TransactionClassification;
  matches(data: RawTransactionData): boolean;
}

// Layer
export const RuleBasedTransactionClassifierLayer = (rules: ClassificationRule[]) =>
  Layer.succeed(TransactionClassifier, new RuleBasedTransactionClassifier(rules));
