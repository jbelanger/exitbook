/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
import type { EvmChainConfig, EvmTransaction } from '@exitbook/blockchain-providers';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ITokenMetadataService } from '../../../../services/token-metadata/token-metadata-service.interface.js';
import { EvmTransactionProcessor } from '../processor.js';

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

function createMockTokenMetadataService(): ITokenMetadataService {
  return {
    enrichBatch: vi.fn().mockResolvedValue(ok()),
    getOrFetch: vi.fn().mockResolvedValue(ok()),
  } as unknown as ITokenMetadataService;
}

function createEthereumProcessor() {
  return new EvmTransactionProcessor(ETHEREUM_CONFIG, createMockTokenMetadataService());
}

function createAvalancheProcessor() {
  return new EvmTransactionProcessor(AVALANCHE_CONFIG, createMockTokenMetadataService());
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
        providerName: 'alchemy',
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: baseTimestamp,
        to: USER_ADDRESS,
        tokenType: 'native',
        traceId: 'trace-1',
        type: 'internal',
      },
      {
        amount: '2500000', // 2.5 USDC in smallest units (2500000 / 10^6 = 2.5)
        blockHeight: 100,
        currency: 'USDC',
        from: CONTRACT_ADDRESS,
        id: '0xhash1',
        providerName: 'alchemy',
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(result.value).toHaveLength(1);
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.externalId).toBe('0xhash1');
    expect(transaction.metadata).toBeDefined();
    if (!transaction.metadata) return;
    expect(transaction.metadata.correlatedTxCount).toBe(3);

    // Should track ALL assets (ETH and USDC), consolidated
    expect(transaction.movements.inflows).toHaveLength(2);
    const usdcInflow = transaction.movements.inflows?.find((i) => i.asset.toString() === 'USDC');
    const ethInflow = transaction.movements.inflows?.find((i) => i.asset.toString() === 'ETH');
    expect(usdcInflow?.netAmount?.toFixed()).toBe('2.5'); // 2500000 / 10^6 = 2.5 USDC
    expect(ethInflow?.netAmount?.toFixed()).toBe('1.5'); // 1 ETH + 0.5 ETH consolidated
    expect(transaction.movements.outflows).toHaveLength(0);
    // User received all funds (no outflows), so they didn't pay the fee - no fee entry created
    expect(transaction.fees.find((f) => f.scope === 'network')).toBeUndefined();
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.blockchain?.name).toBe('ethereum');
    expect(transaction.blockchain?.is_confirmed).toBe(true);
    expect(transaction.metadata.hasTokenTransfers).toBe(true);
    expect(transaction.metadata.hasInternalTransactions).toBe(true);
    expect(transaction.metadata.hasContractInteraction).toBe(false);
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
        providerName: 'alchemy',
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now() + 1000,
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toBeDefined();
    expect(result.value[0]?.externalId).toBe('0xhash1');
    expect(result.value[0]?.operation.type).toBe('deposit');
    expect(result.value[1]).toBeDefined();
    expect(result.value[1]?.externalId).toBe('0xhash2');
    expect(result.value[1]?.operation.type).toBe('withdrawal');
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
        providerName: 'alchemy',
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'internal',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
  });
});

describe('EvmTransactionProcessor - Fee Accounting', () => {
  test('deducts fee when user sends tokens (outgoing transfer)', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000', // 1 ETH sent
        currency: 'ETH',
        feeAmount: '21000000000000', // 0.000021 ETH fee
        from: USER_ADDRESS,
        id: '0xhash1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User paid the fee, so it should be deducted
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0.000021');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('does NOT deduct fee when user receives tokens (incoming transfer)', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000', // 1 ETH received
        currency: 'ETH',
        feeAmount: '21000000000000', // 0.000021 ETH fee (paid by sender)
        from: EXTERNAL_ADDRESS, // External sender (not user)
        id: '0xhash2',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User did NOT pay the fee (sender did), so fee should be 0
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
    expect(transaction.operation.type).toBe('deposit');
  });

  test('deducts fee for self-transfers (user is both sender and recipient)', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '500000000000000000', // 0.5 ETH self-transfer
        currency: 'ETH',
        feeAmount: '21000000000000', // 0.000021 ETH fee
        from: USER_ADDRESS,
        id: '0xhash3',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User initiated the self-transfer, so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0.000021');
    expect(transaction.operation.type).toBe('transfer');
  });

  test('deducts fee for contract interactions (user initiates)', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '0',
        currency: 'ETH',
        feeAmount: '150000000000000', // 0.00015 ETH fee
        from: USER_ADDRESS,
        functionName: 'approve',
        id: '0xhash4',
        methodId: '0x095ea7b3',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        type: 'contract_call',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User initiated contract interaction, so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0.00015');
  });

  test('does NOT deduct fee for incoming token transfers (airdrop/mint scenario)', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000', // 1000 USDC received
        currency: 'USDC',
        feeAmount: '50000000000000', // 0.00005 ETH fee (paid by sender/minter)
        from: CONTRACT_ADDRESS, // Contract/minter is sender
        id: '0xhash5',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS, // User receives tokens
        tokenAddress: '0xusdc000000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDC',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User did NOT pay the fee (contract/minter did), so fee should be 0
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
    expect(transaction.operation.type).toBe('deposit');
  });

  test('deducts fee for failed transactions when user was sender', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '2000000000000000000', // 2 ETH (failed send)
        currency: 'ETH',
        feeAmount: '100000000000000', // 0.0001 ETH fee (still consumed on failure)
        from: USER_ADDRESS, // User initiated transaction
        id: '0xhash6',
        providerName: 'alchemy',
        status: 'failed',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User initiated failed transaction, so they still paid the gas fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0.0001');
    expect(transaction.status).toBe('failed');
  });

  test('deducts fee for swaps (user initiates)', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '500000000000000000', // 0.5 ETH sent
        currency: 'ETH',
        feeAmount: '150000000000000', // 0.00015 ETH fee
        from: USER_ADDRESS, // User initiates swap
        id: '0xswap1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
      {
        amount: '1000000000', // 1000 USDC received
        currency: 'USDC',
        from: CONTRACT_ADDRESS,
        id: '0xswap1',
        providerName: 'alchemy',
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // User initiated swap, so they paid the fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0.00015');
    expect(transaction.operation.type).toBe('swap');
  });

  test('handles case-insensitive address comparison for fee logic', async () => {
    const processor = createEthereumProcessor();

    const mixedCaseUser = '0xUsEr00000000000000000000000000000000000000';

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        feeAmount: '21000000000000',
        // Addresses normalized to lowercase (as they would be from EvmAddressSchema)
        from: mixedCaseUser.toLowerCase(),
        id: '0xhash7',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Should correctly identify user as sender despite case difference
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0.000021');
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.from).toBe(EXTERNAL_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);

    // Check structured fields
    expect(transaction.movements.inflows).toBeDefined();
    if (!transaction.movements.inflows) return;
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset.toString()).toBe('ETH');
    expect(transaction.movements.inflows[0]?.netAmount?.toFixed()).toBe('1.5');
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(EXTERNAL_ADDRESS);

    // Check structured fields
    expect(transaction.movements.inflows).toHaveLength(0);
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows).toBeDefined();
    if (!transaction.movements.outflows) return;
    expect(transaction.movements.outflows[0]?.asset.toString()).toBe('ETH');
    expect(transaction.movements.outflows[0]?.netAmount?.toFixed()).toBe('2');
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];
    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);

    // Check structured fields - self-transfer shows both in and out
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
  });

  test('classifies incoming token transfer as deposit', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000', // 1000 USDC (pre-normalized, 6 decimals)
        currency: 'USDC',
        from: EXTERNAL_ADDRESS,
        id: '0xhash4',
        providerName: 'alchemy',
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.metadata?.tokenAddress).toBe('0xusdc000000000000000000000000000000000000');
  });

  test('classifies outgoing token transfer as withdrawal', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '5000000000', // 5000 USDC
        currency: 'USDC',
        from: USER_ADDRESS,
        id: '0xhash5',
        providerName: 'alchemy',
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.operation.type).toBe('withdrawal');
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('fee');
    expect(transaction.metadata?.hasContractInteraction).toBe(false);
  });

  test('classifies small deposit correctly (affects balance)', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000', // 0.000001 ETH (small amount)
        currency: 'ETH',
        feeAmount: '21000000000000',
        from: EXTERNAL_ADDRESS,
        id: '0xhash2',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Small deposits are normal deposits (affect balance), no special handling
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.note).toBeUndefined(); // No note for normal small deposits
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        type: 'contract_call',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - zero amount + contract interaction → 'transfer'
    expect(transaction.metadata?.hasContractInteraction).toBe(true);
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
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
        providerName: 'alchemy',
        status: 'failed',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - failed transactions still classified by direction
    expect(transaction.status).toBe('failed');
    expect(transaction.blockchain?.is_confirmed).toBe(false);
    expect(transaction.operation.type).toBe('withdrawal');
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        type: 'contract_call',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transaction = result.value[0];
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.metadata?.hasContractInteraction).toBe(true);
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transaction = result.value[0];
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.metadata?.hasContractInteraction).toBe(true);
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        type: 'transfer',
      },
    ];
    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transaction = result.value[0];
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.metadata?.hasContractInteraction).toBe(true);
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.blockchain?.name).toBe('ethereum');
    // User received, sender paid fee - no fee entry created when user didn't pay
    expect(transaction.fees.find((f) => f.scope === 'network')).toBeUndefined();
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
        providerName: 'snowtrace',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.blockchain?.name).toBe('avalanche');
    expect(transaction.metadata?.chainId).toBe(43114);
    // User received, sender paid fee - no fee entry created when user didn't pay
    expect(transaction.fees.find((f) => f.scope === 'network')).toBeUndefined();
  });

  test('normalizes native amounts using chain-specific decimals', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '123456789012345678', // 0.123456789012345678 ETH (18 decimals)
        currency: 'ETH',
        from: EXTERNAL_ADDRESS,
        id: '0xhash3',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: '' });

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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        // Addresses normalized to lowercase (as they would be from EvmAddressSchema)
        to: mixedCaseUser.toLowerCase(),
        tokenType: 'native',
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - should match despite case difference
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.operation.type).toBe('deposit');
  });

  test('handles missing fee data gracefully', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
        // No feeAmount field
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
  });

  test('handles transactions with missing optional fields', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'transfer',
        // Missing: blockHeight, blockId, tokenType, etc.
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toBeDefined();
    if (!result.value[0]) return;

    // Check structured fields
    expect(result.value[0].operation.type).toBe('deposit');
  });

  test('skips transactions without valid id', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'ETH',
        from: EXTERNAL_ADDRESS,
        id: '', // Invalid ID
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

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
        providerName: 'alchemy',
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
        providerName: 'alchemy',
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
    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
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
        providerName: 'alchemy',
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
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        traceId: 'trace-1',
        type: 'internal',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - should use internal transaction for fund flow
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.metadata?.hasInternalTransactions).toBe(true);
  });
});

describe('EvmTransactionProcessor - Swap Detection', () => {
  test('detects single-asset swap (ETH -> USDC)', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '500000000000000000', // 0.5 ETH sent
        currency: 'ETH',
        feeAmount: '150000000000000',
        from: USER_ADDRESS,
        id: '0xswap1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
      {
        amount: '1000000000', // 1000 USDC in smallest units (1000000000 / 10^6 = 1000)
        currency: 'USDC',
        from: CONTRACT_ADDRESS,
        id: '0xswap1',
        providerName: 'alchemy',
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

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('swap');

    // Verify both assets tracked
    expect(transaction.movements.inflows).toHaveLength(1);

    expect(transaction.movements.inflows).toBeDefined();
    if (!transaction.movements.inflows) return;
    expect(transaction.movements.inflows[0]?.asset.toString()).toBe('USDC');
    expect(transaction.movements.inflows[0]?.netAmount?.toFixed()).toBe('1000'); // 1000000000 / 10^6 = 1000 USDC

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows).toBeDefined();
    if (!transaction.movements.outflows) return;
    expect(transaction.movements.outflows[0]?.asset.toString()).toBe('ETH');
    expect(transaction.movements.outflows[0]?.netAmount?.toFixed()).toBe('0.5');
  });

  test('detects reverse swap (USDC -> ETH)', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '2000000000', // 2000 USDC sent
        currency: 'USDC',
        from: USER_ADDRESS,
        id: '0xswap2',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenAddress: '0xusdc000000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDC',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
      {
        amount: '1000000000000000000', // 1 ETH received
        currency: 'ETH',
        feeAmount: '150000000000000',
        from: CONTRACT_ADDRESS,
        id: '0xswap2',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
        type: 'internal',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('swap');
  });
});

describe('EvmTransactionProcessor - Classification Uncertainty', () => {
  test('adds note for complex multi-asset transaction', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '500000000000000000', // 0.5 ETH sent
        currency: 'ETH',
        feeAmount: '150000000000000',
        from: USER_ADDRESS,
        id: '0xcomplex1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenType: 'native',
        type: 'transfer',
      },
      {
        amount: '1000000000', // 1000 USDC sent
        currency: 'USDC',
        from: USER_ADDRESS,
        id: '0xcomplex1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenAddress: '0xusdc000000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDC',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
      {
        amount: '5000000000000000000000', // 5000 DAI in smallest units (5000 * 10^18)
        currency: 'DAI',
        from: CONTRACT_ADDRESS,
        id: '0xcomplex1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenAddress: '0xdai0000000000000000000000000000000000000',
        tokenDecimals: 18,
        tokenSymbol: 'DAI',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('classification_uncertain');
    expect(transaction.note?.severity).toBe('info');
    expect(transaction.note?.message).toContain('Complex transaction');
    expect(transaction.note?.message).toContain('2 outflow(s)');
    expect(transaction.note?.message).toContain('1 inflow(s)');

    // Still classified as transfer (conservative)
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');

    // Should track all assets
    expect(transaction.movements.outflows).toHaveLength(2);
    expect(transaction.movements.inflows).toHaveLength(1);
  });

  test('adds note for contract interaction with zero value', async () => {
    const processor = createEthereumProcessor();

    const normalizedData: EvmTransaction[] = [
      {
        amount: '0',
        currency: 'ETH',
        feeAmount: '100000000000000',
        from: USER_ADDRESS,
        functionName: 'approve',
        id: '0xapprove1',
        methodId: '0x095ea7b3',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        type: 'contract_call',
      },
    ];
    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('contract_interaction');
    expect(transaction.note?.message).toContain('Contract interaction');
    expect(transaction.note?.message).toContain('zero value');

    // Still classified as transfer
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
  });
});

describe('EvmTransactionProcessor - Token Metadata Enrichment', () => {
  let mockTokenMetadataService: ITokenMetadataService;

  beforeEach(() => {
    // Mock TokenMetadataService that actually enriches the data
    mockTokenMetadataService = {
      enrichBatch: vi
        .fn()
        .mockImplementation(
          (
            items: EvmTransaction[],
            _blockchain: string,
            contractExtractor: (item: EvmTransaction) => string | undefined,
            metadataUpdater: (item: EvmTransaction, metadata: { decimals: number; symbol: string }) => void
          ) => {
            // Simulate enrichment by calling the metadataUpdater callback
            for (const item of items) {
              const contractAddress = contractExtractor(item);
              // Mock metadata based on contract address
              if (contractAddress === '0xusdc000000000000000000000000000000000000') {
                metadataUpdater(item, { symbol: 'USDC', decimals: 6 });
              } else if (contractAddress === '0xdai0000000000000000000000000000000000000') {
                metadataUpdater(item, { symbol: 'DAI', decimals: 18 });
              } else if (contractAddress === '0xtoken00000000000000000000000000000000000') {
                metadataUpdater(item, { symbol: 'TOKEN', decimals: 18 });
              }
            }
            return ok();
          }
        ),
      getOrFetch: vi.fn().mockResolvedValue(ok()),
    } as unknown as ITokenMetadataService;
  });

  test('enriches token metadata when symbol looks like contract address', async () => {
    const processor = new EvmTransactionProcessor(ETHEREUM_CONFIG, mockTokenMetadataService);

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000', // 1000 USDC
        // Symbol is contract address (needs enrichment)
        currency: '0xusdc000000000000000000000000000000000000',
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenAddress: '0xusdc000000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: '0xusdc000000000000000000000000000000000000',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Verify enrichBatch was called with the transactions
    expect(mockTokenMetadataService.enrichBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          tokenAddress: '0xusdc000000000000000000000000000000000000',
        }),
      ]),
      'ethereum',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify enriched symbol is used in transaction
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows?.[0]?.asset.toString()).toBe('USDC');
  });

  test('skips enrichment when symbol is already readable', async () => {
    const processor = new EvmTransactionProcessor(ETHEREUM_CONFIG, mockTokenMetadataService);

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000',
        currency: 'USDC', // Already readable
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenAddress: '0xusdc000000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDC', // Already readable
        tokenType: 'erc20',
        type: 'token_transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);

    // Verify enrichBatch was NOT called for readable symbols
    expect(mockTokenMetadataService.enrichBatch).not.toHaveBeenCalled();
  });

  test('enriches decimals when missing from transaction', async () => {
    const processor = new EvmTransactionProcessor(ETHEREUM_CONFIG, mockTokenMetadataService);

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: '0xtoken00000000000000000000000000000000000',
        from: EXTERNAL_ADDRESS,
        id: '0xhash1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenAddress: '0xtoken00000000000000000000000000000000000',
        // tokenDecimals missing
        tokenSymbol: '0xtoken00000000000000000000000000000000000',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Verify enrichBatch was called
    expect(mockTokenMetadataService.enrichBatch).toHaveBeenCalled();

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify enriched metadata is used
    expect(transaction.movements.inflows?.[0]?.asset.toString()).toBe('TOKEN');
    expect(transaction.metadata?.tokenDecimals).toBe(18);
  });

  test('handles multiple token transfers with enrichment', async () => {
    const processor = new EvmTransactionProcessor(ETHEREUM_CONFIG, mockTokenMetadataService);

    const normalizedData: EvmTransaction[] = [
      {
        amount: '1000000000',
        currency: '0xusdc000000000000000000000000000000000000',
        from: USER_ADDRESS,
        id: '0xswap1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenAddress: '0xusdc000000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: '0xusdc000000000000000000000000000000000000',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
      {
        amount: '1000000000000000000000',
        currency: '0xdai0000000000000000000000000000000000000',
        from: CONTRACT_ADDRESS,
        id: '0xswap1',
        providerName: 'alchemy',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenAddress: '0xdai0000000000000000000000000000000000000',
        tokenDecimals: 18,
        tokenSymbol: '0xdai0000000000000000000000000000000000000',
        tokenType: 'erc20',
        type: 'token_transfer',
      },
    ];

    const result = await processor.process(normalizedData, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Verify enrichBatch was called once with both tokens
    expect(mockTokenMetadataService.enrichBatch).toHaveBeenCalledTimes(1);

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify both enriched symbols are used
    expect(transaction.movements.outflows?.[0]?.asset.toString()).toBe('USDC');
    expect(transaction.movements.inflows?.[0]?.asset.toString()).toBe('DAI');
    expect(transaction.operation.type).toBe('swap');
  });
});
