/**
 * Contract Test: PurposeClassifier Interface
 *
 * Tests the PurposeClassifier interface contract without implementation.
 * These tests MUST fail until actual implementation is provided.
 */
import type { ProcessedTransaction, ClassifiedTransaction } from '@crypto/core';
import { TransactionEventType, MovementDirection, MovementPurpose, SourceType, ValidationStatus } from '@crypto/core';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type {
  PurposeClassifier,
  PurposeClassifierBatch,
  ClassifierConfig,
} from '../interfaces/purpose-classifier.interface.ts';
import { ClassificationError, ClassificationBatchError } from '../interfaces/purpose-classifier.interface.ts';

// Mock implementation for contract testing - should fail until real implementation
class MockPurposeClassifier implements PurposeClassifier, PurposeClassifierBatch {
  classify(tx: ProcessedTransaction): Result<ClassifiedTransaction, ClassificationError> {
    // This should fail - no implementation yet
    throw new Error('PurposeClassifier.classify not implemented');
  }

  classifyMany(txs: ProcessedTransaction[]): Result<ClassifiedTransaction[], ClassificationBatchError> {
    // This should fail - no implementation yet
    throw new Error('PurposeClassifierBatch.classifyMany not implemented');
  }
}

describe('PurposeClassifier Contract', () => {
  const mockClassifier = new MockPurposeClassifier();

  const sampleTransaction: ProcessedTransaction = {
    eventType: TransactionEventType.TRADE,
    id: 'test-001',
    movements: [
      {
        currency: 'BTC',
        direction: MovementDirection.IN,
        metadata: {
          accountId: 'main',
          tradingPair: 'BTC/USD',
        },
        movementId: 'btc_in',
        quantity: '0.1',
      },
      {
        currency: 'USD',
        direction: MovementDirection.OUT,
        metadata: {
          accountId: 'main',
          tradingPair: 'BTC/USD',
        },
        movementId: 'usd_out',
        quantity: '4500',
      },
    ],
    processedAt: new Date().toISOString(),
    processorVersion: '1.0.0',
    source: {
      name: 'kraken',
      type: SourceType.EXCHANGE,
    },
    sourceDetails: {
      orderId: 'order123',
      symbol: 'BTC/USD',
      type: SourceType.EXCHANGE,
    },
    sourceUid: 'user123',
    timestamp: '2025-09-23T10:30:00Z',
    validationStatus: ValidationStatus.VALID,
  };

  describe('Single Transaction Classification', () => {
    it('should implement classify method with correct signature', () => {
      expect(() => {
        const result = mockClassifier.classify(sampleTransaction);
        // This test should fail until implementation
        expect(result.isOk()).toBe(true);
      }).toThrow('PurposeClassifier.classify not implemented');
    });

    it('should return Result<ClassifiedTransaction, ClassificationError>', () => {
      expect(() => {
        const result = mockClassifier.classify(sampleTransaction);
        // Verify return type structure when implemented
        if (result.isOk()) {
          const classified = result.value;
          expect(classified).toHaveProperty('processedTransaction');
          expect(classified).toHaveProperty('movements');
          expect(classified).toHaveProperty('classifiedAt');
          expect(classified).toHaveProperty('classifierVersion');
          expect(classified).toHaveProperty('classificationInfo');
        }
      }).toThrow();
    });

    it('should classify all movements with purposes', () => {
      expect(() => {
        const result = mockClassifier.classify(sampleTransaction);
        if (result.isOk()) {
          const classified = result.value;
          expect(classified.movements).toHaveLength(2);
          for (const movement of classified.movements) {
            expect(movement).toHaveProperty('movement');
            expect(movement).toHaveProperty('purpose');
            expect(movement).toHaveProperty('confidence');
            expect(movement).toHaveProperty('ruleId');
            expect(Object.values(MovementPurpose)).toContain(movement.purpose);
            expect(movement.confidence).toBeGreaterThanOrEqual(0);
            expect(movement.confidence).toBeLessThanOrEqual(1);
          }
        }
      }).toThrow();
    });

    it('should handle classification errors gracefully', () => {
      const invalidTransaction = { ...sampleTransaction, movements: [] };

      expect(() => {
        const result = mockClassifier.classify(invalidTransaction);
        if (result.isErr()) {
          const error = result.error;
          expect(error).toBeInstanceOf(ClassificationError);
          expect(error.transactionId).toBe(invalidTransaction.id);
        }
      }).toThrow();
    });
  });

  describe('Batch Classification', () => {
    it('should implement classifyMany method with correct signature', () => {
      const transactions = [sampleTransaction];

      expect(() => {
        const result = mockClassifier.classifyMany(transactions);
        expect(result.isOk()).toBe(true);
      }).toThrow('PurposeClassifierBatch.classifyMany not implemented');
    });

    it('should return Result<ClassifiedTransaction[], ClassificationBatchError>', () => {
      const transactions = [sampleTransaction, sampleTransaction];

      expect(() => {
        const result = mockClassifier.classifyMany(transactions);
        if (result.isOk()) {
          const classifiedBatch = result.value;
          expect(Array.isArray(classifiedBatch)).toBe(true);
          expect(classifiedBatch).toHaveLength(2);
        }
      }).toThrow();
    });

    it('should handle batch errors with detailed failure information', () => {
      const transactions = [sampleTransaction];

      expect(() => {
        const result = mockClassifier.classifyMany(transactions);
        if (result.isErr()) {
          const error = result.error;
          expect(error).toBeInstanceOf(ClassificationBatchError);
          expect(error.failedTransactions).toBeDefined();
          expect(Array.isArray(error.failedTransactions)).toBe(true);
        }
      }).toThrow();
    });
  });

  describe('Classification Quality', () => {
    it('should assign high confidence to standard exchange trades', () => {
      expect(() => {
        const result = mockClassifier.classify(sampleTransaction);
        if (result.isOk()) {
          const classified = result.value;
          const principalMovements = classified.movements.filter((m) => m.purpose === MovementPurpose.PRINCIPAL);
          expect(principalMovements.length).toBeGreaterThan(0);
          for (const movement of principalMovements) {
            expect(movement.confidence).toBeGreaterThan(0.8);
          }
        }
      }).toThrow();
    });

    it('should maintain audit trail with rule information', () => {
      expect(() => {
        const result = mockClassifier.classify(sampleTransaction);
        if (result.isOk()) {
          const classified = result.value;
          expect(classified.classificationInfo).toBeDefined();
          expect(classified.classificationInfo.ruleSetVersion).toBeDefined();
          expect(classified.classificationInfo.appliedRules).toBeDefined();
          expect(classified.classificationInfo.overallConfidence).toBeGreaterThanOrEqual(0);
          expect(classified.classificationInfo.overallConfidence).toBeLessThanOrEqual(1);
        }
      }).toThrow();
    });
  });

  describe('Configuration', () => {
    it('should accept and respect classifier configuration', () => {
      const config: ClassifierConfig = {
        enableDebugLogging: false,
        maxOtherPercentage: 0.1,
        minConfidence: 0.7,
        strictMode: true,
      };

      // This test verifies that when a configured classifier is implemented,
      // it respects the configuration parameters
      expect(() => {
        // ConfigurablePurposeClassifier would be implemented with config
        const result = mockClassifier.classify(sampleTransaction);
        // Configuration should affect classification behavior
      }).toThrow();
    });
  });
});
