import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { AssetMovementSchema, FeeMovementSchema } from '../universal-transaction.js';

describe('AssetMovementSchema', () => {
  describe('assetId validation', () => {
    it('accepts valid blockchain native assetId', () => {
      const movement = {
        assetId: 'blockchain:ethereum:native',
        assetSymbol: 'ETH',
        grossAmount: new Decimal('1.5'),
      };
      const result = AssetMovementSchema.safeParse(movement);
      expect(result.success).toBe(true);
    });

    it('accepts valid blockchain token assetId', () => {
      const movement = {
        assetId: 'blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        assetSymbol: 'USDC',
        grossAmount: new Decimal('100'),
      };
      const result = AssetMovementSchema.safeParse(movement);
      expect(result.success).toBe(true);
    });

    it('accepts valid exchange assetId', () => {
      const movement = {
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC',
        grossAmount: new Decimal('0.5'),
      };
      const result = AssetMovementSchema.safeParse(movement);
      expect(result.success).toBe(true);
    });

    it('accepts valid fiat assetId', () => {
      const movement = {
        assetId: 'fiat:usd',
        assetSymbol: 'USD',
        grossAmount: new Decimal('1000'),
      };
      const result = AssetMovementSchema.safeParse(movement);
      expect(result.success).toBe(true);
    });

    it('rejects blockchain assetId with unknown token reference', () => {
      const movement = {
        assetId: 'blockchain:ethereum:unknown:usdc',
        assetSymbol: 'USDC',
        grossAmount: new Decimal('100'),
      };
      const result = AssetMovementSchema.safeParse(movement);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('unknown token reference');
      }
    });

    it('rejects blockchain assetId with empty token reference', () => {
      const movement = {
        assetId: 'blockchain:ethereum:',
        assetSymbol: 'ETH',
        grossAmount: new Decimal('1'),
      };
      const result = AssetMovementSchema.safeParse(movement);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('Token reference');
      }
    });

    it('rejects blockchain assetId with missing components', () => {
      const movement = {
        assetId: 'blockchain:ethereum',
        assetSymbol: 'ETH',
        grossAmount: new Decimal('1'),
      };
      const result = AssetMovementSchema.safeParse(movement);
      expect(result.success).toBe(false);
    });
  });

  describe('netAmount validation', () => {
    it('accepts netAmount <= grossAmount', () => {
      const movement = {
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC',
        grossAmount: new Decimal('1.0'),
        netAmount: new Decimal('0.999'),
      };
      const result = AssetMovementSchema.safeParse(movement);
      expect(result.success).toBe(true);
    });

    it('rejects netAmount > grossAmount', () => {
      const movement = {
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC',
        grossAmount: new Decimal('1.0'),
        netAmount: new Decimal('1.1'),
      };
      const result = AssetMovementSchema.safeParse(movement);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('netAmount cannot exceed grossAmount');
      }
    });
  });
});

describe('FeeMovementSchema', () => {
  describe('assetId validation', () => {
    it('accepts valid blockchain native assetId', () => {
      const fee = {
        assetId: 'blockchain:ethereum:native',
        assetSymbol: 'ETH',
        amount: new Decimal('0.002'),
        scope: 'network' as const,
        settlement: 'balance' as const,
      };
      const result = FeeMovementSchema.safeParse(fee);
      expect(result.success).toBe(true);
    });

    it('accepts valid blockchain token assetId', () => {
      const fee = {
        assetId: 'blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        assetSymbol: 'USDC',
        amount: new Decimal('5'),
        scope: 'platform' as const,
        settlement: 'balance' as const,
      };
      const result = FeeMovementSchema.safeParse(fee);
      expect(result.success).toBe(true);
    });

    it('rejects blockchain assetId with unknown token reference', () => {
      const fee = {
        assetId: 'blockchain:solana:unknown:usdc',
        assetSymbol: 'USDC',
        amount: new Decimal('1'),
        scope: 'platform' as const,
        settlement: 'balance' as const,
      };
      const result = FeeMovementSchema.safeParse(fee);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('unknown token reference');
      }
    });

    it('rejects blockchain assetId with empty token reference', () => {
      const fee = {
        assetId: 'blockchain:solana:',
        assetSymbol: 'SOL',
        amount: new Decimal('0.001'),
        scope: 'network' as const,
        settlement: 'balance' as const,
      };
      const result = FeeMovementSchema.safeParse(fee);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('Token reference');
      }
    });
  });
});
