import { parseDecimal } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import {
  AssetMovementDraftSchema,
  FeeMovementDraftSchema,
  AssetMovementSchema,
  FeeMovementSchema,
} from '../movement.js';
import { TransactionSchema } from '../transaction.js';

describe('AssetMovementDraftSchema', () => {
  describe('assetId validation', () => {
    it('accepts valid blockchain native assetId', () => {
      const movement = {
        assetId: 'blockchain:ethereum:native',
        assetSymbol: 'ETH',
        grossAmount: parseDecimal('1.5'),
      };
      const result = AssetMovementDraftSchema.safeParse(movement);
      expect(result.success).toBe(true);
    });

    it('accepts valid blockchain token assetId', () => {
      const movement = {
        assetId: 'blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        assetSymbol: 'USDC',
        grossAmount: parseDecimal('100'),
      };
      const result = AssetMovementDraftSchema.safeParse(movement);
      expect(result.success).toBe(true);
    });

    it('accepts valid exchange assetId', () => {
      const movement = {
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC',
        grossAmount: parseDecimal('0.5'),
      };
      const result = AssetMovementDraftSchema.safeParse(movement);
      expect(result.success).toBe(true);
    });

    it('accepts valid fiat assetId', () => {
      const movement = {
        assetId: 'fiat:usd',
        assetSymbol: 'USD',
        grossAmount: parseDecimal('1000'),
      };
      const result = AssetMovementDraftSchema.safeParse(movement);
      expect(result.success).toBe(true);
    });

    it('rejects blockchain assetId with unknown token reference', () => {
      const movement = {
        assetId: 'blockchain:ethereum:unknown:usdc',
        assetSymbol: 'USDC',
        grossAmount: parseDecimal('100'),
      };
      const result = AssetMovementDraftSchema.safeParse(movement);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('unknown token reference');
      }
    });

    it('rejects blockchain assetId with empty token reference', () => {
      const movement = {
        assetId: 'blockchain:ethereum:',
        assetSymbol: 'ETH',
        grossAmount: parseDecimal('1'),
      };
      const result = AssetMovementDraftSchema.safeParse(movement);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('Token reference');
      }
    });

    it('rejects blockchain assetId with missing components', () => {
      const movement = {
        assetId: 'blockchain:ethereum',
        assetSymbol: 'ETH',
        grossAmount: parseDecimal('1'),
      };
      const result = AssetMovementDraftSchema.safeParse(movement);
      expect(result.success).toBe(false);
    });
  });

  describe('netAmount validation', () => {
    it('accepts netAmount <= grossAmount', () => {
      const movement = {
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC',
        grossAmount: parseDecimal('1.0'),
        netAmount: parseDecimal('0.999'),
      };
      const result = AssetMovementDraftSchema.safeParse(movement);
      expect(result.success).toBe(true);
    });

    it('rejects netAmount > grossAmount', () => {
      const movement = {
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC',
        grossAmount: parseDecimal('1.0'),
        netAmount: parseDecimal('1.1'),
      };
      const result = AssetMovementDraftSchema.safeParse(movement);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('netAmount cannot exceed grossAmount');
      }
    });
  });
});

describe('FeeMovementDraftSchema', () => {
  describe('assetId validation', () => {
    it('accepts valid blockchain native assetId', () => {
      const fee = {
        assetId: 'blockchain:ethereum:native',
        assetSymbol: 'ETH',
        amount: parseDecimal('0.002'),
        scope: 'network' as const,
        settlement: 'balance' as const,
      };
      const result = FeeMovementDraftSchema.safeParse(fee);
      expect(result.success).toBe(true);
    });

    it('accepts valid blockchain token assetId', () => {
      const fee = {
        assetId: 'blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        assetSymbol: 'USDC',
        amount: parseDecimal('5'),
        scope: 'platform' as const,
        settlement: 'balance' as const,
      };
      const result = FeeMovementDraftSchema.safeParse(fee);
      expect(result.success).toBe(true);
    });

    it('rejects blockchain assetId with unknown token reference', () => {
      const fee = {
        assetId: 'blockchain:solana:unknown:usdc',
        assetSymbol: 'USDC',
        amount: parseDecimal('1'),
        scope: 'platform' as const,
        settlement: 'balance' as const,
      };
      const result = FeeMovementDraftSchema.safeParse(fee);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('unknown token reference');
      }
    });

    it('rejects blockchain assetId with empty token reference', () => {
      const fee = {
        assetId: 'blockchain:solana:',
        assetSymbol: 'SOL',
        amount: parseDecimal('0.001'),
        scope: 'network' as const,
        settlement: 'balance' as const,
      };
      const result = FeeMovementDraftSchema.safeParse(fee);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('Token reference');
      }
    });
  });
});

describe('Persisted movement schemas', () => {
  it('requires movementFingerprint for persisted asset movements', () => {
    const result = AssetMovementSchema.safeParse({
      assetId: 'blockchain:solana:native',
      assetSymbol: 'SOL',
      grossAmount: parseDecimal('1.0'),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const fingerprintIssue = result.error.issues.find((i) => i.path.includes('movementFingerprint'));
      expect(fingerprintIssue).toBeDefined();
    }
  });

  it('requires movementFingerprint for persisted fee movements', () => {
    const result = FeeMovementSchema.safeParse({
      assetId: 'blockchain:solana:native',
      assetSymbol: 'SOL',
      amount: parseDecimal('0.000005'),
      scope: 'network' as const,
      settlement: 'balance' as const,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const fingerprintIssue = result.error.issues.find((i) => i.path.includes('movementFingerprint'));
      expect(fingerprintIssue).toBeDefined();
    }
  });
});

describe('TransactionSchema', () => {
  describe('empty transaction validation', () => {
    it('rejects transaction with no movements and no fees', () => {
      const transaction = {
        id: 1,
        accountId: 1,
        txFingerprint: 'txfp-1',
        datetime: new Date().toISOString(),
        timestamp: Date.now(),
        platformKey: 'solana',
        platformKind: 'blockchain' as const,
        status: 'success' as const,
        movements: {
          inflows: [],
          outflows: [],
        },
        fees: [],
        operation: {
          category: 'fee' as const,
          type: 'fee' as const,
        },
      };

      const result = TransactionSchema.safeParse(transaction);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('at least one movement');
      }
    });

    it('accepts transaction with only inflows', () => {
      const transaction = {
        id: 1,
        accountId: 1,
        txFingerprint: 'txfp-2',
        datetime: new Date().toISOString(),
        timestamp: Date.now(),
        platformKey: 'solana',
        platformKind: 'blockchain' as const,
        status: 'success' as const,
        movements: {
          inflows: [
            {
              assetId: 'blockchain:solana:native',
              assetSymbol: 'SOL',
              movementFingerprint: 'movement:txfp-2:inflow:0',
              grossAmount: parseDecimal('1.0'),
            },
          ],
          outflows: [],
        },
        fees: [],
        operation: {
          category: 'transfer' as const,
          type: 'deposit' as const,
        },
      };

      const result = TransactionSchema.safeParse(transaction);
      expect(result.success).toBe(true);
    });

    it('accepts transaction with only outflows', () => {
      const transaction = {
        id: 1,
        accountId: 1,
        txFingerprint: 'txfp-3',
        datetime: new Date().toISOString(),
        timestamp: Date.now(),
        platformKey: 'solana',
        platformKind: 'blockchain' as const,
        status: 'success' as const,
        movements: {
          inflows: [],
          outflows: [
            {
              assetId: 'blockchain:solana:native',
              assetSymbol: 'SOL',
              movementFingerprint: 'movement:txfp-3:outflow:0',
              grossAmount: parseDecimal('0.5'),
            },
          ],
        },
        fees: [],
        operation: {
          category: 'transfer' as const,
          type: 'withdrawal' as const,
        },
      };

      const result = TransactionSchema.safeParse(transaction);
      expect(result.success).toBe(true);
    });

    it('accepts transaction with only fees (fee-only transaction)', () => {
      const transaction = {
        id: 1,
        accountId: 1,
        txFingerprint: 'txfp-4',
        datetime: new Date().toISOString(),
        timestamp: Date.now(),
        platformKey: 'solana',
        platformKind: 'blockchain' as const,
        status: 'success' as const,
        movements: {
          inflows: [],
          outflows: [],
        },
        fees: [
          {
            assetId: 'blockchain:solana:native',
            assetSymbol: 'SOL',
            movementFingerprint: 'movement:txfp-4:fee:0',
            amount: parseDecimal('0.000005'),
            scope: 'network' as const,
            settlement: 'balance' as const,
          },
        ],
        operation: {
          category: 'fee' as const,
          type: 'fee' as const,
        },
      };

      const result = TransactionSchema.safeParse(transaction);
      expect(result.success).toBe(true);
    });
  });
});
