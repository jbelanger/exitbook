import { describe, expect, it } from 'vitest';

import {
  consolidateEvmMovementsByAsset,
  selectPrimaryEvmMovement,
  determineEvmOperationFromFundFlow,
} from './processor-utils.ts';
import type { EvmFundFlow, EvmMovement } from './types.ts';

describe('consolidateEvmMovementsByAsset', () => {
  it('consolidates duplicate assets by summing amounts', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC', amount: '100' },
      { asset: 'ETH', amount: '1.5' },
      { asset: 'USDC', amount: '50' },
      { asset: 'ETH', amount: '0.5' },
    ];

    const result = consolidateEvmMovementsByAsset(movements);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ asset: 'USDC', amount: '150' });
    expect(result).toContainEqual({ asset: 'ETH', amount: '2' });
  });

  it('preserves token metadata from first occurrence', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC', amount: '100', tokenAddress: '0xabc', tokenDecimals: 6 },
      { asset: 'USDC', amount: '50', tokenAddress: '0xdef', tokenDecimals: 18 },
    ];

    const result = consolidateEvmMovementsByAsset(movements);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      asset: 'USDC',
      amount: '150',
      tokenAddress: '0xabc',
      tokenDecimals: 6,
    });
  });

  it('handles movements without token metadata', () => {
    const movements: EvmMovement[] = [
      { asset: 'ETH', amount: '1' },
      { asset: 'ETH', amount: '2' },
    ];

    const result = consolidateEvmMovementsByAsset(movements);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      asset: 'ETH',
      amount: '3',
    });
  });

  it('handles empty movements array', () => {
    const result = consolidateEvmMovementsByAsset([]);
    expect(result).toEqual([]);
  });

  it('handles single movement', () => {
    const movements: EvmMovement[] = [{ asset: 'BTC', amount: '0.5', tokenAddress: '0x123', tokenDecimals: 8 }];

    const result = consolidateEvmMovementsByAsset(movements);

    expect(result).toEqual(movements);
  });

  it('handles decimal precision correctly', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC', amount: '0.1' },
      { asset: 'USDC', amount: '0.2' },
      { asset: 'USDC', amount: '0.3' },
    ];

    const result = consolidateEvmMovementsByAsset(movements);

    expect(result).toHaveLength(1);
    expect(result[0]?.amount).toBe('0.6');
  });
});

describe('selectPrimaryEvmMovement', () => {
  it('selects largest movement by amount', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC', amount: '100' },
      { asset: 'ETH', amount: '2' },
      { asset: 'BTC', amount: '0.5' },
    ];

    const result = selectPrimaryEvmMovement(movements, { nativeCurrency: 'ETH' });

    expect(result).toEqual({ asset: 'USDC', amount: '100' });
  });

  it('skips zero amounts when selecting primary', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC', amount: '0' },
      { asset: 'ETH', amount: '1.5' },
    ];

    const result = selectPrimaryEvmMovement(movements, { nativeCurrency: 'ETH' });

    expect(result).toEqual({ asset: 'ETH', amount: '1.5' });
  });

  it('returns null when all movements are zero', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC', amount: '0' },
      { asset: 'ETH', amount: '0' },
    ];

    const result = selectPrimaryEvmMovement(movements, { nativeCurrency: 'ETH' });

    expect(result).toEqual({ asset: 'ETH', amount: '0' });
  });

  it('returns native currency with zero amount for empty movements', () => {
    const result = selectPrimaryEvmMovement([], { nativeCurrency: 'AVAX' });

    expect(result).toEqual({ asset: 'AVAX', amount: '0' });
  });

  it('preserves token metadata from selected movement', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC', amount: '1000', tokenAddress: '0xabc', tokenDecimals: 6 },
      { asset: 'ETH', amount: '2' },
    ];

    const result = selectPrimaryEvmMovement(movements, { nativeCurrency: 'ETH' });

    expect(result).toEqual({
      asset: 'USDC',
      amount: '1000',
      tokenAddress: '0xabc',
      tokenDecimals: 6,
    });
  });

  it('handles invalid amounts gracefully', () => {
    const movements: EvmMovement[] = [
      { asset: 'INVALID', amount: 'not-a-number' },
      { asset: 'ETH', amount: '1' },
    ];

    const result = selectPrimaryEvmMovement(movements, { nativeCurrency: 'ETH' });

    expect(result).toEqual({ asset: 'ETH', amount: '1' });
  });
});

describe('determineEvmOperationFromFundFlow', () => {
  describe('Pattern 1: Contract interaction with zero value', () => {
    it('classifies approval as transfer with note', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [],
        primary: { asset: 'ETH', amount: '0' },
        feeAmount: '0.001',
        feeCurrency: 'ETH',
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: true,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.note?.type).toBe('contract_interaction');
      expect(result.note?.severity).toBe('info');
    });

    it('classifies staking operation as transfer with note', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [],
        primary: { asset: 'ETH', amount: '0' },
        feeAmount: '0.001',
        feeCurrency: 'ETH',
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: true,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.note?.type).toBe('contract_interaction');
    });
  });

  describe('Pattern 2: Fee-only transaction', () => {
    it('classifies transaction with only fee as fee operation', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [],
        primary: { asset: 'ETH', amount: '0' },
        feeAmount: '0.001',
        feeCurrency: 'ETH',
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({ category: 'fee', type: 'fee' });
      expect(result.note).toBeUndefined();
    });
  });

  describe('Pattern 3: Single asset swap', () => {
    it('classifies swap when one asset out and different asset in', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [{ asset: 'USDC', amount: '1000' }],
        outflows: [{ asset: 'ETH', amount: '0.5' }],
        primary: { asset: 'USDC', amount: '1000' },
        feeAmount: '0.001',
        feeCurrency: 'ETH',
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 2,
        hasContractInteraction: true,
        hasInternalTransactions: false,
        hasTokenTransfers: true,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({ category: 'trade', type: 'swap' });
      expect(result.note).toBeUndefined();
    });
  });

  describe('Pattern 4: Simple deposit', () => {
    it('classifies deposit when only inflows present', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [{ asset: 'ETH', amount: '1.5' }],
        outflows: [],
        primary: { asset: 'ETH', amount: '1.5' },
        feeAmount: '0',
        feeCurrency: 'ETH',
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({ category: 'transfer', type: 'deposit' });
      expect(result.note).toBeUndefined();
    });

    it('classifies multi-asset deposit when multiple inflows present', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [
          { asset: 'ETH', amount: '1' },
          { asset: 'USDC', amount: '100' },
        ],
        outflows: [],
        primary: { asset: 'USDC', amount: '100' },
        feeAmount: '0',
        feeCurrency: 'ETH',
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 2,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: true,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({ category: 'transfer', type: 'deposit' });
    });
  });

  describe('Pattern 5: Simple withdrawal', () => {
    it('classifies withdrawal when only outflows present', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [{ asset: 'ETH', amount: '1.5' }],
        primary: { asset: 'ETH', amount: '1.5' },
        feeAmount: '0.001',
        feeCurrency: 'ETH',
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({ category: 'transfer', type: 'withdrawal' });
      expect(result.note).toBeUndefined();
    });

    it('classifies multi-asset withdrawal when multiple outflows present', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [
          { asset: 'ETH', amount: '1' },
          { asset: 'USDC', amount: '100' },
        ],
        primary: { asset: 'USDC', amount: '100' },
        feeAmount: '0.001',
        feeCurrency: 'ETH',
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 2,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: true,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({ category: 'transfer', type: 'withdrawal' });
    });
  });

  describe('Pattern 6: Self-transfer', () => {
    it('classifies transfer when same asset in and out', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [{ asset: 'ETH', amount: '1' }],
        outflows: [{ asset: 'ETH', amount: '1' }],
        primary: { asset: 'ETH', amount: '1' },
        feeAmount: '0.001',
        feeCurrency: 'ETH',
        fromAddress: '0x123',
        toAddress: '0x123',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.note).toBeUndefined();
    });
  });

  describe('Pattern 7: Complex multi-asset transaction', () => {
    it('classifies uncertain transaction with note when multiple assets involved', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [
          { asset: 'USDC', amount: '1000' },
          { asset: 'DAI', amount: '500' },
        ],
        outflows: [
          { asset: 'ETH', amount: '1' },
          { asset: 'WBTC', amount: '0.05' },
        ],
        primary: { asset: 'USDC', amount: '1000' },
        feeAmount: '0.002',
        feeCurrency: 'ETH',
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 4,
        hasContractInteraction: true,
        hasInternalTransactions: true,
        hasTokenTransfers: true,
        classificationUncertainty:
          'Complex transaction with 2 outflow(s) and 2 inflow(s). May be liquidity provision, batch operation, or multi-asset swap.',
      };

      const result = determineEvmOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.note?.type).toBe('classification_uncertain');
      expect(result.note?.severity).toBe('info');
      expect(result.note?.metadata).toHaveProperty('inflows');
      expect(result.note?.metadata).toHaveProperty('outflows');
    });
  });

  describe('Fallback: Unmatched pattern', () => {
    it('classifies unknown pattern with warning note', () => {
      // This scenario doesn't match any pattern: non-zero primary with empty movements
      // (which shouldn't happen in practice but tests the fallback)
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [],
        primary: { asset: 'ETH', amount: '1' },
        feeAmount: '0.001',
        feeCurrency: 'ETH',
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.note?.type).toBe('classification_failed');
      expect(result.note?.severity).toBe('warning');
    });
  });
});
