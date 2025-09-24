/**
 * Contract Test: ProcessorValidator Interface
 *
 * Tests the ProcessorValidator interface contract without implementation.
 * These tests MUST fail until actual implementation is provided.
 */
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import {
  type ContractValidationResult,
  MovementDirection,
  type ProcessedTransaction,
  type ProcessorValidator,
  SourceType,
  TransactionEventType,
  ValidationCodes,
  type ValidationIssue,
  ValidationStatus,
} from '../../types.js';

// Mock implementation for contract testing - should fail until real implementation
class MockProcessorValidator implements ProcessorValidator {
  validate(_tx: ProcessedTransaction): Result<ContractValidationResult<ProcessedTransaction>, string> {
    // This should fail - no implementation yet
    throw new Error('ProcessorValidator.validate not implemented');
  }

  validateMany(_txs: ProcessedTransaction[]): Result<ContractValidationResult<ProcessedTransaction>[], string> {
    // This should fail - no implementation yet
    throw new Error('ProcessorValidator.validateMany not implemented');
  }
}

describe('ProcessorValidator Contract', () => {
  const mockValidator = new MockProcessorValidator();

  const validTransaction: ProcessedTransaction = {
    eventType: TransactionEventType.TRADE,
    id: 'test-001',
    movements: [
      {
        amount: '0.1',
        currency: 'BTC',
        direction: MovementDirection.IN,
        metadata: {
          accountId: 'main',
          tradingPair: 'BTC/USD',
        },
        movementId: 'btc_in',
      },
      {
        amount: '4500',
        currency: 'USD',
        direction: MovementDirection.OUT,
        metadata: {
          accountId: 'main',
          tradingPair: 'BTC/USD',
        },
        movementId: 'usd_out',
      },
    ],
    processedAt: new Date(),
    processorVersion: '1.0.0',
    source: {
      name: 'kraken',
      type: SourceType.EXCHANGE,
    },
    sourceSpecific: {
      orderId: 'order123',
      symbol: 'BTC/USD',
      type: SourceType.EXCHANGE,
    },
    sourceUid: 'user123',
    timestamp: new Date('2025-09-23T10:30:00Z'),
    validationStatus: ValidationStatus.VALID,
  };

  describe('Single Transaction Validation', () => {
    it('should implement validate method with correct signature', () => {
      expect(() => {
        const result = mockValidator.validate(validTransaction);
        expect(result.isOk()).toBe(true);
      }).toThrow('ProcessorValidator.validate not implemented');
    });

    it('should return Result<ValidationResult, string>', () => {
      expect(() => {
        const result = mockValidator.validate(validTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult).toHaveProperty('ok');
          expect(validationResult).toHaveProperty('issues');
          expect(typeof validationResult.ok).toBe('boolean');
          expect(Array.isArray(validationResult.issues)).toBe(true);
        }
      }).toThrow();
    });

    it('should pass validation for well-formed transactions', () => {
      expect(() => {
        const result = mockValidator.validate(validTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(true);
          expect(validationResult.issues).toHaveLength(0);
        }
      }).toThrow();
    });

    it('should detect missing required fields', () => {
      const invalidTransaction = { ...validTransaction, id: '' };

      expect(() => {
        const result = mockValidator.validate(invalidTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const missingFieldIssues = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.MISSING_REQUIRED_FIELD
          );
          expect(missingFieldIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should validate zero-sum transfers', () => {
      const transferTransaction: ProcessedTransaction = {
        ...validTransaction,
        eventType: TransactionEventType.TRANSFER,
        movements: [
          {
            amount: '0.1',
            currency: 'BTC',
            direction: MovementDirection.OUT,
            metadata: { accountId: 'main' },
            movementId: 'btc_out',
          },
          {
            amount: '0.09', // Different amount - should fail zero-sum
            currency: 'BTC',
            direction: MovementDirection.IN,
            metadata: { accountId: 'main' },
            movementId: 'btc_in',
          },
        ],
      };

      expect(() => {
        const result = mockValidator.validate(transferTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const zeroSumIssues = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.NON_ZERO_SUM_TRANSFER
          );
          expect(zeroSumIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should validate trade requirements', () => {
      const invalidTradeTransaction: ProcessedTransaction = {
        ...validTransaction,
        movements: [
          // Trade should have at least 2 movements with different currencies
          {
            amount: '0.1',
            currency: 'BTC',
            direction: MovementDirection.IN,
            metadata: { accountId: 'main' },
            movementId: 'btc_only',
          },
        ],
      };

      expect(() => {
        const result = mockValidator.validate(invalidTradeTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const tradeIssues = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.INSUFFICIENT_TRADE_MOVEMENTS
          );
          expect(tradeIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should validate movement direction consistency', () => {
      const invalidDirectionTransaction: ProcessedTransaction = {
        ...validTransaction,
        movements: [
          {
            amount: '0.1',
            currency: 'BTC',
            direction: 'INVALID' as MovementDirection,
            metadata: { accountId: 'main' },
            movementId: 'invalid_direction',
          },
        ],
      };

      expect(() => {
        const result = mockValidator.validate(invalidDirectionTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const directionIssues = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.INVALID_MOVEMENT_DIRECTION
          );
          expect(directionIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should validate amount precision and format', () => {
      const invalidAmountTransaction: ProcessedTransaction = {
        ...validTransaction,
        movements: [
          {
            amount: 'not-a-number',
            currency: 'BTC',
            direction: MovementDirection.IN,
            metadata: { accountId: 'main' },
            movementId: 'invalid_amount',
          },
        ],
      };

      expect(() => {
        const result = mockValidator.validate(invalidAmountTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const formatIssues = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.INVALID_FIELD_FORMAT
          );
          expect(formatIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should reject negative amounts', () => {
      const negativeAmountTransaction: ProcessedTransaction = {
        ...validTransaction,
        movements: [
          {
            amount: '-0.1',
            currency: 'BTC',
            direction: MovementDirection.IN,
            metadata: { accountId: 'main' },
            movementId: 'negative_amount',
          },
        ],
      };

      expect(() => {
        const result = mockValidator.validate(negativeAmountTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const negativeIssues = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.NEGATIVE_QUANTITY
          );
          expect(negativeIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });
  });

  describe('Batch Validation', () => {
    it('should implement validateMany method with correct signature', () => {
      const transactions = [validTransaction];

      expect(() => {
        const result = mockValidator.validateMany(transactions);
        expect(result.isOk()).toBe(true);
      }).toThrow('ProcessorValidator.validateMany not implemented');
    });

    it('should return Result<ValidationResult[], string>', () => {
      const transactions = [validTransaction, validTransaction];

      expect(() => {
        const result = mockValidator.validateMany(transactions);
        if (result.isOk()) {
          const validationResults = result.value;
          expect(Array.isArray(validationResults)).toBe(true);
          expect(validationResults).toHaveLength(2);
          for (const vr of validationResults) {
            expect(vr).toHaveProperty('ok');
            expect(vr).toHaveProperty('issues');
          }
        }
      }).toThrow();
    });

    it('should validate each transaction independently', () => {
      const transactions = [
        validTransaction,
        { ...validTransaction, id: '' }, // Invalid transaction
      ];

      expect(() => {
        const result = mockValidator.validateMany(transactions);
        if (result.isOk()) {
          const validationResults = result.value;
          expect(validationResults[0].ok).toBe(true);
          expect(validationResults[1].ok).toBe(false);
        }
      }).toThrow();
    });
  });

  describe('Validation Issue Structure', () => {
    it('should provide detailed validation issues', () => {
      const invalidTransaction = { ...validTransaction, id: '' };

      expect(() => {
        const result = mockValidator.validate(invalidTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          if (validationResult.issues.length > 0) {
            const issue: ValidationIssue = validationResult.issues[0];
            expect(issue).toHaveProperty('code');
            expect(issue).toHaveProperty('message');
            expect(issue).toHaveProperty('path');
            expect(issue).toHaveProperty('severity');
            expect(['info', 'warn', 'error']).toContain(issue.severity);
          }
        }
      }).toThrow();
    });

    it('should include contextual details in validation issues', () => {
      const invalidTransaction = { ...validTransaction, movements: [] };

      expect(() => {
        const result = mockValidator.validate(invalidTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          for (const issue of validationResult.issues) {
            expect(typeof issue.code).toBe('string');
            expect(typeof issue.message).toBe('string');
            expect(typeof issue.field).toBe('string');
            if (issue.message) {
              expect(typeof issue.message).toBe('object');
            }
          }
        }
      }).toThrow();
    });
  });
});
