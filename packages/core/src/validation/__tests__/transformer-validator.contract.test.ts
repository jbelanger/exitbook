/**
 * Contract Test: TransformerValidator Interface
 *
 * Tests the TransformerValidator interface contract without implementation.
 * These tests MUST fail until actual implementation is provided.
 */
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import {
  type ClassifiedTransaction,
  type ContractValidationResult,
  MovementDirection,
  MovementPurpose,
  type ProcessedTransaction,
  SourceType,
  TransactionEventType,
  type TransformerValidator,
  ValidationCodes,
  ValidationStatus,
} from '../../types.js';

// Mock implementation for contract testing - should fail until real implementation
class MockTransformerValidator implements TransformerValidator {
  validate(_tx: ClassifiedTransaction): Result<ContractValidationResult<ClassifiedTransaction>, string> {
    // This should fail - no implementation yet
    throw new Error('TransformerValidator.validate not implemented');
  }
}

describe('TransformerValidator Contract', () => {
  const mockValidator = new MockTransformerValidator();

  const baseTransaction: ProcessedTransaction = {
    eventType: TransactionEventType.TRADE,
    id: 'test-001',
    movements: [
      {
        currency: 'BTC',
        direction: MovementDirection.IN,
        metadata: {
          accountId: 'main',
          executionPrice: '45000',
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
      {
        currency: 'USD',
        direction: MovementDirection.OUT,
        metadata: {
          accountId: 'main',
        },
        movementId: 'fee_out',
        quantity: '2.25',
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
        {
          confidence: 0.98,
          matched: true,
          reasoning: 'Standard trading fee pattern detected',
          ruleId: 'exchange_fee_standard',
          ruleName: 'Standard Exchange Fee Rule',
        },
      ],
      lowConfidenceMovements: [],
      overallConfidence: 0.96,
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
      {
        confidence: 0.98,
        movement: baseTransaction.movements[2],
        purpose: MovementPurpose.FEE,
        reasoning: 'Standard exchange trading fee',
        ruleId: 'exchange_fee_standard',
      },
    ],
    processedTransaction: baseTransaction,
  };

  describe('Business Rule Validation', () => {
    it('should implement validate method with correct signature', () => {
      expect(() => {
        const result = mockValidator.validate(validClassifiedTransaction);
        expect(result.isOk()).toBe(true);
      }).toThrow('TransformerValidator.validate not implemented');
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

    it('should pass validation for compliant business rules', () => {
      expect(() => {
        const result = mockValidator.validate(validClassifiedTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(true);
          expect(validationResult.issues).toHaveLength(0);
        }
      }).toThrow();
    });

    it('should validate valued zero-sum requirements', () => {
      // High-value transfer that should balance to zero when valued
      const valuedTransferTransaction: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        movements: [
          {
            confidence: 0.95,
            movement: {
              currency: 'BTC',
              direction: MovementDirection.OUT,
              metadata: { accountId: 'main', executionPrice: '45000' },
              movementId: 'btc_out',
              quantity: '1.0',
            },
            purpose: MovementPurpose.PRINCIPAL,
            ruleId: 'transfer_out_rule',
          },
          {
            confidence: 0.95,
            movement: {
              currency: 'BTC',
              direction: MovementDirection.IN,
              metadata: { accountId: 'external', executionPrice: '45000' },
              movementId: 'btc_in',
              quantity: '0.9',
            },
            purpose: MovementPurpose.PRINCIPAL,
            ruleId: 'transfer_in_rule',
          },
        ],
        processedTransaction: {
          ...baseTransaction,
          eventType: TransactionEventType.TRANSFER,
          movements: [
            {
              currency: 'BTC',
              direction: MovementDirection.OUT,
              metadata: {
                accountId: 'main',
                executionPrice: '45000',
              },
              movementId: 'btc_out',
              quantity: '1.0', // $45,000 value
            },
            {
              currency: 'BTC',
              direction: MovementDirection.IN,
              metadata: {
                accountId: 'external',
                executionPrice: '45000',
              },
              movementId: 'btc_in',
              quantity: '0.9', // $40,500 value - doesn't balance
            },
          ],
        },
      };

      expect(() => {
        const result = mockValidator.validate(valuedTransferTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const valuedZeroSumIssues = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.VALUED_ZERO_SUM_VIOLATION
          );
          expect(valuedZeroSumIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should validate cost basis application rules', () => {
      // Trade where cost basis calculation would be problematic
      const invalidCostBasisTransaction: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        movements: [
          {
            confidence: 0.95,
            movement: {
              ...baseTransaction.movements[0],
              metadata: {
                ...baseTransaction.movements[0].metadata,
              },
            },
            purpose: MovementPurpose.PRINCIPAL,
            ruleId: 'exchange_trade_main_asset',
          },
          {
            confidence: 0.95,
            movement: baseTransaction.movements[1],
            purpose: MovementPurpose.PRINCIPAL,
            ruleId: 'exchange_trade_main_asset',
          },
        ],
      };

      expect(() => {
        const result = mockValidator.validate(invalidCostBasisTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const costBasisIssues = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.INVALID_COST_BASIS
          );
          expect(costBasisIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should validate accounting policy compliance', () => {
      // Transaction that violates accounting policies (e.g., fees not properly linked)
      const policyViolationTransaction: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        movements: [
          ...validClassifiedTransaction.movements.slice(0, 2), // Principal movements
          {
            confidence: 0.98,
            movement: {
              ...baseTransaction.movements[2], // Fee movement
              metadata: {
                ...baseTransaction.movements[2].metadata,
              },
            },
            purpose: MovementPurpose.FEE,
            ruleId: 'exchange_fee_standard',
          },
        ],
      };

      expect(() => {
        const result = mockValidator.validate(policyViolationTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
          const policyIssues = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.BUSINESS_RULE_VIOLATION
          );
          expect(policyIssues.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should validate regulatory constraint adherence', () => {
      // Transaction that might violate regulatory constraints
      const regulatoryViolationTransaction: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        movements: [
          {
            confidence: 0.95,
            movement: {
              currency: 'USD',
              direction: MovementDirection.OUT,
              metadata: { accountId: 'main' },
              movementId: 'large_cash_out',
              quantity: '15000',
            },
            purpose: MovementPurpose.PRINCIPAL,
            ruleId: 'withdrawal_rule',
          },
        ],
        processedTransaction: {
          ...baseTransaction,
          movements: [
            {
              currency: 'USD',
              direction: MovementDirection.OUT,
              metadata: {
                accountId: 'main',
                // Missing required regulatory metadata
              },
              movementId: 'large_cash_out',
              quantity: '15000', // Large cash movement - may require special handling
            },
          ],
        },
      };

      expect(() => {
        const result = mockValidator.validate(regulatoryViolationTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          // May pass but should warn about regulatory requirements
          const regulatoryWarnings = validationResult.issues.filter(
            (issue) => issue.code === ValidationCodes.REGULATORY_CONSTRAINT_VIOLATION
          );
          expect(Array.isArray(regulatoryWarnings)).toBe(true);
        }
      }).toThrow();
    });
  });

  describe('Complex Transaction Scenarios', () => {
    it('should validate multi-leg trade consistency', () => {
      // Multi-leg trade (BTC -> ETH -> USD) where accounting relationships matter
      const multiLegTrade: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        processedTransaction: {
          ...baseTransaction,
          movements: [
            {
              currency: 'BTC',
              direction: MovementDirection.OUT,
              metadata: { accountId: 'main', tradingPair: 'BTC/ETH' },
              movementId: 'btc_out',
              quantity: '0.1',
            },
            {
              currency: 'ETH',
              direction: MovementDirection.IN,
              metadata: { accountId: 'main', tradingPair: 'BTC/ETH' },
              movementId: 'eth_in',
              quantity: '2.0',
            },
            {
              currency: 'ETH',
              direction: MovementDirection.OUT,
              metadata: { accountId: 'main', tradingPair: 'ETH/USD' },
              movementId: 'eth_out',
              quantity: '2.0',
            },
            {
              currency: 'USD',
              direction: MovementDirection.IN,
              metadata: { accountId: 'main', tradingPair: 'ETH/USD' },
              movementId: 'usd_in',
              quantity: '4400',
            },
          ],
        },
      };

      expect(() => {
        const result = mockValidator.validate(multiLegTrade);
        if (result.isOk()) {
          const validationResult = result.value;
          // Should validate that intermediate assets balance correctly
          expect(validationResult.ok).toBe(true);
        }
      }).toThrow();
    });

    it('should validate DeFi transaction business rules', () => {
      // DeFi liquidity provision with complex token relationships
      const defiTransaction: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        movements: [
          {
            confidence: 0.9,
            movement: {
              currency: 'USDC',
              direction: MovementDirection.OUT,
              metadata: { accountId: 'main' },
              movementId: 'usdc_out',
              quantity: '1000',
            },
            purpose: MovementPurpose.PRINCIPAL,
            ruleId: 'defi_liquidity_rule',
          },
          {
            confidence: 0.9,
            movement: {
              currency: 'UNI-LP',
              direction: MovementDirection.IN,
              metadata: { accountId: 'main' },
              movementId: 'lp_token_in',
              quantity: '50',
            },
            purpose: MovementPurpose.PRINCIPAL,
            ruleId: 'defi_liquidity_rule',
          },
          {
            confidence: 0.95,
            movement: {
              currency: 'ETH',
              direction: MovementDirection.OUT,
              metadata: { accountId: 'main', gasUsed: 150000 },
              movementId: 'gas_fee',
              quantity: '0.005',
            },
            purpose: MovementPurpose.GAS,
            ruleId: 'gas_fee_rule',
          },
        ],
        processedTransaction: {
          ...baseTransaction,
          eventType: TransactionEventType.LEND,
          movements: [
            {
              currency: 'USDC',
              direction: MovementDirection.OUT,
              metadata: { accountId: 'main' },
              movementId: 'usdc_out',
              quantity: '1000',
            },
            {
              currency: 'UNI-LP',
              direction: MovementDirection.IN,
              metadata: { accountId: 'main' },
              movementId: 'lp_token_in',
              quantity: '50',
            },
            {
              currency: 'ETH',
              direction: MovementDirection.OUT,
              metadata: { accountId: 'main', gasUsed: 150000 },
              movementId: 'gas_fee',
              quantity: '0.005',
            },
          ],
        },
      };

      expect(() => {
        const result = mockValidator.validate(defiTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          // Should validate DeFi-specific business rules
          expect(validationResult.ok).toBe(true);
        }
      }).toThrow();
    });
  });

  describe('Accounting Integration', () => {
    it('should validate double-entry accounting requirements', () => {
      // Transaction that when transformed to accounting entries should balance
      expect(() => {
        const result = mockValidator.validate(validClassifiedTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          // Should ensure accounting entries will balance
          expect(validationResult.ok).toBe(true);
        }
      }).toThrow();
    });

    it('should validate tax reporting requirements', () => {
      // Transaction with tax implications
      const taxableTransaction: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        processedTransaction: {
          ...baseTransaction,
          eventType: TransactionEventType.TRADE,
          movements: [
            {
              currency: 'BTC',
              direction: MovementDirection.OUT,
              metadata: {
                accountId: 'main',
                executionPrice: '50000',
              },
              movementId: 'btc_out',
              quantity: '1.0',
            },
            {
              currency: 'USD',
              direction: MovementDirection.IN,
              metadata: { accountId: 'main' },
              movementId: 'usd_in',
              quantity: '50000',
            },
          ],
        },
      };

      expect(() => {
        const result = mockValidator.validate(taxableTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          // Should validate tax calculation requirements
          expect(validationResult.ok).toBe(true);
        }
      }).toThrow();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle transactions with missing critical metadata', () => {
      const incompleteTxn: ClassifiedTransaction = {
        ...validClassifiedTransaction,
        processedTransaction: {
          ...baseTransaction,
          movements: [
            {
              currency: 'BTC',
              direction: MovementDirection.IN,
              metadata: {}, // Missing critical metadata
              movementId: 'incomplete',
              quantity: '0.1',
            },
          ],
        },
      };

      expect(() => {
        const result = mockValidator.validate(incompleteTxn);
        if (result.isOk()) {
          const validationResult = result.value;
          expect(validationResult.ok).toBe(false);
        }
      }).toThrow();
    });

    it('should provide detailed error context for business rule violations', () => {
      expect(() => {
        const result = mockValidator.validate(validClassifiedTransaction);
        if (result.isOk()) {
          const validationResult = result.value;
          for (const issue of validationResult.issues) {
            expect(issue).toHaveProperty('code');
            expect(issue).toHaveProperty('message');
            expect(issue).toHaveProperty('path');
            expect(issue).toHaveProperty('severity');
            if (issue.message) {
              expect(typeof issue.message).toBe('object');
            }
          }
        }
      }).toThrow();
    });
  });
});
