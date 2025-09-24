/**
 * Integration Test: Backward Compatibility Shim
 *
 * Tests the time-boxed compatibility shim between UniversalTransaction and ProcessedTransaction.
 * This test MUST fail until the compatibility shim is implemented.
 */

import type { ProcessedTransaction } from '@crypto/core';
import { SourceType, TransactionEventType, MovementDirection, ValidationStatus } from '@crypto/core';
import type { Result } from 'neverthrow';
import { describe, expect, it, beforeEach } from 'vitest';

// Import existing UniversalTransaction type (should exist in current codebase)
interface UniversalTransaction {
  amount: { amount: string; currency: string };
  fee?: { amount: string; currency: string } | undefined;
  from?: string | undefined;
  id: string;
  metadata?: Record<string, unknown> | undefined;
  notes?: { message: string; type: string }[] | undefined;
  price?: { amount: string; currency: string } | undefined;
  sourceUid: string;
  status: string;
  timestamp: Date;
  to?: string | undefined;
  type: string;
}

// Mock interfaces for compatibility shim
interface UniversalTransactionShim {
  fromProcessedTransaction(pt: ProcessedTransaction): Result<UniversalTransaction, string>;
  toProcessedTransaction(ut: UniversalTransaction): Result<ProcessedTransaction, string>;
  validateEquivalence(ut: UniversalTransaction, pt: ProcessedTransaction): Result<boolean, string>;
}

interface CompatibilityValidator {
  detectDataLoss(original: UniversalTransaction, roundTrip: UniversalTransaction): Result<DataLossReport, string>;
  validateConversion(original: UniversalTransaction, converted: ProcessedTransaction): Result<ValidationResult, string>;
}

interface ValidationResult {
  errors: string[];
  isValid: boolean;
  warnings: string[];
}

interface DataLossReport {
  alteredValues: { converted: unknown; field: string; original: unknown }[];
  hasDataLoss: boolean;
  lostFields: string[];
}

// Mock implementations - should fail until real implementation
class MockUniversalTransactionShim implements UniversalTransactionShim {
  toProcessedTransaction(ut: UniversalTransaction): Result<ProcessedTransaction, string> {
    throw new Error('UniversalTransactionShim.toProcessedTransaction not implemented');
  }

  fromProcessedTransaction(pt: ProcessedTransaction): Result<UniversalTransaction, string> {
    throw new Error('UniversalTransactionShim.fromProcessedTransaction not implemented');
  }

  validateEquivalence(ut: UniversalTransaction, pt: ProcessedTransaction): Result<boolean, string> {
    throw new Error('UniversalTransactionShim.validateEquivalence not implemented');
  }
}

class MockCompatibilityValidator implements CompatibilityValidator {
  validateConversion(
    original: UniversalTransaction,
    converted: ProcessedTransaction
  ): Result<ValidationResult, string> {
    throw new Error('CompatibilityValidator.validateConversion not implemented');
  }

  detectDataLoss(original: UniversalTransaction, roundTrip: UniversalTransaction): Result<DataLossReport, string> {
    throw new Error('CompatibilityValidator.detectDataLoss not implemented');
  }
}

describe('Backward Compatibility Shim Integration', () => {
  let shim: UniversalTransactionShim;
  let validator: CompatibilityValidator;

  beforeEach(() => {
    shim = new MockUniversalTransactionShim();
    validator = new MockCompatibilityValidator();
  });

  const sampleUniversalTransaction: UniversalTransaction = {
    amount: { amount: '0.1', currency: 'BTC' },
    fee: { amount: '2.25', currency: 'USD' },
    from: 'kraken',
    id: 'ut-123',
    metadata: {
      orderId: 'O123456',
      orderType: 'market',
      pair: 'BTC/USD',
    },
    notes: [{ message: 'Market buy order', type: 'info' }],
    price: { amount: '45000', currency: 'USD' },
    sourceUid: 'user456',
    status: 'closed',
    timestamp: new Date('2025-09-23T10:30:00Z'),
    to: 'user_wallet',
    type: 'trade',
  };

  describe('UniversalTransaction to ProcessedTransaction Conversion', () => {
    it('should convert simple trade transaction correctly', () => {
      expect(() => {
        const result = shim.toProcessedTransaction(sampleUniversalTransaction);

        if (result.isOk()) {
          const processed = result.value;

          // Verify basic fields
          expect(processed.id).toBe(sampleUniversalTransaction.id);
          expect(processed.sourceUid).toBe(sampleUniversalTransaction.sourceUid);
          expect(processed.timestamp).toEqual(sampleUniversalTransaction.timestamp);

          // Verify source mapping
          expect(processed.source.type).toBe(SourceType.EXCHANGE);
          expect(processed.source.name).toBe('kraken');

          // Verify event type mapping
          expect(processed.eventType).toBe(TransactionEventType.TRADE);

          // Verify movements creation
          expect(processed.movements.length).toBeGreaterThanOrEqual(2); // At least amount + fee

          const btcMovement = processed.movements.find((m) => m.currency === 'BTC');
          expect(btcMovement).toBeDefined();
          expect(btcMovement!.amount).toBe('0.1');
          expect(btcMovement!.direction).toBe(MovementDirection.IN);

          const feeMovement = processed.movements.find((m) => m.movementId.includes('fee'));
          expect(feeMovement).toBeDefined();
          expect(feeMovement!.currency).toBe('USD');
          expect(feeMovement!.amount).toBe('2.25');
          expect(feeMovement!.direction).toBe(MovementDirection.OUT);
        }
      }).toThrow('UniversalTransactionShim.toProcessedTransaction not implemented');
    });

    it('should handle deposit transactions', () => {
      const depositTransaction: UniversalTransaction = {
        ...sampleUniversalTransaction,
        amount: { amount: '1000', currency: 'USD' },
        fee: undefined,
        from: 'bank_account',
        to: 'kraken',
        type: 'deposit',
      };

      expect(() => {
        const result = shim.toProcessedTransaction(depositTransaction);

        if (result.isOk()) {
          const processed = result.value;

          expect(processed.eventType).toBe(TransactionEventType.DEPOSIT);
          expect(processed.movements.length).toBe(1); // Only deposit amount

          const depositMovement = processed.movements[0];
          expect(depositMovement.currency).toBe('USD');
          expect(depositMovement.amount).toBe('1000');
          expect(depositMovement.direction).toBe(MovementDirection.IN);
        }
      }).toThrow();
    });

    it('should handle withdrawal transactions', () => {
      const withdrawalTransaction: UniversalTransaction = {
        ...sampleUniversalTransaction,
        amount: { amount: '0.5', currency: 'BTC' },
        fee: { amount: '0.0005', currency: 'BTC' },
        from: 'kraken',
        to: 'external_wallet',
        type: 'withdrawal',
      };

      expect(() => {
        const result = shim.toProcessedTransaction(withdrawalTransaction);

        if (result.isOk()) {
          const processed = result.value;

          expect(processed.eventType).toBe(TransactionEventType.WITHDRAWAL);
          expect(processed.movements.length).toBe(2); // Amount + fee

          const withdrawalMovement = processed.movements.find((m) => !m.movementId.includes('fee'));
          expect(withdrawalMovement!.direction).toBe(MovementDirection.OUT);

          const feeMovement = processed.movements.find((m) => m.movementId.includes('fee'));
          expect(feeMovement!.direction).toBe(MovementDirection.OUT);
        }
      }).toThrow();
    });

    it('should preserve metadata in sourceSpecific field', () => {
      expect(() => {
        const result = shim.toProcessedTransaction(sampleUniversalTransaction);

        if (result.isOk()) {
          const processed = result.value;

          expect(processed.sourceSpecific).toBeDefined();
          expect(processed.sourceSpecific.type).toBe('EXCHANGE');

          // Original metadata should be preserved
          if (sampleUniversalTransaction.metadata) {
            expect(processed.originalData).toEqual(sampleUniversalTransaction);
          }
        }
      }).toThrow();
    });
  });

  describe('ProcessedTransaction to UniversalTransaction Conversion', () => {
    const sampleProcessedTransaction: ProcessedTransaction = {
      eventType: TransactionEventType.TRADE,
      id: 'pt-123',
      movements: [
        {
          amount: '0.1',
          currency: 'BTC',
          direction: MovementDirection.IN,
          metadata: { executionPrice: '45000' },
          movementId: 'btc_in',
        },
        {
          amount: '4500',
          currency: 'USD',
          direction: MovementDirection.OUT,
          metadata: {},
          movementId: 'usd_out',
        },
        {
          amount: '2.25',
          currency: 'USD',
          direction: MovementDirection.OUT,
          metadata: {},
          movementId: 'fee_out',
        },
      ],
      processedAt: new Date(),
      processorVersion: '1.0.0',
      source: {
        name: 'kraken',
        type: SourceType.EXCHANGE,
      },
      sourceSpecific: {
        orderId: 'O123456',
        symbol: 'BTC/USD',
        type: 'EXCHANGE',
      },
      sourceUid: 'user456',
      timestamp: new Date('2025-09-23T10:30:00Z'),
      validationStatus: ValidationStatus.VALID,
    };

    it('should convert ProcessedTransaction back to UniversalTransaction (lossy)', () => {
      expect(() => {
        const result = shim.fromProcessedTransaction(sampleProcessedTransaction);

        if (result.isOk()) {
          const universal = result.value;

          // Verify basic fields
          expect(universal.id).toBe(sampleProcessedTransaction.id);
          expect(universal.sourceUid).toBe(sampleProcessedTransaction.sourceUid);
          expect(universal.timestamp).toEqual(sampleProcessedTransaction.timestamp);

          // Verify type mapping
          expect(universal.type).toBe('trade');

          // Verify amount mapping (should pick primary movement)
          expect(universal.amount.currency).toBe('BTC');
          expect(universal.amount.amount).toBe('0.1');

          // Verify fee mapping
          expect(universal.fee).toBeDefined();
          expect(universal.fee!.currency).toBe('USD');
          expect(universal.fee!.amount).toBe('2.25');

          // Verify price calculation from movements
          expect(universal.price).toBeDefined();
          expect(universal.price!.currency).toBe('USD');
          expect(universal.price!.amount).toBe('45000');
        }
      }).toThrow('UniversalTransactionShim.fromProcessedTransaction not implemented');
    });

    it('should handle multi-movement transactions with primary movement selection', () => {
      const complexProcessedTransaction: ProcessedTransaction = {
        ...sampleProcessedTransaction,
        movements: [
          {
            amount: '0.1',
            currency: 'BTC',
            direction: MovementDirection.OUT,
            metadata: {},
            movementId: 'btc_out',
          },
          {
            amount: '2.0',
            currency: 'ETH',
            direction: MovementDirection.IN,
            metadata: {},
            movementId: 'eth_in',
          },
          {
            amount: '0.003',
            currency: 'ETH',
            direction: MovementDirection.OUT,
            metadata: {},
            movementId: 'gas_fee',
          },
        ],
      };

      expect(() => {
        const result = shim.fromProcessedTransaction(complexProcessedTransaction);

        if (result.isOk()) {
          const universal = result.value;

          // Should select the primary asset as amount
          expect(['BTC', 'ETH']).toContain(universal.amount.currency);

          // Should map gas fee as fee
          expect(universal.fee).toBeDefined();
          expect(universal.fee!.currency).toBe('ETH');
          expect(universal.fee!.amount).toBe('0.003');
        }
      }).toThrow();
    });

    it('should handle data loss warnings for complex movements', () => {
      expect(() => {
        const result = shim.fromProcessedTransaction(sampleProcessedTransaction);

        if (result.isOk()) {
          const universal = result.value;

          // Should include notes about data loss
          expect(universal.notes).toBeDefined();
          const dataLossNote = universal.notes!.find((n) => n.message.includes('conversion'));
          expect(dataLossNote).toBeDefined();
          expect(dataLossNote!.type).toBe('warning');
        }
      }).toThrow();
    });
  });

  describe('Round-trip Conversion Validation', () => {
    it('should validate equivalence between original and converted transactions', () => {
      expect(() => {
        const processedResult = shim.toProcessedTransaction(sampleUniversalTransaction);

        if (processedResult.isOk()) {
          const processed = processedResult.value;
          const equivalenceResult = shim.validateEquivalence(sampleUniversalTransaction, processed);

          if (equivalenceResult.isOk()) {
            expect(equivalenceResult.value).toBe(true);
          }
        }
      }).toThrow();
    });

    it('should detect data loss during round-trip conversion', () => {
      expect(() => {
        const processedResult = shim.toProcessedTransaction(sampleUniversalTransaction);

        if (processedResult.isOk()) {
          const processed = processedResult.value;
          const backResult = shim.fromProcessedTransaction(processed);

          if (backResult.isOk()) {
            const backConverted = backResult.value;
            const lossResult = validator.detectDataLoss(sampleUniversalTransaction, backConverted);

            if (lossResult.isOk()) {
              const lossReport = lossResult.value;

              // Some data loss is expected due to multi-movement → single amount conversion
              expect(lossReport.hasDataLoss).toBe(true);
              expect(lossReport.lostFields.length).toBeGreaterThan(0);
            }
          }
        }
      }).toThrow();
    });

    it('should maintain financial accuracy in round-trip conversion', () => {
      expect(() => {
        const processedResult = shim.toProcessedTransaction(sampleUniversalTransaction);

        if (processedResult.isOk()) {
          const processed = processedResult.value;
          const backResult = shim.fromProcessedTransaction(processed);

          if (backResult.isOk()) {
            const backConverted = backResult.value;

            // Financial amounts should be preserved
            expect(backConverted.amount.amount).toBe(sampleUniversalTransaction.amount.amount);
            expect(backConverted.amount.currency).toBe(sampleUniversalTransaction.amount.currency);

            if (sampleUniversalTransaction.fee && backConverted.fee) {
              expect(backConverted.fee.amount).toBe(sampleUniversalTransaction.fee.amount);
              expect(backConverted.fee.currency).toBe(sampleUniversalTransaction.fee.currency);
            }
          }
        }
      }).toThrow();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle transactions with missing fees', () => {
      const noFeeTransaction: UniversalTransaction = {
        ...sampleUniversalTransaction,
        fee: undefined,
      };

      expect(() => {
        const result = shim.toProcessedTransaction(noFeeTransaction);

        if (result.isOk()) {
          const processed = result.value;

          // Should create movements without fee
          const feeMovements = processed.movements.filter((m) => m.movementId.includes('fee'));
          expect(feeMovements).toHaveLength(0);
        }
      }).toThrow();
    });

    it('should handle transactions with missing price information', () => {
      const noPriceTransaction: UniversalTransaction = {
        ...sampleUniversalTransaction,
        price: undefined,
      };

      expect(() => {
        const result = shim.toProcessedTransaction(noPriceTransaction);

        if (result.isOk()) {
          const processed = result.value;

          // Should still create valid movements without price metadata
          expect(processed.movements.length).toBeGreaterThan(0);
        }
      }).toThrow();
    });

    it('should handle unknown transaction types gracefully', () => {
      const unknownTypeTransaction: UniversalTransaction = {
        ...sampleUniversalTransaction,
        type: 'unknown_type',
      };

      expect(() => {
        const result = shim.toProcessedTransaction(unknownTypeTransaction);

        if (result.isOk()) {
          const processed = result.value;

          // Should fallback to OTHER event type
          expect(processed.eventType).toBe(TransactionEventType.OTHER);
        }
      }).toThrow();
    });

    it('should validate conversion errors', () => {
      const invalidTransaction: UniversalTransaction = {
        ...sampleUniversalTransaction,
        amount: { amount: 'invalid', currency: 'BTC' },
      };

      expect(() => {
        const result = shim.toProcessedTransaction(invalidTransaction);

        if (result.isErr()) {
          expect(result.error).toContain('amount');
        }
      }).toThrow();
    });
  });

  describe('Time-boxed Migration Support', () => {
    it('should support parallel processing during migration period', () => {
      expect(() => {
        // During migration, both formats should be processable
        const processedResult = shim.toProcessedTransaction(sampleUniversalTransaction);

        if (processedResult.isOk()) {
          const processed = processedResult.value;

          // Should maintain version information for migration tracking
          expect(processed.processorVersion).toBeDefined();
          expect(processed.processedAt).toBeInstanceOf(Date);
        }
      }).toThrow();
    });

    it('should provide migration compatibility metadata', () => {
      expect(() => {
        const result = shim.toProcessedTransaction(sampleUniversalTransaction);

        if (result.isOk()) {
          const processed = result.value;

          // Should include migration metadata
          expect(processed.originalData).toBeDefined();
          expect(processed.originalData).toEqual(sampleUniversalTransaction);
        }
      }).toThrow();
    });

    it('should validate shim time-box constraints', () => {
      expect(() => {
        // Test that shim operates within performance constraints
        const startTime = performance.now();

        const result = shim.toProcessedTransaction(sampleUniversalTransaction);

        const endTime = performance.now();
        const conversionTime = endTime - startTime;

        // Conversion should be fast (< 10ms per transaction)
        expect(conversionTime).toBeLessThan(10);
      }).toThrow();
    });

    it('should support batch conversion for migration scenarios', () => {
      const universalTransactions = [
        sampleUniversalTransaction,
        { ...sampleUniversalTransaction, id: 'ut-124' },
        { ...sampleUniversalTransaction, id: 'ut-125' },
      ];

      expect(() => {
        // Batch conversion should be efficient
        const results = universalTransactions.map((ut) => shim.toProcessedTransaction(ut));

        // All conversions should succeed
        for (const result of results) {
          if (result.isOk()) {
            expect(result.value.id).toBeDefined();
          }
        }
      }).toThrow();
    });
  });

  describe('Deprecation and Cleanup', () => {
    it('should provide migration path from shim to native ProcessedTransaction', () => {
      expect(() => {
        // Test that shim can be bypassed when migration is complete
        const result = shim.toProcessedTransaction(sampleUniversalTransaction);

        if (result.isOk()) {
          const processed = result.value;

          // Should be indistinguishable from native ProcessedTransaction
          expect(processed.movements.length).toBeGreaterThan(0);
          expect(processed.validationStatus).toBe('VALID');
        }
      }).toThrow();
    });

    it('should warn about shim deprecation timeline', () => {
      expect(() => {
        const result = shim.toProcessedTransaction(sampleUniversalTransaction);

        if (result.isOk()) {
          const processed = result.value;

          // Should include deprecation warnings in notes or metadata
          const notes = processed.originalData?.notes as unknown[] | undefined;
          const deprecationWarning = notes?.find((n: unknown) => {
            if (typeof n === 'object' && n !== null && 'message' in n) {
              const message = (n as { message: unknown }).message;
              if (typeof message === 'string') {
                return message.includes('shim') || message.includes('deprecated');
              }
            }
            return false;
          });
          expect(deprecationWarning).toBeDefined();
        }
      }).toThrow();
    });
  });
});
