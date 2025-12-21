import type { EvmChainConfig, EvmTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, it } from 'vitest';

import type { ProcessingContext } from '../../../../shared/types/processors.ts';
import {
  analyzeEvmFundFlow,
  consolidateEvmMovementsByAsset,
  determineEvmOperationFromFundFlow,
  selectPrimaryEvmMovement,
} from '../processor-utils.js';
import type { EvmFundFlow, EvmMovement } from '../types.js';

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

describe('analyzeEvmFundFlow', () => {
  it('prefers non-zero feeAmount when internal events report zero fees', () => {
    const chainConfig: EvmChainConfig = {
      chainId: 1,
      chainName: 'ethereum',
      nativeCurrency: 'ETH',
      nativeDecimals: 18,
    };
    const context: ProcessingContext = {
      primaryAddress: '0xaaa',
      userAddresses: ['0xaaa'],
    };

    const txGroup: EvmTransaction[] = [
      {
        amount: '0',
        currency: 'ETH',
        eventId: 'evt-internal',
        feeAmount: '0',
        feeCurrency: 'ETH',
        from: '0xaaa',
        id: '0xhash',
        providerName: 'routescan',
        status: 'success',
        timestamp: 1,
        to: '0xbbb',
        traceId: 'internal-0',
        type: 'internal',
      },
      {
        amount: '0',
        currency: 'ETH',
        eventId: 'evt-contract',
        feeAmount: '1000000000000000000',
        feeCurrency: 'ETH',
        from: '0xaaa',
        id: '0xhash',
        methodId: '0x12345678',
        providerName: 'routescan',
        status: 'success',
        timestamp: 1,
        to: '0xccc',
        type: 'contract_call',
      },
    ];

    const result = analyzeEvmFundFlow(txGroup, context, chainConfig);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw new Error(result.error);
    }

    expect(result.value.feeAmount).toBe('1');
  });
});

describe('determineEvmOperationFromFundFlow', () => {
  describe('Pattern 0: Beacon withdrawal', () => {
    it('classifies small withdrawal (<32 ETH) as staking reward', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [{ asset: 'ETH', amount: '0.05' }], // 0.05 ETH withdrawal
        outflows: [],
        primary: { asset: 'ETH', amount: '0.05' },
        feeAmount: '0',
        feeCurrency: 'ETH',
        fromAddress: '0x0000000000000000000000000000000000000000', // Beacon chain
        toAddress: '0x123',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const beaconTx: EvmTransaction = {
        id: 'beacon-withdrawal-12345',
        eventId: 'beacon-withdrawal-12345-evt',
        type: 'beacon_withdrawal',
        status: 'success',
        timestamp: 1234567890,
        providerName: 'etherscan',
        from: '0x0000000000000000000000000000000000000000',
        to: '0x123',
        amount: '50000000000000000', // 0.05 ETH in Wei
        currency: 'ETH',
        gasPrice: '0',
        gasUsed: '0',
        feeAmount: '0',
        feeCurrency: 'ETH',
        tokenType: 'native',
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, [beaconTx]);

      expect(result.operation).toEqual({ category: 'staking', type: 'reward' });
      expect(result.notes).toHaveLength(1);
      expect(result.notes?.[0]?.type).toBe('consensus_withdrawal');
      expect(result.notes?.[0]?.severity).toBe('info');
      expect(result.notes?.[0]?.message).toContain('Partial withdrawal');
      expect(result.notes?.[0]?.metadata?.needsReview).toBe(false);
      expect(result.notes?.[0]?.metadata?.taxClassification).toContain('taxable');
    });

    it('classifies large withdrawal (≥32 ETH) as principal return with warning', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [{ asset: 'ETH', amount: '32.5' }], // 32.5 ETH withdrawal (full exit)
        outflows: [],
        primary: { asset: 'ETH', amount: '32.5' },
        feeAmount: '0',
        feeCurrency: 'ETH',
        fromAddress: '0x0000000000000000000000000000000000000000',
        toAddress: '0x123',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const beaconTx: EvmTransaction = {
        id: 'beacon-withdrawal-67890',
        eventId: 'beacon-withdrawal-67890-evt',
        type: 'beacon_withdrawal',
        status: 'success',
        timestamp: 1234567890,
        providerName: 'etherscan',
        from: '0x0000000000000000000000000000000000000000',
        to: '0x123',
        amount: '32500000000000000000', // 32.5 ETH in Wei
        currency: 'ETH',
        gasPrice: '0',
        gasUsed: '0',
        feeAmount: '0',
        feeCurrency: 'ETH',
        tokenType: 'native',
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, [beaconTx]);

      expect(result.operation).toEqual({ category: 'staking', type: 'deposit' });
      expect(result.notes).toHaveLength(1);
      expect(result.notes?.[0]?.type).toBe('consensus_withdrawal');
      expect(result.notes?.[0]?.severity).toBe('warning');
      expect(result.notes?.[0]?.message).toContain('Full withdrawal');
      expect(result.notes?.[0]?.message).toContain('≥32 ETH');
      expect(result.notes?.[0]?.metadata?.needsReview).toBe(true);
      expect(result.notes?.[0]?.metadata?.taxClassification).toContain('non-taxable');
    });

    it('classifies exactly 32 ETH as principal return', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [{ asset: 'ETH', amount: '32' }],
        outflows: [],
        primary: { asset: 'ETH', amount: '32' },
        feeAmount: '0',
        feeCurrency: 'ETH',
        fromAddress: '0x0000000000000000000000000000000000000000',
        toAddress: '0x123',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const beaconTx: EvmTransaction = {
        id: 'beacon-withdrawal-32000',
        eventId: 'beacon-withdrawal-32000-evt',
        type: 'beacon_withdrawal',
        status: 'success',
        timestamp: 1234567890,
        providerName: 'etherscan',
        from: '0x0000000000000000000000000000000000000000',
        to: '0x123',
        amount: '32000000000000000000', // Exactly 32 ETH
        currency: 'ETH',
        gasPrice: '0',
        gasUsed: '0',
        feeAmount: '0',
        feeCurrency: 'ETH',
        tokenType: 'native',
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, [beaconTx]);

      expect(result.operation).toEqual({ category: 'staking', type: 'deposit' });
      expect(result.notes?.[0]?.severity).toBe('warning');
      expect(result.notes?.[0]?.metadata?.needsReview).toBe(true);
    });
  });

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

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.notes?.[0]?.type).toBe('contract_interaction');
      expect(result.notes?.[0]?.severity).toBe('info');
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

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.notes?.[0]?.type).toBe('contract_interaction');
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

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'fee', type: 'fee' });
      expect(result.notes).toBeUndefined();
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

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'trade', type: 'swap' });
      expect(result.notes).toBeUndefined();
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

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'transfer', type: 'deposit' });
      expect(result.notes).toBeUndefined();
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

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

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

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'transfer', type: 'withdrawal' });
      expect(result.notes).toBeUndefined();
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

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

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

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.notes).toBeUndefined();
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

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.notes?.[0]?.type).toBe('classification_uncertain');
      expect(result.notes?.[0]?.severity).toBe('info');
      expect(result.notes?.[0]?.metadata).toHaveProperty('inflows');
      expect(result.notes?.[0]?.metadata).toHaveProperty('outflows');
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

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.notes?.[0]?.type).toBe('classification_failed');
      expect(result.notes?.[0]?.severity).toBe('warning');
    });
  });
});
