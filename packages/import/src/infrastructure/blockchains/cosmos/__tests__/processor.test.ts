import type { ProcessingImportSession } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import { describe, expect, test } from 'vitest';

import type { CosmosChainConfig } from '../chain-config.interface.js';
import { CosmosProcessor } from '../processor.ts';
import type { CosmosTransaction } from '../types.js';

const INJECTIVE_CONFIG: CosmosChainConfig = {
  bech32Prefix: 'inj',
  chainId: 'injective-1',
  chainName: 'injective',
  displayName: 'Injective Protocol',
  nativeCurrency: 'INJ',
  nativeDecimals: 18,
};

const OSMOSIS_CONFIG: CosmosChainConfig = {
  bech32Prefix: 'osmo',
  chainId: 'osmosis-1',
  chainName: 'osmosis',
  displayName: 'Osmosis',
  nativeCurrency: 'OSMO',
  nativeDecimals: 6,
};

const USER_ADDRESS = 'inj1user000000000000000000000000000000000';
const EXTERNAL_ADDRESS = 'inj1external0000000000000000000000000000';
const CONTRACT_ADDRESS = 'inj1contract0000000000000000000000000000';

function buildSession(
  normalizedData: CosmosTransaction[],
  userAddress: string = USER_ADDRESS
): ProcessingImportSession {
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

function createInjectiveProcessor() {
  return new CosmosProcessor(INJECTIVE_CONFIG);
}

function createOsmosisProcessor() {
  return new CosmosProcessor(OSMOSIS_CONFIG);
}

describe('CosmosProcessor - Fund Flow Direction', () => {
  test('classifies incoming native transfer as deposit', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '1500000000000000000', // 1.5 INJ
        blockHeight: 100,
        currency: 'INJ',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx123',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.from).toBe(EXTERNAL_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);

    // Check structured fields
    expect(transaction.movements.primary.asset).toBe('INJ');
    expect(transaction.movements.primary.amount.amount.toString()).toBe('1500000000000000000');
    expect(transaction.movements.primary.direction).toBe('in');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset).toBe('INJ');
    expect(transaction.movements.inflows[0]?.amount.amount.toString()).toBe('1500000000000000000');
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
  });

  test('classifies outgoing native transfer as withdrawal', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '2000000000000000000', // 2 INJ
        blockHeight: 101,
        currency: 'INJ',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: USER_ADDRESS,
        id: 'tx456',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(EXTERNAL_ADDRESS);

    // Check structured fields
    expect(transaction.movements.primary.asset).toBe('INJ');
    expect(transaction.movements.primary.amount.amount.toString()).toBe('2000000000000000000');
    expect(transaction.movements.primary.direction).toBe('out');
    expect(transaction.movements.inflows).toHaveLength(0);
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.asset).toBe('INJ');
    expect(transaction.movements.outflows[0]?.amount.amount.toString()).toBe('2000000000000000000');
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('classifies self-transfer (incoming and outgoing) as transfer', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '500000000000000000', // 0.5 INJ
        blockHeight: 102,
        currency: 'INJ',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: USER_ADDRESS,
        id: 'tx789',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);

    // Check structured fields - self-transfer shows both in and out
    expect(transaction.movements.primary.asset).toBe('INJ');
    expect(transaction.movements.primary.amount.amount.toString()).toBe('500000000000000000');
    expect(transaction.movements.primary.direction).toBe('neutral'); // Net zero for same asset
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
  });

  test('classifies incoming token transfer as deposit', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '1000000000', // 1000 USDT (normalized, 6 decimals)
        blockHeight: 103,
        currency: 'USDT',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx101',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenAddress: 'inj1usdt000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDT',
        tokenType: 'cw20',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.movements.primary.asset).toBe('USDT');
    expect(transaction.movements.primary.amount.amount.toString()).toBe('1000000000');
    expect(transaction.movements.primary.direction).toBe('in');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.metadata?.tokenAddress).toBe('inj1usdt000000000000000000000000000000000');
  });

  test('classifies outgoing token transfer as withdrawal', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '5000000000', // 5000 USDT
        blockHeight: 104,
        currency: 'USDT',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: USER_ADDRESS,
        id: 'tx102',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenAddress: 'inj1usdt000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDT',
        tokenType: 'cw20',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.movements.primary.asset).toBe('USDT');
    expect(transaction.movements.primary.amount.amount.toString()).toBe('5000000000');
    expect(transaction.movements.primary.direction).toBe('out');
    expect(transaction.operation.type).toBe('withdrawal');
  });
});

describe('CosmosProcessor - Transaction Type Classification', () => {
  test('marks zero-amount transactions as fee', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '0',
        blockHeight: 105,
        currency: 'INJ',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: USER_ADDRESS,
        id: 'tx201',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.movements.primary.amount.amount.toString()).toBe('0');
    expect(transaction.movements.primary.direction).toBe('neutral');
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('fee');
    expect(transaction.metadata?.hasContractInteraction).toBe(false);
  });

  test('classifies dust-amount deposit correctly (below threshold but still a deposit)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '0.000001', // 0.000001 INJ (below 0.00001 threshold)
        blockHeight: 106,
        currency: 'INJ',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx202',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Dust deposits are still deposits (affect balance), but flagged with note
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('dust_amount');
    expect(transaction.note?.message).toContain('Dust deposit');
  });

  test('classifies contract interaction without fund movement as transfer', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '0',
        blockHeight: 107,
        currency: 'INJ',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: USER_ADDRESS,
        id: 'tx203',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenAddress: 'inj1contract0000000000000000000000000000',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

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
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '1000000000000000000',
        blockHeight: 108,
        currency: 'INJ',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: USER_ADDRESS,
        id: 'tx204',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        providerId: 'injective-explorer',
        status: 'failed',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

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

describe('CosmosProcessor - Bridge and IBC Transfers', () => {
  test('detects Peggy bridge deposit', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '1000000000000000000', // 1 INJ
        blockHeight: 200,
        bridgeType: 'peggy',
        currency: 'INJ',
        ethereumReceiver: '0xuser000000000000000000000000000000000000',
        ethereumSender: '0xexternal00000000000000000000000000000000',
        eventNonce: 12345,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx301',
        messageType: '/injective.peggy.v1.MsgSendToInjective',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify bridge classification
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.metadata?.hasBridgeTransfer).toBe(true);
    expect(transaction.metadata?.bridgeType).toBe('peggy');
    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('bridge_transfer');
    expect(transaction.note?.message).toContain('Peggy bridge from Ethereum');
  });

  test('detects Peggy bridge withdrawal', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '2000000000000000000', // 2 INJ
        blockHeight: 201,
        bridgeType: 'peggy',
        currency: 'INJ',
        ethereumReceiver: '0xexternal00000000000000000000000000000000',
        ethereumSender: '0xuser000000000000000000000000000000000000',
        eventNonce: 12346,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: USER_ADDRESS,
        id: 'tx302',
        messageType: '/injective.peggy.v1.MsgSendToEthereum',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify bridge classification
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.metadata?.hasBridgeTransfer).toBe(true);
    expect(transaction.metadata?.bridgeType).toBe('peggy');
    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('bridge_transfer');
    expect(transaction.note?.message).toContain('Peggy bridge to Ethereum');
  });

  test('detects IBC transfer deposit', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '5000000', // 5 OSMO
        blockHeight: 202,
        bridgeType: 'ibc',
        currency: 'OSMO',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx303',
        messageType: '/ibc.applications.transfer.v1.MsgTransfer',
        providerId: 'injective-explorer',
        sourceChannel: 'channel-8',
        sourcePort: 'transfer',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'ibc',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify IBC classification
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.metadata?.hasIbcTransfer).toBe(true);
    expect(transaction.metadata?.hasBridgeTransfer).toBe(true);
    expect(transaction.metadata?.bridgeType).toBe('ibc');
    expect(transaction.metadata?.sourceChannel).toBe('channel-8');
    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('bridge_transfer');
    expect(transaction.note?.message).toContain('IBC transfer from another chain');
  });

  test('detects IBC transfer withdrawal', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '3000000', // 3 OSMO
        blockHeight: 203,
        bridgeType: 'ibc',
        currency: 'OSMO',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: USER_ADDRESS,
        id: 'tx304',
        messageType: '/ibc.applications.transfer.v1.MsgTransfer',
        providerId: 'injective-explorer',
        sourceChannel: 'channel-8',
        sourcePort: 'transfer',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        tokenType: 'ibc',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify IBC classification
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.metadata?.hasIbcTransfer).toBe(true);
    expect(transaction.metadata?.hasBridgeTransfer).toBe(true);
    expect(transaction.metadata?.bridgeType).toBe('ibc');
    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('bridge_transfer');
    expect(transaction.note?.message).toContain('IBC transfer to another chain');
  });
});

describe('CosmosProcessor - Multi-Chain Support', () => {
  test('uses chain-specific native currency for Injective', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '1000000000000000000',
        blockHeight: 300,
        currency: 'INJ',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx401',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.movements.primary.asset).toBe('INJ');
    expect(transaction.blockchain?.name).toBe('injective');
    expect(transaction.fees.total.currency).toBe('INJ');
  });

  test('uses chain-specific native currency for Osmosis', async () => {
    const processor = createOsmosisProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '5000000', // 5 OSMO
        blockHeight: 301,
        currency: 'OSMO',
        feeAmount: '1000',
        feeCurrency: 'OSMO',
        from: EXTERNAL_ADDRESS,
        id: 'tx402',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        providerId: 'mintscan',
        status: 'success',
        timestamp: Date.now(),
        to: 'osmo1user000000000000000000000000000000000',
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData, 'osmo1user000000000000000000000000000000000');
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.movements.primary.asset).toBe('OSMO');
    expect(transaction.blockchain?.name).toBe('osmosis');
    expect(transaction.fees.total.currency).toBe('OSMO');
  });
});

describe('CosmosProcessor - Edge Cases', () => {
  test('handles missing user address in session metadata', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '1000000000000000000',
        blockHeight: 400,
        currency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx501',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData, '');

    const result = await processor.process(session);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('No address provided');
    }
  });

  test('handles case-insensitive address matching', async () => {
    const processor = createInjectiveProcessor();

    const mixedCaseUser = 'INJ1UseR000000000000000000000000000000000';

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '1000000000000000000',
        blockHeight: 401,
        currency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx502',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: mixedCaseUser, // Different case than USER_ADDRESS
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData, USER_ADDRESS);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - should match despite case difference
    expect(transaction.movements.primary.direction).toBe('in');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.operation.type).toBe('deposit');
  });

  test('handles missing fee data gracefully', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '1000000000000000000',
        blockHeight: 402,
        currency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx503',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        tokenType: 'native',
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

    // Check structured fields
    expect(transaction.fees.total.amount.toString()).toBe('0');
    expect(transaction.fees.network?.amount.toString()).toBe('0');
  });

  test('handles transactions with missing optional fields', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '1000000000000000000',
        currency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx504',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        // Missing: blockHeight, blockId, tokenType, messageType, etc.
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toBeDefined();
    if (!result.value[0]) return;

    // Check structured fields
    expect(result.value[0].operation.type).toBe('deposit');
  });
});

describe('CosmosProcessor - Classification Uncertainty', () => {
  test('adds note for complex multi-asset transaction', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '500000000000000000', // 0.5 INJ sent
        blockHeight: 500,
        currency: 'INJ',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: USER_ADDRESS,
        id: 'tx601',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenType: 'native',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Should track outflow
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.inflows).toHaveLength(0);

    // Still classified as withdrawal
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('adds note for contract interaction with zero value', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      {
        amount: '0',
        blockHeight: 501,
        currency: 'INJ',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: USER_ADDRESS,
        id: 'tx602',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        providerId: 'injective-explorer',
        status: 'success',
        timestamp: Date.now(),
        to: CONTRACT_ADDRESS,
        tokenAddress: 'inj1contract0000000000000000000000000000',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Should have uncertainty note
    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('classification_uncertain');
    expect(transaction.note?.message).toContain('Contract interaction');
    expect(transaction.note?.message).toContain('zero/dust value');

    // Still classified as transfer
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
  });
});
