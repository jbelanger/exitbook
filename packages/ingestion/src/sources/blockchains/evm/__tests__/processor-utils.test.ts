import { type EvmChainConfig, type EvmTransaction } from '@exitbook/blockchain-providers/evm';
import type { Currency } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import type { AddressContext } from '../../../../shared/types/processors.js';
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
      { asset: 'USDC' as Currency, amount: '100' },
      { asset: 'ETH' as Currency, amount: '1.5' },
      { asset: 'USDC' as Currency, amount: '50' },
      { asset: 'ETH' as Currency, amount: '0.5' },
    ];

    const result = consolidateEvmMovementsByAsset(movements);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ asset: 'USDC' as Currency, amount: '150' });
    expect(result).toContainEqual({ asset: 'ETH' as Currency, amount: '2' });
  });

  it('preserves token metadata from first occurrence', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC' as Currency, amount: '100', tokenAddress: '0xabc', tokenDecimals: 6 },
      { asset: 'USDC' as Currency, amount: '50', tokenAddress: '0xdef', tokenDecimals: 18 },
    ];

    const result = consolidateEvmMovementsByAsset(movements);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      asset: 'USDC' as Currency,
      amount: '150',
      tokenAddress: '0xabc',
      tokenDecimals: 6,
    });
  });

  it('handles movements without token metadata', () => {
    const movements: EvmMovement[] = [
      { asset: 'ETH' as Currency, amount: '1' },
      { asset: 'ETH' as Currency, amount: '2' },
    ];

    const result = consolidateEvmMovementsByAsset(movements);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      asset: 'ETH' as Currency,
      amount: '3',
    });
  });

  it('handles empty movements array', () => {
    const result = consolidateEvmMovementsByAsset([]);
    expect(result).toEqual([]);
  });

  it('handles single movement', () => {
    const movements: EvmMovement[] = [
      { asset: 'BTC' as Currency, amount: '0.5', tokenAddress: '0x123', tokenDecimals: 8 },
    ];

    const result = consolidateEvmMovementsByAsset(movements);

    expect(result).toEqual(movements);
  });

  it('handles decimal precision correctly', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC' as Currency, amount: '0.1' },
      { asset: 'USDC' as Currency, amount: '0.2' },
      { asset: 'USDC' as Currency, amount: '0.3' },
    ];

    const result = consolidateEvmMovementsByAsset(movements);

    expect(result).toHaveLength(1);
    expect(result[0]?.amount).toBe('0.6');
  });

  it('does not consolidate movements with different roles', () => {
    const movements: EvmMovement[] = [
      { asset: 'ETH' as Currency, amount: '1', movementRole: 'staking_reward' },
      { asset: 'ETH' as Currency, amount: '2' },
    ];

    const result = consolidateEvmMovementsByAsset(movements);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ asset: 'ETH' as Currency, amount: '1', movementRole: 'staking_reward' });
    expect(result).toContainEqual({ asset: 'ETH' as Currency, amount: '2', movementRole: undefined });
  });
});

describe('selectPrimaryEvmMovement', () => {
  it('selects largest movement by amount', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC' as Currency, amount: '100' },
      { asset: 'ETH' as Currency, amount: '2' },
      { asset: 'BTC' as Currency, amount: '0.5' },
    ];

    const result = selectPrimaryEvmMovement(movements, 'ETH' as Currency);

    expect(result).toEqual({ asset: 'USDC' as Currency, amount: '100' });
  });

  it('skips zero amounts when selecting primary', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC' as Currency, amount: '0' },
      { asset: 'ETH' as Currency, amount: '1.5' },
    ];

    const result = selectPrimaryEvmMovement(movements, 'ETH' as Currency);

    expect(result).toEqual({ asset: 'ETH' as Currency, amount: '1.5' });
  });

  it('returns null when all movements are zero', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC' as Currency, amount: '0' },
      { asset: 'ETH' as Currency, amount: '0' },
    ];

    const result = selectPrimaryEvmMovement(movements, 'ETH' as Currency);

    expect(result).toEqual({ asset: 'ETH' as Currency, amount: '0' });
  });

  it('returns native currency with zero amount for empty movements', () => {
    const result = selectPrimaryEvmMovement([], 'AVAX' as Currency);

    expect(result).toEqual({ asset: 'AVAX' as Currency, amount: '0' });
  });

  it('preserves token metadata from selected movement', () => {
    const movements: EvmMovement[] = [
      { asset: 'USDC' as Currency, amount: '1000', tokenAddress: '0xabc', tokenDecimals: 6 },
      { asset: 'ETH' as Currency, amount: '2' },
    ];

    const result = selectPrimaryEvmMovement(movements, 'ETH' as Currency);

    expect(result).toEqual({
      asset: 'USDC' as Currency,
      amount: '1000',
      tokenAddress: '0xabc',
      tokenDecimals: 6,
    });
  });

  it('handles invalid amounts gracefully', () => {
    const movements: EvmMovement[] = [
      { asset: 'INVALID' as Currency, amount: 'not-a-number' },
      { asset: 'ETH' as Currency, amount: '1' },
    ];

    const result = selectPrimaryEvmMovement(movements, 'ETH' as Currency);

    expect(result).toEqual({ asset: 'ETH' as Currency, amount: '1' });
  });
});

describe('analyzeEvmFundFlow', () => {
  it('prefers non-zero feeAmount when internal events report zero fees', () => {
    const chainConfig: EvmChainConfig = {
      chainId: 1,
      chainName: 'ethereum',
      nativeCurrency: 'ETH' as Currency,
      nativeDecimals: 18,
      transactionTypes: ['normal', 'internal', 'token', 'beacon_withdrawal'],
    };
    const context: AddressContext = {
      primaryAddress: '0xaaa',
      userAddresses: ['0xaaa'],
    };

    const txGroup: EvmTransaction[] = [
      {
        amount: '0',
        currency: 'ETH',
        eventId: 'evt-internal',
        feeAmount: '0',
        feeCurrency: 'ETH' as Currency,
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
        feeCurrency: 'ETH' as Currency,
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
      throw result.error;
    }

    expect(result.value.feeAmount).toBe('1');
  });

  it('assigns staking_reward movementRole to partial beacon withdrawal inflows', () => {
    const chainConfig: EvmChainConfig = {
      chainId: 1,
      chainName: 'ethereum',
      nativeCurrency: 'ETH' as Currency,
      nativeDecimals: 18,
      transactionTypes: ['normal', 'internal', 'token', 'beacon_withdrawal'],
    };
    const context: AddressContext = {
      primaryAddress: '0x123',
      userAddresses: ['0x123'],
    };

    const txGroup: EvmTransaction[] = [
      {
        amount: '50000000000000000',
        currency: 'ETH',
        eventId: 'beacon-withdrawal-12345-evt',
        feeAmount: '0',
        feeCurrency: 'ETH' as Currency,
        from: '0x0000000000000000000000000000000000000000',
        id: 'beacon-withdrawal-12345',
        providerName: 'etherscan',
        status: 'success',
        timestamp: 1234567890,
        to: '0x123',
        tokenType: 'native',
        type: 'beacon_withdrawal',
      },
    ];

    const result = analyzeEvmFundFlow(txGroup, context, chainConfig);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.inflows).toEqual([
      {
        amount: '0.05',
        asset: 'ETH' as Currency,
        movementRole: 'staking_reward',
      },
    ]);
  });

  it('collapses returned input-asset refunds for swap-like router transactions', () => {
    const chainConfig: EvmChainConfig = {
      chainId: 42161,
      chainName: 'arbitrum',
      nativeCurrency: 'ETH' as Currency,
      nativeDecimals: 18,
      transactionTypes: ['normal', 'internal', 'token', 'beacon_withdrawal'],
    };
    const context: AddressContext = {
      primaryAddress: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
      userAddresses: ['0xba7dd2a5726a5a94b3556537e7212277e0e76cbf'],
    };

    const txGroup: EvmTransaction[] = [
      {
        amount: '36801703759966916',
        currency: 'ETH',
        eventId: '0xswap-refund-0',
        feeAmount: '2493390000000',
        feeCurrency: 'ETH' as Currency,
        from: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
        gasPrice: '10000000',
        gasUsed: '249339',
        id: '0xswap-refund',
        providerName: 'etherscan',
        status: 'success',
        timestamp: 1716525810000,
        to: '0x5e325eda8064b456f4781070c0738d849c824258',
        tokenType: 'native',
        type: 'transfer',
      },
      {
        amount: '183093053532173',
        currency: 'ETH',
        eventId: '0xswap-refund-internal-0',
        feeAmount: '0',
        feeCurrency: 'ETH' as Currency,
        from: '0x5e325eda8064b456f4781070c0738d849c824258',
        id: '0xswap-refund',
        providerName: 'etherscan',
        status: 'success',
        timestamp: 1716525810000,
        to: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
        tokenType: 'native',
        type: 'internal',
      },
      {
        amount: '50000000000000000000',
        currency: 'IMX',
        eventId: '0xswap-refund-token-0',
        feeAmount: '0',
        feeCurrency: 'ETH' as Currency,
        from: '0x5e325eda8064b456f4781070c0738d849c824258',
        id: '0xswap-refund',
        providerName: 'etherscan',
        status: 'success',
        timestamp: 1716525810000,
        to: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
        tokenAddress: '0x3cfd99593a7f035f717142095a3898e3fca7783e',
        tokenDecimals: 18,
        tokenSymbol: 'IMX',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
    ];

    const result = analyzeEvmFundFlow(txGroup, context, chainConfig);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.inflows).toEqual([
      {
        amount: '50',
        asset: 'IMX' as Currency,
        tokenAddress: '0x3cfd99593a7f035f717142095a3898e3fca7783e',
        tokenDecimals: 18,
      },
    ]);
    expect(result.value.outflows).toEqual([
      {
        amount: '0.036618610706434743',
        asset: 'ETH' as Currency,
      },
    ]);
    expect(result.value.classificationUncertainty).toBeUndefined();

    const operation = determineEvmOperationFromFundFlow(result.value, txGroup);
    expect(operation.operation).toEqual({ category: 'trade', type: 'swap' });
    expect(operation.diagnostics).toBeUndefined();
  });

  it('keeps full beacon withdrawals as principal movements', () => {
    const chainConfig: EvmChainConfig = {
      chainId: 1,
      chainName: 'ethereum',
      nativeCurrency: 'ETH' as Currency,
      nativeDecimals: 18,
      transactionTypes: ['normal', 'internal', 'token', 'beacon_withdrawal'],
    };
    const context: AddressContext = {
      primaryAddress: '0x123',
      userAddresses: ['0x123'],
    };

    const txGroup: EvmTransaction[] = [
      {
        amount: '32500000000000000000',
        currency: 'ETH',
        eventId: 'beacon-withdrawal-67890-evt',
        feeAmount: '0',
        feeCurrency: 'ETH' as Currency,
        from: '0x0000000000000000000000000000000000000000',
        id: 'beacon-withdrawal-67890',
        providerName: 'etherscan',
        status: 'success',
        timestamp: 1234567890,
        to: '0x123',
        tokenType: 'native',
        type: 'beacon_withdrawal',
      },
    ];

    const result = analyzeEvmFundFlow(txGroup, context, chainConfig);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.inflows).toEqual([
      {
        amount: '32.5',
        asset: 'ETH' as Currency,
        movementRole: undefined,
      },
    ]);
  });
});

describe('determineEvmOperationFromFundFlow', () => {
  describe('Pattern 0: Beacon withdrawal', () => {
    it('classifies small withdrawal (<32 ETH) as staking reward', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [{ asset: 'ETH' as Currency, amount: '0.05' }], // 0.05 ETH withdrawal
        outflows: [],
        primary: { asset: 'ETH' as Currency, amount: '0.05' },
        feeAmount: '0',
        feeCurrency: 'ETH' as Currency,
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
        feeCurrency: 'ETH' as Currency,
        tokenType: 'native',
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, [beaconTx]);

      expect(result.operation).toEqual({ category: 'staking', type: 'reward' });
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics?.[0]?.code).toBe('consensus_withdrawal');
      expect(result.diagnostics?.[0]?.severity).toBe('info');
      expect(result.diagnostics?.[0]?.message).toContain('Partial withdrawal');
      expect(result.diagnostics?.[0]?.metadata?.['needsReview']).toBe(false);
      expect(result.diagnostics?.[0]?.metadata?.['taxClassification']).toContain('taxable');
    });

    it('classifies large withdrawal (≥32 ETH) as principal return with warning', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [{ asset: 'ETH' as Currency, amount: '32.5' }], // 32.5 ETH withdrawal (full exit)
        outflows: [],
        primary: { asset: 'ETH' as Currency, amount: '32.5' },
        feeAmount: '0',
        feeCurrency: 'ETH' as Currency,
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
        feeCurrency: 'ETH' as Currency,
        tokenType: 'native',
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, [beaconTx]);

      expect(result.operation).toEqual({ category: 'staking', type: 'deposit' });
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics?.[0]?.code).toBe('consensus_withdrawal');
      expect(result.diagnostics?.[0]?.severity).toBe('warning');
      expect(result.diagnostics?.[0]?.message).toContain('Full withdrawal');
      expect(result.diagnostics?.[0]?.message).toContain('≥32 ETH');
      expect(result.diagnostics?.[0]?.metadata?.['needsReview']).toBe(true);
      expect(result.diagnostics?.[0]?.metadata?.['taxClassification']).toContain('non-taxable');
    });

    it('classifies exactly 32 ETH as principal return', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [{ asset: 'ETH' as Currency, amount: '32' }],
        outflows: [],
        primary: { asset: 'ETH' as Currency, amount: '32' },
        feeAmount: '0',
        feeCurrency: 'ETH' as Currency,
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
        feeCurrency: 'ETH' as Currency,
        tokenType: 'native',
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, [beaconTx]);

      expect(result.operation).toEqual({ category: 'staking', type: 'deposit' });
      expect(result.diagnostics?.[0]?.severity).toBe('warning');
      expect(result.diagnostics?.[0]?.metadata?.['needsReview']).toBe(true);
    });
  });

  describe('Pattern 1: Contract interaction with zero value', () => {
    it('classifies approval as transfer with token approval diagnostics', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [],
        primary: { asset: 'ETH' as Currency, amount: '0' },
        feeAmount: '0.001',
        feeCurrency: 'ETH' as Currency,
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: true,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };
      const approvalTx: EvmTransaction = {
        amount: '0',
        currency: 'ETH',
        eventId: 'approval-evt',
        feeAmount: '1000000000000000',
        feeCurrency: 'ETH' as Currency,
        from: '0x123',
        functionName: 'approve(address,uint256)',
        id: '0xapproval',
        methodId: '0x095ea7b3',
        providerName: 'etherscan',
        status: 'success',
        timestamp: 1,
        to: '0x456',
        tokenType: 'native',
        type: 'contract_call',
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, [approvalTx]);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.diagnostics?.[0]?.code).toBe('token_approval');
      expect(result.diagnostics?.[0]?.severity).toBe('info');
      expect(result.diagnostics?.[1]?.code).toBe('contract_interaction');
    });

    it('classifies staking operation as transfer with note', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [],
        primary: { asset: 'ETH' as Currency, amount: '0' },
        feeAmount: '0.001',
        feeCurrency: 'ETH' as Currency,
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: true,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.diagnostics?.[0]?.code).toBe('contract_interaction');
    });
  });

  describe('Pattern 2: Fee-only transaction', () => {
    it('classifies transaction with only fee as fee operation', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [],
        primary: { asset: 'ETH' as Currency, amount: '0' },
        feeAmount: '0.001',
        feeCurrency: 'ETH' as Currency,
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'fee', type: 'fee' });
      expect(result.diagnostics).toBeUndefined();
    });
  });

  describe('Pattern 3: Single asset swap', () => {
    it('classifies swap when one asset out and different asset in', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [{ asset: 'USDC' as Currency, amount: '1000' }],
        outflows: [{ asset: 'ETH' as Currency, amount: '0.5' }],
        primary: { asset: 'USDC' as Currency, amount: '1000' },
        feeAmount: '0.001',
        feeCurrency: 'ETH' as Currency,
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 2,
        hasContractInteraction: true,
        hasInternalTransactions: false,
        hasTokenTransfers: true,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'trade', type: 'swap' });
      expect(result.diagnostics).toBeUndefined();
    });
  });

  describe('Pattern 4: Simple deposit', () => {
    it('classifies deposit when only inflows present', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [{ asset: 'ETH' as Currency, amount: '1.5' }],
        outflows: [],
        primary: { asset: 'ETH' as Currency, amount: '1.5' },
        feeAmount: '0',
        feeCurrency: 'ETH' as Currency,
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'transfer', type: 'deposit' });
      expect(result.diagnostics).toBeUndefined();
    });

    it('classifies multi-asset deposit when multiple inflows present', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [
          { asset: 'ETH' as Currency, amount: '1' },
          { asset: 'USDC' as Currency, amount: '100' },
        ],
        outflows: [],
        primary: { asset: 'USDC' as Currency, amount: '100' },
        feeAmount: '0',
        feeCurrency: 'ETH' as Currency,
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
        outflows: [{ asset: 'ETH' as Currency, amount: '1.5' }],
        primary: { asset: 'ETH' as Currency, amount: '1.5' },
        feeAmount: '0.001',
        feeCurrency: 'ETH' as Currency,
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'transfer', type: 'withdrawal' });
      expect(result.diagnostics).toBeUndefined();
    });

    it('adds bridge diagnostics for Injective bridge contract withdrawals', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [{ asset: 'INJ' as Currency, amount: '6.03961192' }],
        primary: { asset: 'INJ' as Currency, amount: '6.03961192' },
        feeAmount: '0.001',
        feeCurrency: 'ETH' as Currency,
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: true,
        hasInternalTransactions: false,
        hasTokenTransfers: true,
      };
      const txGroup: EvmTransaction[] = [
        {
          amount: '6039611920000000000',
          currency: 'INJ',
          eventId: 'bridge-withdrawal-evt',
          feeAmount: '1000000000000000',
          feeCurrency: 'ETH' as Currency,
          from: '0x123',
          functionName: 'sendToInjective(address,string,uint256)',
          id: '0xbridge-withdrawal',
          providerName: 'etherscan',
          status: 'success',
          timestamp: 1,
          to: '0xbridge',
          tokenAddress: '0xe28b3b32b6c345a34ff64674606124dd5aceca30',
          tokenDecimals: 18,
          tokenSymbol: 'INJ',
          tokenType: 'erc20',
          type: 'token_transfer',
        },
      ];

      const result = determineEvmOperationFromFundFlow(fundFlow, txGroup);

      expect(result.operation).toEqual({ category: 'transfer', type: 'withdrawal' });
      expect(result.diagnostics?.[0]?.code).toBe('bridge_transfer');
      expect(result.diagnostics?.[0]?.severity).toBe('warning');
      expect(result.diagnostics?.[0]?.message).toContain('Injective');
      expect(result.diagnostics?.[0]?.metadata?.['bridgeDirection']).toBe('source');
      expect(result.diagnostics?.[0]?.metadata?.['detectionSource']).toBe('function_name');
      expect(result.diagnostics?.[0]?.metadata?.['functionName']).toBe('sendToInjective(address,string,uint256)');
    });

    it('adds bridge diagnostics for Wormhole transferTokensWithPayload withdrawals', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [{ asset: 'RENDER' as Currency, amount: '80.61' }],
        primary: { asset: 'RENDER' as Currency, amount: '80.61' },
        feeAmount: '0.001',
        feeCurrency: 'ETH' as Currency,
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: true,
        hasInternalTransactions: false,
        hasTokenTransfers: true,
      };
      const txGroup: EvmTransaction[] = [
        {
          amount: '8061000000',
          currency: 'RENDER',
          eventId: 'wormhole-withdrawal-evt',
          feeAmount: '1000000000000000',
          feeCurrency: 'ETH' as Currency,
          from: '0x123',
          functionName: 'transferTokensWithPayload(address,uint256,uint16,bytes32,uint32,bytes)',
          id: '0xwormhole-withdrawal',
          providerName: 'etherscan',
          status: 'success',
          timestamp: 1,
          to: '0xbridge',
          tokenAddress: '0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24',
          tokenDecimals: 8,
          tokenSymbol: 'RENDER',
          tokenType: 'erc20',
          type: 'token_transfer',
        },
      ];

      const result = determineEvmOperationFromFundFlow(fundFlow, txGroup);

      expect(result.operation).toEqual({ category: 'transfer', type: 'withdrawal' });
      expect(result.diagnostics?.[0]?.code).toBe('bridge_transfer');
      expect(result.diagnostics?.[0]?.severity).toBe('warning');
      expect(result.diagnostics?.[0]?.message).toContain('Wormhole');
      expect(result.diagnostics?.[0]?.metadata?.['bridgeDirection']).toBe('source');
      expect(result.diagnostics?.[0]?.metadata?.['hasCompleteValueEvidence']).toBe(false);
      expect(result.diagnostics?.[0]?.metadata?.['functionName']).toBe(
        'transferTokensWithPayload(address,uint256,uint16,bytes32,uint32,bytes)'
      );
    });

    it('adds bridge diagnostics for CCTP depositForBurn withdrawals', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [{ asset: 'USDC' as Currency, amount: '25' }],
        primary: { asset: 'USDC' as Currency, amount: '25' },
        feeAmount: '0.001',
        feeCurrency: 'ETH' as Currency,
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: true,
        hasInternalTransactions: false,
        hasTokenTransfers: true,
      };
      const txGroup: EvmTransaction[] = [
        {
          amount: '25000000',
          currency: 'USDC',
          eventId: 'cctp-withdrawal-evt',
          feeAmount: '1000000000000000',
          feeCurrency: 'ETH' as Currency,
          from: '0x123',
          functionName: 'depositForBurn(uint256,uint32,bytes32,address)',
          id: '0xcctp-withdrawal',
          methodId: '0x6fd3504e',
          providerName: 'etherscan',
          status: 'success',
          timestamp: 1,
          to: '0xbridge',
          tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          tokenDecimals: 6,
          tokenSymbol: 'USDC',
          tokenType: 'erc20',
          type: 'token_transfer',
        },
      ];

      const result = determineEvmOperationFromFundFlow(fundFlow, txGroup);

      expect(result.operation).toEqual({ category: 'transfer', type: 'withdrawal' });
      expect(result.diagnostics?.[0]?.code).toBe('bridge_transfer');
      expect(result.diagnostics?.[0]?.severity).toBe('warning');
      expect(result.diagnostics?.[0]?.metadata?.['bridgeFamily']).toBe('cctp');
      expect(result.diagnostics?.[0]?.metadata?.['detectionSource']).toBe('method_id');
      expect(result.diagnostics?.[0]?.metadata?.['methodId']).toBe('0x6fd3504e');
    });

    it('adds bridge diagnostics from Polygon zkEVM bridgeAsset method ids when the provider omits function names', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [{ asset: 'ETH' as Currency, amount: '0.01' }],
        primary: { asset: 'ETH' as Currency, amount: '0.01' },
        feeAmount: '0.001',
        feeCurrency: 'ETH' as Currency,
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: true,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };
      const txGroup: EvmTransaction[] = [
        {
          amount: '10000000000000000',
          currency: 'ETH',
          eventId: 'polygon-zkevm-bridge-withdrawal-evt',
          feeAmount: '1000000000000000',
          feeCurrency: 'ETH' as Currency,
          from: '0x123',
          id: '0xpolygon-zkevm-bridge-withdrawal',
          methodId: '0xcd586579',
          providerName: 'etherscan',
          status: 'success',
          timestamp: 1,
          to: '0xbridge',
          tokenType: 'native',
          type: 'contract_call',
        },
      ];

      const result = determineEvmOperationFromFundFlow(fundFlow, txGroup);

      expect(result.operation).toEqual({ category: 'transfer', type: 'withdrawal' });
      expect(result.diagnostics?.[0]?.code).toBe('bridge_transfer');
      expect(result.diagnostics?.[0]?.metadata).toMatchObject({
        bridgeDirection: 'source',
        bridgeFamily: 'polygon_zkevm_bridge',
        detectionSource: 'method_id',
        methodId: '0xcd586579',
      });
    });

    it('classifies multi-asset withdrawal when multiple outflows present', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [
          { asset: 'ETH' as Currency, amount: '1' },
          { asset: 'USDC' as Currency, amount: '100' },
        ],
        primary: { asset: 'USDC' as Currency, amount: '100' },
        feeAmount: '0.001',
        feeCurrency: 'ETH' as Currency,
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
        inflows: [{ asset: 'ETH' as Currency, amount: '1' }],
        outflows: [{ asset: 'ETH' as Currency, amount: '1' }],
        primary: { asset: 'ETH' as Currency, amount: '1' },
        feeAmount: '0.001',
        feeCurrency: 'ETH' as Currency,
        fromAddress: '0x123',
        toAddress: '0x123',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.diagnostics).toBeUndefined();
    });
  });

  describe('Pattern 7: Complex multi-asset transaction', () => {
    it('classifies uncertain transaction with note when multiple assets involved', () => {
      const fundFlow: EvmFundFlow = {
        inflows: [
          { asset: 'USDC' as Currency, amount: '1000' },
          { asset: 'DAI' as Currency, amount: '500' },
        ],
        outflows: [
          { asset: 'ETH' as Currency, amount: '1' },
          { asset: 'WBTC' as Currency, amount: '0.05' },
        ],
        primary: { asset: 'USDC' as Currency, amount: '1000' },
        feeAmount: '0.002',
        feeCurrency: 'ETH' as Currency,
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
      expect(result.diagnostics?.[0]?.code).toBe('classification_uncertain');
      expect(result.diagnostics?.[0]?.severity).toBe('info');
      expect(result.diagnostics?.[0]?.metadata).toHaveProperty('inflows');
      expect(result.diagnostics?.[0]?.metadata).toHaveProperty('outflows');
    });
  });

  describe('Fallback: Unmatched pattern', () => {
    it('classifies unknown pattern with warning note', () => {
      // This scenario doesn't match any pattern: non-zero primary with empty movements
      // (which shouldn't happen in practice but tests the fallback)
      const fundFlow: EvmFundFlow = {
        inflows: [],
        outflows: [],
        primary: { asset: 'ETH' as Currency, amount: '1' },
        feeAmount: '0.001',
        feeCurrency: 'ETH' as Currency,
        fromAddress: '0x123',
        toAddress: '0x456',
        transactionCount: 1,
        hasContractInteraction: false,
        hasInternalTransactions: false,
        hasTokenTransfers: false,
      };

      const result = determineEvmOperationFromFundFlow(fundFlow, []);

      expect(result.operation).toEqual({ category: 'transfer', type: 'transfer' });
      expect(result.diagnostics?.[0]?.code).toBe('classification_failed');
      expect(result.diagnostics?.[0]?.severity).toBe('warning');
    });
  });
});
