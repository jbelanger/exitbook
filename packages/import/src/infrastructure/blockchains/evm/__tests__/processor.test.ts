import type { ProcessingImportSession } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import { describe, expect, test } from 'vitest';

import type { EvmChainConfig } from '../chain-config.interface.js';
import { EvmTransactionProcessor } from '../processor.ts';
import type { EvmTransaction } from '../types.js';

const ETHEREUM_CONFIG: EvmChainConfig = {
  chainId: 1,
  chainName: 'ethereum',
  nativeCurrency: 'ETH',
  nativeDecimals: 18,
};

const AVALANCHE_CONFIG: EvmChainConfig = {
  chainId: 43114,
  chainName: 'avalanche',
  nativeCurrency: 'AVAX',
  nativeDecimals: 18,
};

const USER_ADDRESS = '0xuser00000000000000000000000000000000000000';
const EXTERNAL_ADDRESS = '0xexternal000000000000000000000000000000000';
const CONTRACT_ADDRESS = '0xcontract00000000000000000000000000000000';

function buildSession(normalizedData: EvmTransaction[], userAddress: string = USER_ADDRESS): ProcessingImportSession {
  return {
    createdAt: Date.now(),
    id: 1,
    normalizedData,
    sessionMetadata: {
      address: userAddress,
    },
    sourceId: 'test-blockchain',
    sourceType: 'blockchain',
    status: 'running',
  };
}

function createEthereumProcessor() {
  return new EvmTransactionProcessor(ETHEREUM_CONFIG);
}

function createAvalancheProcessor() {
  return new EvmTransactionProcessor(AVALANCHE_CONFIG);
}

describe('EvmTransactionProcessor - Transaction Correlation', () => {
  test('correlates multiple transactions with same hash into single output', async () => {
    const processor = createEthereumProcessor();

    const baseTimestamp = Date.now();
    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000', // 1 ETH
        blockHeight: 100,
        currency: 'ETH',
        feeAmount: '21000000000000',
        feeCurrency: 'ETH',
        from: CONTRACT_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: baseTimestamp,
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
      {
        amount: '500000000000000000', // 0.5 ETH internal
        blockHeight: 100,
        currency: 'ETH',
        from: CONTRACT_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: baseTimestamp,
        to: USER_ADDRESS,
        tokenType: 'native',
        traceId: 'trace-1',
        type: 'internal',
      },
      {
        amount: '2500000', // 2.5 USDC (pre-normalized)
        blockHeight: 100,
        currency: 'USDC',
        from: CONTRACT_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: baseTimestamp,
        to: USER_ADDRESS,
        tokenAddress: '0xusdc000000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDC',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(result.value).toHaveLength(1);
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.id).toBe('0xhash1');
    expect(transaction.type).toBe('deposit');
    expect(transaction.symbol).toBe('USDC'); // Prefers token over native
    expect(transaction.amount.currency).toBe('USDC');
    expect(transaction.amount.amount.toString()).toBe('2500000');
    expect(transaction.fee?.amount.toString()).toBe('0.000021');
    expect(transaction.metadata.correlatedTxCount).toBe(3);

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasTokenTransfers).toBe(true);
    expect(fundFlow.hasInternalTransactions).toBe(true);
    expect(fundFlow.hasContractInteraction).toBe(false);
    expect(fundFlow.transactionCount).toBe(3);
  });

  test('processes multiple transaction groups independently', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        feeAmount: '21000000000000',
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
      {
        amount: '2000000000000000000',
        currency: 'ETH',
        feeAmount: '21000000000000',
        from: USER_ADDRESS,
        id: '0xhash2',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now() + 1000,
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toBeDefined();
    expect(result.value[0]?.id).toBe('0xhash1');
    expect(result.value[0]?.type).toBe('deposit');
    expect(result.value[1]).toBeDefined();
    expect(result.value[1]?.id).toBe('0xhash2');
    expect(result.value[1]?.type).toBe('withdrawal');
  });

  test('sums fees across all correlated transactions', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        feeAmount: '21000000000000', // 0.000021 ETH
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
      {
        amount: '500000000000000000',
        currency: 'ETH',
        feeAmount: '15000000000000', // 0.000015 ETH
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'internal',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    // Total fee should be 0.000021 + 0.000015 = 0.000036 ETH
    expect(transaction.fee?.amount.toString()).toBe('0.000036');
  });
});

describe('EvmTransactionProcessor - Fund Flow Direction', () => {
  test('classifies incoming native transfer as deposit', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1500000000000000000', // 1.5 ETH in wei
        currency: 'ETH',
        feeAmount: '21000000000000',
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('deposit');
    expect(transaction.amount.amount.toString()).toBe('1.5');
    expect(transaction.symbol).toBe('ETH');
    expect(transaction.from).toBe(EXTERNAL_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.isIncoming).toBe(true);
    expect(fundFlow.isOutgoing).toBe(false);
  });

  test('classifies outgoing native transfer as withdrawal', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '2000000000000000000', // 2 ETH in wei
        currency: 'ETH',
        feeAmount: '100000000000000',
        from: USER_ADDRESS,
        id: '0xhash2',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('withdrawal');
    expect(transaction.amount.amount.toString()).toBe('2');
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(EXTERNAL_ADDRESS);

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.isOutgoing).toBe(true);
    expect(fundFlow.isIncoming).toBe(false);
  });

  test('classifies self-transfer (incoming and outgoing) as transfer', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '500000000000000000', // 0.5 ETH
        currency: 'ETH',
        feeAmount: '21000000000000',
        from: USER_ADDRESS,
        id: '0xhash3',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('transfer');
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.isIncoming).toBe(true);
    expect(fundFlow.isOutgoing).toBe(true);
  });

  test('classifies incoming token transfer as deposit', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000', // 1000 USDC (pre-normalized, 6 decimals)
        currency: 'USDC',
        from: EXTERNAL_ADDRESS,
        id: '0xhash4',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenAddress: '0xusdc000000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDC',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('deposit');
    expect(transaction.amount.amount.toString()).toBe('1000000000');
    expect(transaction.symbol).toBe('USDC');
    expect(transaction.metadata.tokenAddress).toBe('0xusdc000000000000000000000000000000000000');
  });

  test('classifies outgoing token transfer as withdrawal', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '5000000000', // 5000 USDC
        currency: 'USDC',
        from: USER_ADDRESS,
        id: '0xhash5',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenAddress: '0xusdc000000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDC',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('withdrawal');
    expect(transaction.amount.amount.toString()).toBe('5000000000');
    expect(transaction.symbol).toBe('USDC');
  });
});

describe('EvmTransactionProcessor - Transaction Type Classification', () => {
  test('marks zero-amount transactions as fee', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '0',
        currency: 'ETH',
        feeAmount: '50000000000000',
        from: USER_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('fee');
    expect(transaction.amount.amount.toString()).toBe('0');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasContractInteraction).toBe(false);
    expect(fundFlow.primaryAmount).toBe('0');
  });

  test('marks dust-amount transactions (below threshold) as fee', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000', // 0.000001 ETH (below 0.00001 threshold)
        currency: 'ETH',
        feeAmount: '21000000000000',
        from: EXTERNAL_ADDRESS,
        id: '0xhash2',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('fee');
  });

  test('classifies contract interaction without fund movement as transfer', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '0',
        currency: 'ETH',
        feeAmount: '100000000000000',
        from: USER_ADDRESS,
        functionName: 'approve',
        id: '0xhash3',
        methodId: '0x095ea7b3',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        type: 'contract_call',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    // Zero amount + contract interaction → fallback to 'transfer' (line 296 of processor)
    expect(transaction.type).toBe('transfer');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasContractInteraction).toBe(true);
  });

  test('handles failed transactions', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        feeAmount: '21000000000000',
        from: USER_ADDRESS,
        id: '0xhash4',
        providerId: 'alchemy',
        status: 'failed',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.status).toBe('failed');
    expect(transaction.type).toBe('withdrawal'); // Still classified by direction
  });
});

describe('EvmTransactionProcessor - Contract Interaction Detection', () => {
  test('detects contract interaction via type', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        feeAmount: '150000000000000',
        from: USER_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        type: 'contract_call',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transaction = result.value[0];
    expect(transaction).toBeDefined();
    if (!transaction) return;
    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasContractInteraction).toBe(true);
  });

  test('detects contract interaction via methodId', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        feeAmount: '150000000000000',
        from: USER_ADDRESS,
        id: '0xhash2',
        methodId: '0xa9059cbb', // transfer(address,uint256)
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transaction = result.value[0];
    expect(transaction).toBeDefined();
    if (!transaction) return;
    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasContractInteraction).toBe(true);
  });

  test('detects contract interaction via functionName', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        feeAmount: '150000000000000',
        from: USER_ADDRESS,
        functionName: 'swap',
        id: '0xhash3',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transaction = result.value[0];
    expect(transaction).toBeDefined();
    if (!transaction) return;
    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasContractInteraction).toBe(true);
  });
});

describe('EvmTransactionProcessor - Multi-Chain Support', () => {
  test('uses chain-specific native currency for Ethereum', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        feeAmount: '21000000000000',
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.symbol).toBe('ETH');
    expect(transaction.metadata.nativeCurrency).toBe('ETH');
    expect(transaction.fee?.currency).toBe('ETH');
  });

  test('uses chain-specific native currency for Avalanche', async () => {
    const processor = createAvalancheProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '2000000000000000000',
        currency: 'AVAX',
        feeAmount: '21000000000000',
        from: EXTERNAL_ADDRESS,
        id: '0xhash2',
        providerId: 'snowtrace',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.symbol).toBe('AVAX');
    expect(transaction.metadata.nativeCurrency).toBe('AVAX');
    expect(transaction.metadata.blockchain).toBe('avalanche');
    expect(transaction.metadata.chainId).toBe(43114);
    expect(transaction.fee?.currency).toBe('AVAX');
  });

  test('normalizes native amounts using chain-specific decimals', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '123456789012345678', // 0.123456789012345678 ETH (18 decimals)
        currency: 'ETH',
        from: EXTERNAL_ADDRESS,
        id: '0xhash3',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.amount.amount.toString()).toBe('0.123456789012345678');
  });
});

describe('EvmTransactionProcessor - Edge Cases', () => {
  test('handles missing user address in session metadata', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData, '');

    const result = await processor.process(session);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('Missing user address');
    }
  });

  test('handles case-insensitive address matching', async () => {
    const processor = createEthereumProcessor();

    const mixedCaseUser = '0xUsEr00000000000000000000000000000000000000';

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: mixedCaseUser, // Different case than USER_ADDRESS
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData, USER_ADDRESS);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('deposit'); // Should match despite case difference

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.isIncoming).toBe(true);
  });

  test('handles missing fee data gracefully', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
        // No feeAmount field
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.fee?.amount.toString()).toBe('0');
  });

  test('handles transactions with missing optional fields', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'transfer',
        // Missing: blockHeight, blockId, tokenType, etc.
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toBeDefined();
    if (!result.value[0]) return;
    expect(result.value[0].type).toBe('deposit');
  });

  test('skips transactions without valid id', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        from: EXTERNAL_ADDRESS,
        id: '', // Invalid ID
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Should skip transaction with invalid ID
    expect(result.value).toHaveLength(0);
  });
});

describe('EvmTransactionProcessor - Primary Transaction Selection', () => {
  test('prefers token_transfer as primary when multiple types present', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        from: CONTRACT_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'transfer',
      },
      {
        amount: '2500000',
        currency: 'USDC',
        from: CONTRACT_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now() + 100,
        to: USER_ADDRESS,
        tokenAddress: '0xusdc000000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDC',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    // Should use token_transfer as primary
    expect(transaction.symbol).toBe('USDC');
    expect(transaction.amount.amount.toString()).toBe('2500000');
  });

  test('uses internal transaction when no token transfer exists', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '0', // Main tx has no value
        currency: 'ETH',
        feeAmount: '150000000000000',
        from: USER_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        type: 'contract_call',
      },
      {
        amount: '500000000000000000', // Internal has value
        currency: 'ETH',
        from: CONTRACT_ADDRESS,
        id: '0xhash1',
        providerId: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        traceId: 'trace-1',
        type: 'internal',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    // Should use internal transaction for fund flow
    expect(transaction.symbol).toBe('ETH');
    expect(transaction.amount.amount.toString()).toBe('0.5');
    expect(transaction.type).toBe('deposit');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasInternalTransactions).toBe(true);
  });
});
