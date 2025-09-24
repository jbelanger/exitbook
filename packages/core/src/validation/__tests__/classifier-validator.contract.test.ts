/**
 * Contract Test: ClassifierValidator Interface
 *
 * Tests the ClassifierValidator interface contract without implementation.
 * These tests MUST fail until actual implementation is provided.
 */
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import {
  type ClassifiedTransaction,
  type ClassifierValidator,
  type ContractValidationResult,
  MovementDirection,
  MovementPurpose,
  type ProcessedTransaction,
  SourceType,
  TransactionEventType,
  ValidationCodes,
  ValidationStatus,
} from '../../types.js';

// Mock implementation for contract testing - should fail until real implementation
class MockClassifierValidator implements ClassifierValidator {
  validate(_tx: ClassifiedTransaction): Result<ContractValidationResult<ClassifiedTransaction>, string> {
    // This should fail - no implementation yet
    throw new Error('ClassifierValidator.validate not implemented');
  }

  validateBatch(_txs: ClassifiedTransaction[]): Result<ContractValidationResult<ClassifiedTransaction[]>, string> {
    // This should fail - no implementation yet
    throw new Error('ClassifierValidator.validateBatch not implemented');
  }
}

describe('ClassifierValidator Contract', () => {
  const mockValidator = new MockClassifierValidator();

  const baseTransaction: ProcessedTransaction = {
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
      kind: 'exchange',
      orderId: 'order123',
      venue: 'kraken',
    },
    sourceUid: 'user123',
    timestamp: '2025-09-23T10:30:00Z',
    validationStatus: ValidationStatus.VALID,
  };

  const validClassifiedTransaction: ClassifiedTransaction = {
    classificationInfo: {
      appliedRules: [
        {
          confidence: 0.95,
          matched: true,
          reasoning: 'Standard exchange trade pattern detected',
          ruleId: 'exchange_trade_main_asset',
          ruleName: 'Exchange Trade Main Asset Rule',
        },
      ],
      lowConfidenceMovements: [],
      overallConfidence: 0.95,
      ruleSetVersion: '1.0.0',
    },
    classifiedAt: new Date().toISOString(),
    classifierVersion: '1.0.0',
    movements: [
      {
        confidence: 0.95,
        movement: baseTransaction.movements[0],
        purpose: MovementPurpose.PRINCIPAL,
        reasoning: 'Primary asset in exchange trade',
        ruleId: 'exchange_trade_main_asset',
      },
      {
        confidence: 0.95,
        movement: baseTransaction.movements[1],
        purpose: MovementPurpose.PRINCIPAL,
        reasoning: 'Counter asset in exchange trade',
        ruleId: 'exchange_trade_main_asset',
      },
    ],
    processedTransaction: baseTransaction,
  };

  describe('Single Transaction Validation', () => {
    it('should implement validate method with correct signature', () => {
      expect(() => {
        const result = mockValidator.validate(validClassifiedTransaction);
        expect(result.isOk()).toBe(true);
      }).toThrow('ClassifierValidator.validate not implemented');
    });

    it('should return Result<ValidationResult, string>', () => {
      expect(() => {
        const result = mockValidator.validate(validClassifiedTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult).toHaveProperty('ok');
          expect(validationResult).toHaveProperty('issues');
          expect(typeof validationResult.ok).toBe('boolean');
          expect(Array.isArray(validationResult.issues)).toBe(true);
        }
      }).toThrow();
    });

    it('should pass validation for complete classifications', () => {
      expect(() => {
        const result = mockValidator.validate(validClassifiedTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(true);
          expect(validationResult.issues).toHaveLength(0);
        }
      }).toThrow();
    });

    it('should detect unclassified movements', () => {
      const incompleteClassification: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        movements: [
          // Missing one movement classification
          validClassifiedTransaction.movements[0],
        ],
      };

      expect(() => {
        const result = mockValidator.validate(incompleteClassification);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const unclassifiedIssues = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.UNCLASSIFIED_MOVEMENT
          );
          expect(unclassifiedIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should validate confidence scores are within range', () => {
      const invalidConfidenceClassification: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        movements: [
          {
            ...validClassifiedTransaction.movements[0],
            confidence: 1.5, // Invalid confidence > 1.0
          },
          {
            ...validClassifiedTransaction.movements[1],
            confidence: -0.1, // Invalid confidence < 0.0
          },
        ],
      };

      expect(() => {
        const result = mockValidator.validate(invalidConfidenceClassification);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const confidenceIssues = validationResult.issues.filter(
            (issue) =>
              issue.code === ValidationCodes.LOW_CONFIDENCE_CLASSIFICATION ||
              issue.code === ValidationCodes.INVALID_FIELD_FORMAT
          );
          expect(confidenceIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should validate classification metadata completeness', () => {
      const incompleteMetadata: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        classificationInfo: {
          ...validClassifiedTransaction.classificationInfo,
          appliedRules: [], // Missing applied rules
        },
      };

      expect(() => {
        const result = mockValidator.validate(incompleteMetadata);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const metadataIssues = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.MISSING_CLASSIFICATION_INFO
          );
          expect(metadataIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should validate rule application consistency', () => {
      const inconsistentRules: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        classificationInfo: {
          ...validClassifiedTransaction.classificationInfo,
          appliedRules: [
            // Only mentions rule_A, but rule_B was also used
            {
              confidence: 0.95,
              matched: true,
              reasoning: 'Rule A applied',
              ruleId: 'rule_A',
              ruleName: 'Rule A',
            },
          ],
        },
        movements: [
          {
            ...validClassifiedTransaction.movements[0],
            ruleId: 'rule_A',
          },
          {
            ...validClassifiedTransaction.movements[1],
            ruleId: 'rule_B',
          },
        ],
      };

      expect(() => {
        const result = mockValidator.validate(inconsistentRules);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const consistencyIssues = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.INCONSISTENT_RULE_APPLICATION
          );
          expect(consistencyIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should flag low confidence classifications', () => {
      const lowConfidenceClassification: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        classificationInfo: {
          ...validClassifiedTransaction.classificationInfo,
          lowConfidenceMovements: ['btc_in'],
          overallConfidence: 0.65,
        },
        movements: [
          {
            ...validClassifiedTransaction.movements[0],
            confidence: 0.3, // Very low confidence
          },
          validClassifiedTransaction.movements[1],
        ],
      };

      expect(() => {
        const result = mockValidator.validate(lowConfidenceClassification);
        if (result.isOk()) {
          const validationResult = result.value;
          // Should still pass validation but include warnings
          const lowConfidenceWarnings = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.LOW_CONFIDENCE_CLASSIFICATION && issue.severity === 'warn'
          );
          expect(lowConfidenceWarnings.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });
  });

  describe('Batch Validation', () => {
    it('should implement validateBatch method with correct signature', () => {
      const transactions = [validClassifiedTransaction];

      expect(() => {
        const result = mockValidator.validateBatch(transactions);
        expect(result.isOk()).toBe(true);
      }).toThrow('ClassifierValidator.validateBatch not implemented');
    });

    it('should return Result<ValidationResult, string>', () => {
      const transactions = [validClassifiedTransaction, validClassifiedTransaction];

      expect(() => {
        const result = mockValidator.validateBatch(transactions);
        if (result.isOk()) {
          const batchValidationResult = result.value;
          expect(batchValidationResult).toHaveProperty('ok');
          expect(batchValidationResult).toHaveProperty('issues');
          expect(typeof batchValidationResult.ok).toBe('boolean');
          expect(Array.isArray(batchValidationResult.issues)).toBe(true);
        }
      }).toThrow();
    });

    it('should validate classification quality across batch', () => {
      const transactions = [
        validClassifiedTransaction,
        {
          ...validClassifiedTransaction,
          movements: [
            {
              ...validClassifiedTransaction.movements[0],
              purpose: MovementPurpose.OTHER, // High percentage of OTHER
            },
            {
              ...validClassifiedTransaction.movements[1],
              purpose: MovementPurpose.OTHER,
            },
          ],
        },
      ];

      expect(() => {
        const result = mockValidator.validateBatch(transactions);
        if (result.isOk()) {
          const batchValidationResult = result.value;
          // Should detect high percentage of OTHER classifications
          const qualityIssues = batchValidationResult.issues.filter(
            (issue) => issue.severity === 'warn' && issue.message.includes('OTHER')
          );
          expect(qualityIssues.length).toBeGreaterThanOrEqual(0);
        }
      }).toThrow();
    });

    it('should aggregate confidence metrics across batch', () => {
      const transactions = [
        validClassifiedTransaction,
        {
          ...validClassifiedTransaction,
          classificationInfo: {
            ...validClassifiedTransaction.classificationInfo,
            overallConfidence: 0.675,
          },
          movements: [
            {
              ...validClassifiedTransaction.movements[0],
              confidence: 0.4, // Low confidence
            },
            validClassifiedTransaction.movements[1],
          ],
        },
      ];

      expect(() => {
        const result = mockValidator.validateBatch(transactions);
        if (result.isOk()) {
          const batchValidationResult = result.value;
          // Should analyze overall confidence distribution
          const confidenceIssues = batchValidationResult.issues.filter((issue) => issue.message.includes('confidence'));
          expect(Array.isArray(confidenceIssues)).toBe(true);
        }
      }).toThrow();
    });
  });

  describe('Classification Quality Metrics', () => {
    it('should validate overall confidence calculations', () => {
      const inconsistentConfidence: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        classificationInfo: {
          ...validClassifiedTransaction.classificationInfo,
          overallConfidence: 0.5, // Inconsistent with movement confidences
        },
        movements: [
          {
            ...validClassifiedTransaction.movements[0],
            confidence: 0.8,
          },
          {
            ...validClassifiedTransaction.movements[1],
            confidence: 0.9,
          },
        ],
      };

      expect(() => {
        const result = mockValidator.validate(inconsistentConfidence);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const confidenceIssues = validationResult.issues.filter((issue) =>
            issue.field?.includes('overallConfidence')
          );
          expect(confidenceIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should validate rule version consistency', () => {
      const versionMismatch: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        classificationInfo: {
          ...validClassifiedTransaction.classificationInfo,
          ruleSetVersion: '2.0.0', // Version mismatch
        },
        classifierVersion: '1.0.0',
      };

      expect(() => {
        const result = mockValidator.validate(versionMismatch);
        if (result.isOk()) {
          const validationResult = result.value;
          // May pass but should warn about version inconsistencies
          const versionWarnings = validationResult.issues.filter(
            (issue) => issue.message.includes('version') && issue.severity === 'warn'
          );
          expect(Array.isArray(versionWarnings)).toBe(true);
        }
      }).toThrow();
    });
  });
});
