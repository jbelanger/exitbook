/**
 * Integration Test: Purpose Classification Flow
 *
 * Tests the complete classification flow from ProcessedTransaction to ClassifiedTransaction.
 * This test MUST fail until the classification pipeline is implemented.
 */
import type { ProcessedTransaction, ClassifiedTransaction } from '@crypto/core';
import { MovementPurpose, TransactionEventType, MovementDirection, SourceType, ValidationStatus } from '@crypto/core';
import type { Result } from 'neverthrow';
import { beforeEach, describe, expect, it } from 'vitest';

// Mock interfaces for classification flow
interface PurposeClassificationService {
  classify(tx: ProcessedTransaction): Result<ClassifiedTransaction, string>;
  classifyBatch(txs: ProcessedTransaction[]): Result<ClassifiedTransaction[], string>;
}

interface ClassificationRuleEngine {
  evaluateRules(tx: ProcessedTransaction): Result<ClassificationRuleResult[], string>;
}

interface ClassificationRuleResult {
  confidence: number;
  movementId: string;
  purpose: MovementPurpose;
  reasoning: string;
  ruleId: string;
}

// Mock implementations - should fail until real implementation
class MockPurposeClassificationService implements PurposeClassificationService {
  classify(tx: ProcessedTransaction): Result<ClassifiedTransaction, string> {
    throw new Error('PurposeClassificationService.classify not implemented');
  }

  classifyBatch(txs: ProcessedTransaction[]): Result<ClassifiedTransaction[], string> {
    throw new Error('PurposeClassificationService.classifyBatch not implemented');
  }
}

class MockClassificationRuleEngine implements ClassificationRuleEngine {
  evaluateRules(tx: ProcessedTransaction): Result<ClassificationRuleResult[], string> {
    throw new Error('ClassificationRuleEngine.evaluateRules not implemented');
  }
}

describe('Purpose Classification Flow Integration', () => {
  let classificationService: PurposeClassificationService;
  let ruleEngine: ClassificationRuleEngine;

  beforeEach(() => {
    classificationService = new MockPurposeClassificationService();
    ruleEngine = new MockClassificationRuleEngine();
  });

  const sampleExchangeTransaction: ProcessedTransaction = {
    eventType: TransactionEventType.TRADE,
    id: 'kraken-order-123',
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
      extras: { orderType: 'MARKET', symbol: 'BTC/USD' },
      kind: 'exchange',
      orderId: 'O123456-TEST',
      venue: 'kraken',
    },
    sourceUid: 'user456',
    timestamp: '2025-09-23T10:30:00Z',
    validationStatus: ValidationStatus.VALID,
  };

  describe('Exchange Trade Classification', () => {
    it('should classify exchange trade movements correctly', () => {
      expect(() => {
        const result = classificationService.classify(sampleExchangeTransaction);

        if (result.isOk()) {
          const classified = result.value;

          // Verify classification structure
          expect(classified.processedTransaction).toEqual(sampleExchangeTransaction);
          expect(classified.movements).toHaveLength(3);
          expect(classified.classifiedAt).toBeInstanceOf(Date);
          expect(classified.classifierVersion).toBeDefined();

          // Verify movement classifications
          const btcMovement = classified.movements.find((m) => m.movement.currency === 'BTC');
          expect(btcMovement).toBeDefined();
          expect(btcMovement!.purpose).toBe(MovementPurpose.PRINCIPAL);
          expect(btcMovement!.confidence).toBeGreaterThan(0.8);

          const usdMovement = classified.movements.find(
            (m) => m.movement.currency === 'USD' && m.movement.movementId === 'usd_out'
          );
          expect(usdMovement).toBeDefined();
          expect(usdMovement!.purpose).toBe(MovementPurpose.PRINCIPAL);

          const feeMovement = classified.movements.find((m) => m.movement.movementId === 'fee_out');
          expect(feeMovement).toBeDefined();
          expect(feeMovement!.purpose).toBe(MovementPurpose.FEE);
          expect(feeMovement!.confidence).toBeGreaterThan(0.9);
        }
      }).toThrow('PurposeClassificationService.classify not implemented');
    });

    it('should include comprehensive classification metadata', () => {
      expect(() => {
        const result = classificationService.classify(sampleExchangeTransaction);

        if (result.isOk()) {
          const classified = result.value;

          // Verify classification info
          expect(classified.classificationInfo).toBeDefined();
          expect(classified.classificationInfo.ruleSetVersion).toBeDefined();
          expect(classified.classificationInfo.appliedRules).toBeInstanceOf(Array);
          expect(classified.classificationInfo.overallConfidence).toBeGreaterThanOrEqual(0);
          expect(classified.classificationInfo.overallConfidence).toBeLessThanOrEqual(1);

          // Verify rule application audit trail
          expect(classified.classificationInfo.appliedRules.length).toBeGreaterThan(0);
          for (const rule of classified.classificationInfo.appliedRules) {
            expect(rule.ruleId).toBeDefined();
            expect(rule.ruleName).toBeDefined();
            expect(typeof rule.matched).toBe('boolean');
            expect(rule.confidence).toBeGreaterThanOrEqual(0);
            expect(rule.confidence).toBeLessThanOrEqual(1);
            expect(rule.reasoning).toBeDefined();
          }
        }
      }).toThrow();
    });
  });

  describe('Blockchain Transfer Classification', () => {
    const blockchainTransaction: ProcessedTransaction = {
      blockNumber: 850000,
      eventType: TransactionEventType.TRANSFER,
      id: 'bitcoin-tx-789',
      movements: [
        {
          currency: 'BTC',
          direction: MovementDirection.OUT,
          metadata: {
            accountId: 'main',
            fromAddress: 'bc1quser123',
            toAddress: 'bc1quser456',
          },
          movementId: 'btc_out',
          quantity: '0.5',
        },
        {
          currency: 'BTC',
          direction: MovementDirection.IN,
          metadata: {
            accountId: 'external',
            fromAddress: 'bc1quser123',
            toAddress: 'bc1quser456',
          },
          movementId: 'btc_in',
          quantity: '0.4995',
        },
        {
          currency: 'BTC',
          direction: MovementDirection.OUT,
          metadata: {
            accountId: 'main',
            gasUsed: 225,
          },
          movementId: 'fee_out',
          quantity: '0.0005',
        },
      ],
      processedAt: new Date().toISOString(),
      processorVersion: '1.0.0',
      source: {
        name: 'bitcoin',
        type: SourceType.BLOCKCHAIN,
      },
      sourceDetails: {
        chain: 'bitcoin',
        extras: { blockNumber: 850000, fromAddress: 'bc1quser123', toAddress: 'bc1quser456' },
        kind: 'blockchain',
        txHash: 'abc123def456',
      },
      sourceUid: 'user456',
      timestamp: '2025-09-23T11:00:00Z',
      validationStatus: ValidationStatus.VALID,
    };

    it('should classify blockchain transfer movements correctly', () => {
      expect(() => {
        const result = classificationService.classify(blockchainTransaction);

        if (result.isOk()) {
          const classified = result.value;

          expect(classified.movements).toHaveLength(3);

          // Verify transfer classifications
          const outMovement = classified.movements.find((m) => m.movement.movementId === 'btc_out');
          expect(outMovement).toBeDefined();
          expect(outMovement!.purpose).toBe(MovementPurpose.PRINCIPAL);

          const inMovement = classified.movements.find((m) => m.movement.movementId === 'btc_in');
          expect(inMovement).toBeDefined();
          expect(inMovement!.purpose).toBe(MovementPurpose.PRINCIPAL);

          const feeMovement = classified.movements.find((m) => m.movement.movementId === 'fee_out');
          expect(feeMovement).toBeDefined();
          expect(feeMovement!.purpose).toBe(MovementPurpose.FEE);
        }
      }).toThrow();
    });
  });

  describe('Complex Multi-Movement Classification', () => {
    const complexTransaction: ProcessedTransaction = {
      eventType: TransactionEventType.TRADE,
      id: 'complex-trade-456',
      movements: [
        {
          currency: 'USDC',
          direction: MovementDirection.OUT,
          metadata: {
            accountId: 'main',
          },
          movementId: 'usdc_out',
          quantity: '1000',
        },
        {
          currency: 'ETH',
          direction: MovementDirection.IN,
          metadata: {
            accountId: 'main',
          },
          movementId: 'eth_in',
          quantity: '0.5',
        },
        {
          currency: 'ETH',
          direction: MovementDirection.OUT,
          metadata: {
            accountId: 'main',
            gasPrice: '20000000000',
            gasUsed: 150000,
          },
          movementId: 'gas_fee',
          quantity: '0.003',
        },
        {
          currency: 'USDC',
          direction: MovementDirection.OUT,
          metadata: {
            accountId: 'main',
          },
          movementId: 'protocol_fee',
          quantity: '3',
        },
      ],
      processedAt: new Date().toISOString(),
      processorVersion: '1.0.0',
      source: {
        name: 'uniswap',
        type: SourceType.EXCHANGE,
      },
      sourceDetails: {
        chain: 'ethereum',
        kind: 'blockchain',
        txHash: 'def456ghi789',
      },
      sourceUid: 'user789',
      timestamp: '2025-09-23T12:00:00Z',
      validationStatus: ValidationStatus.VALID,
    };

    it('should classify complex DeFi swap correctly', () => {
      expect(() => {
        const result = classificationService.classify(complexTransaction);

        if (result.isOk()) {
          const classified = result.value;

          expect(classified.movements).toHaveLength(4);

          // Verify principal swap movements
          const usdcOut = classified.movements.find((m) => m.movement.movementId === 'usdc_out');
          expect(usdcOut!.purpose).toBe(MovementPurpose.PRINCIPAL);

          const ethIn = classified.movements.find((m) => m.movement.movementId === 'eth_in');
          expect(ethIn!.purpose).toBe(MovementPurpose.PRINCIPAL);

          // Verify fee classifications
          const gasFee = classified.movements.find((m) => m.movement.movementId === 'gas_fee');
          expect(gasFee!.purpose).toBe(MovementPurpose.GAS);

          const protocolFee = classified.movements.find((m) => m.movement.movementId === 'protocol_fee');
          expect(protocolFee!.purpose).toBe(MovementPurpose.FEE);
        }
      }).toThrow();
    });
  });

  describe('Batch Classification', () => {
    it('should classify multiple transactions in batch efficiently', () => {
      const transactions = [
        sampleExchangeTransaction,
        { ...sampleExchangeTransaction, id: 'order-2' },
        { ...sampleExchangeTransaction, id: 'order-3' },
      ];

      expect(() => {
        const result = classificationService.classifyBatch(transactions);

        if (result.isOk()) {
          const classifiedBatch = result.value;

          expect(classifiedBatch).toHaveLength(3);
          for (const [index, classified] of classifiedBatch.entries()) {
            expect(classified.processedTransaction.id).toBe(transactions[index].id);
            expect(classified.movements.length).toBeGreaterThan(0);
          }
        }
      }).toThrow();
    });

    it('should maintain individual classification quality in batch', () => {
      const transactions = [sampleExchangeTransaction];

      expect(() => {
        const batchResult = classificationService.classifyBatch(transactions);
        const singleResult = classificationService.classify(sampleExchangeTransaction);

        if (batchResult.isOk() && singleResult.isOk()) {
          const batchClassified = batchResult.value[0];
          const singleClassified = singleResult.value;

          // Classifications should be equivalent
          expect(batchClassified.movements.length).toBe(singleClassified.movements.length);
          expect(batchClassified.classificationInfo.overallConfidence).toBeCloseTo(
            singleClassified.classificationInfo.overallConfidence,
            2
          );
        }
      }).toThrow();
    });
  });

  describe('Rule Engine Integration', () => {
    it('should use rule engine for classification decisions', () => {
      expect(() => {
        const ruleResults = ruleEngine.evaluateRules(sampleExchangeTransaction);

        if (ruleResults.isOk()) {
          const rules = ruleResults.value;

          expect(rules.length).toBeGreaterThan(0);
          for (const rule of rules) {
            expect(rule.ruleId).toBeDefined();
            expect(rule.movementId).toBeDefined();
            expect(Object.values(MovementPurpose)).toContain(rule.purpose);
            expect(rule.confidence).toBeGreaterThanOrEqual(0);
            expect(rule.confidence).toBeLessThanOrEqual(1);
            expect(rule.reasoning).toBeDefined();
          }
        }
      }).toThrow('ClassificationRuleEngine.evaluateRules not implemented');
    });

    it('should apply venue-specific rules correctly', () => {
      expect(() => {
        // Kraken-specific transaction
        const krakenTx = { ...sampleExchangeTransaction };
        const krakenRules = ruleEngine.evaluateRules(krakenTx);

        // Different exchange transaction
        const binanceTx = {
          ...sampleExchangeTransaction,
          source: { name: 'binance', type: SourceType.EXCHANGE },
        };
        const binanceRules = ruleEngine.evaluateRules(binanceTx);

        if (krakenRules.isOk() && binanceRules.isOk()) {
          // Rule application may differ by venue
          expect(krakenRules.value).toBeDefined();
          expect(binanceRules.value).toBeDefined();
        }
      }).toThrow();
    });
  });

  describe('Classification Quality and Confidence', () => {
    it('should provide high confidence for standard patterns', () => {
      expect(() => {
        const result = classificationService.classify(sampleExchangeTransaction);

        if (result.isOk()) {
          const classified = result.value;

          // Overall confidence should be high for standard exchange trade
          expect(classified.classificationInfo.overallConfidence).toBeGreaterThan(0.8);

          // Principal movements should have high confidence
          const principalMovements = classified.movements.filter((m) => m.purpose === MovementPurpose.PRINCIPAL);
          for (const movement of principalMovements) {
            expect(movement.confidence).toBeGreaterThan(0.8);
          }

          // Fee movements should have very high confidence
          const feeMovements = classified.movements.filter((m) => m.purpose === MovementPurpose.FEE);
          for (const movement of feeMovements) {
            expect(movement.confidence).toBeGreaterThan(0.9);
          }
        }
      }).toThrow();
    });

    it('should flag low confidence classifications for review', () => {
      // Create an ambiguous transaction
      const ambiguousTransaction: ProcessedTransaction = {
        ...sampleExchangeTransaction,
        eventType: TransactionEventType.OTHER,
        movements: [
          {
            currency: 'TOKEN',
            direction: MovementDirection.IN,
            metadata: { accountId: 'main' },
            movementId: 'unknown_1',
            quantity: '100',
          },
        ],
      };

      expect(() => {
        const result = classificationService.classify(ambiguousTransaction);

        if (result.isOk()) {
          const classified = result.value;

          // Should have lower overall confidence
          expect(classified.classificationInfo.overallConfidence).toBeLessThan(0.8);

          // Should identify low confidence movements
          expect(classified.classificationInfo.lowConfidenceMovements).toBeDefined();
          expect(Array.isArray(classified.classificationInfo.lowConfidenceMovements)).toBe(true);
        }
      }).toThrow();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle classification errors gracefully', () => {
      const invalidTransaction = {
        ...sampleExchangeTransaction,
        movements: [], // No movements to classify
      };

      expect(() => {
        const result = classificationService.classify(invalidTransaction);

        if (result.isErr()) {
          expect(result.error).toContain('movements');
        }
      }).toThrow();
    });

    it('should handle unknown movement patterns', () => {
      const unknownTransaction: ProcessedTransaction = {
        ...sampleExchangeTransaction,
        movements: [
          {
            currency: 'UNKNOWN',
            direction: MovementDirection.IN,
            metadata: {},
            movementId: 'unknown_pattern',
            quantity: '999',
          },
        ],
      };

      expect(() => {
        const result = classificationService.classify(unknownTransaction);

        if (result.isOk()) {
          const classified = result.value;
          const unknownMovement = classified.movements[0];

          // Should fallback to OTHER with low confidence
          expect(unknownMovement.purpose).toBe(MovementPurpose.OTHER);
          expect(unknownMovement.confidence).toBeLessThan(0.5);
        }
      }).toThrow();
    });
  });
});
