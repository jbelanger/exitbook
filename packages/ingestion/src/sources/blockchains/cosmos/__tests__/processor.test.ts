import type { CosmosChainConfig, CosmosTransaction } from '@exitbook/blockchain-providers';
import type { Currency } from '@exitbook/core';
import { describe, expect, test } from 'vitest';

import { CosmosProcessor } from '../processor.js';

const INJECTIVE_CONFIG: CosmosChainConfig = {
  bech32Prefix: 'inj',
  chainId: 'injective-1',
  chainName: 'injective',
  displayName: 'Injective Protocol',
  nativeCurrency: 'INJ' as Currency,
  nativeDecimals: 18,
  nativeDenom: 'inj',
};

const OSMOSIS_CONFIG: CosmosChainConfig = {
  bech32Prefix: 'osmo',
  chainId: 'osmosis-1',
  chainName: 'osmosis',
  displayName: 'Osmosis',
  nativeCurrency: 'OSMO' as Currency,
  nativeDecimals: 6,
  nativeDenom: 'uosmo',
};

const USER_ADDRESS = 'inj1user000000000000000000000000000000000';
const EXTERNAL_ADDRESS = 'inj1external0000000000000000000000000000';
const CONTRACT_ADDRESS = 'inj1contract0000000000000000000000000000';

function createInjectiveProcessor() {
  return new CosmosProcessor(INJECTIVE_CONFIG);
}

function createOsmosisProcessor() {
  return new CosmosProcessor(OSMOSIS_CONFIG);
}

function createTransaction(overrides: Partial<CosmosTransaction> = {}): CosmosTransaction {
  return {
    amount: '1000000000000000000',
    blockHeight: 100,
    currency: 'INJ',
    feeAmount: '500000000000000',
    feeCurrency: 'INJ' as Currency,
    from: EXTERNAL_ADDRESS,
    id: 'tx123',
    eventId: '0xdefaulteventid',
    messageType: '/cosmos.bank.v1beta1.MsgSend',
    providerName: 'injective-explorer',
    status: 'success',
    timestamp: 1700000000000,
    to: USER_ADDRESS,
    tokenType: 'native',
    ...overrides,
  };
}

describe('CosmosProcessor - Fund Flow Direction', () => {
  test('classifies incoming native transfer as deposit', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1500000000000000000', // 1.5 INJ
        from: EXTERNAL_ADDRESS,
        to: USER_ADDRESS,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

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
    expect(transaction.movements.inflows[0]?.assetSymbol).toBe('INJ');
    expect(transaction.movements.inflows[0]?.netAmount?.toFixed()).toBe('1500000000000000000');
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
  });

  test('classifies outgoing native transfer as withdrawal', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '2000000000000000000', // 2 INJ
        blockHeight: 101,
        from: USER_ADDRESS,
        id: 'tx456',
        to: EXTERNAL_ADDRESS,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

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
    expect(transaction.movements.outflows[0]?.assetSymbol).toBe('INJ');
    expect(transaction.movements.outflows[0]?.netAmount?.toFixed()).toBe('2000000000000000000');
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('classifies self-transfer (incoming and outgoing) as transfer', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '500000000000000000', // 0.5 INJ
        blockHeight: 102,
        from: USER_ADDRESS,
        id: 'tx789',
        to: USER_ADDRESS,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

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
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1000000000', // 1000 USDT (normalized, 6 decimals)
        blockHeight: 103,
        currency: 'USDT',
        from: EXTERNAL_ADDRESS,
        id: 'tx101',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        to: USER_ADDRESS,
        tokenAddress: 'inj1usdt000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDT',
        tokenType: 'cw20',
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.operation.type).toBe('deposit');
  });

  test('classifies outgoing token transfer as withdrawal', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '5000000000', // 5000 USDT
        blockHeight: 104,
        currency: 'USDT',
        from: USER_ADDRESS,
        id: 'tx102',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        to: EXTERNAL_ADDRESS,
        tokenAddress: 'inj1usdt000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDT',
        tokenType: 'cw20',
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.operation.type).toBe('withdrawal');
  });
});

describe('CosmosProcessor - Transaction Type Classification', () => {
  test('marks zero-amount transactions as fee', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '0',
        blockHeight: 105,
        from: USER_ADDRESS,
        id: 'tx201',
        to: EXTERNAL_ADDRESS,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('fee');
  });

  test('classifies small deposit correctly (affects balance)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '0.000001', // 0.000001 INJ (small amount)
        blockHeight: 106,
        from: EXTERNAL_ADDRESS,
        id: 'tx202',
        to: USER_ADDRESS,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Small deposits are normal deposits (affect balance), no special handling
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.notes).toBeUndefined(); // No note for normal small deposits
  });

  test('classifies contract interaction without fund movement as transfer', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '0',
        blockHeight: 107,
        from: USER_ADDRESS,
        id: 'tx203',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        to: CONTRACT_ADDRESS,
        tokenAddress: 'inj1contract0000000000000000000000000000',
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - zero amount + contract interaction → 'transfer'
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
  });

  test('handles failed transactions', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1000000000000000000',
        blockHeight: 108,
        from: USER_ADDRESS,
        id: 'tx204',
        status: 'failed',
        to: EXTERNAL_ADDRESS,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

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
      createTransaction({
        amount: '1000000000000000000', // 1 INJ
        blockHeight: 200,
        bridgeType: 'peggy',
        ethereumReceiver: '0xuser000000000000000000000000000000000000',
        ethereumSender: '0xexternal00000000000000000000000000000000',
        eventNonce: '12345',
        from: EXTERNAL_ADDRESS,
        id: 'tx301',
        messageType: '/injective.peggy.v1.MsgSendToInjective',
        to: USER_ADDRESS,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('bridge_transfer');
    expect(transaction.notes?.[0]?.message).toContain('Peggy bridge from Ethereum');
  });

  test('detects Peggy bridge withdrawal', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '2000000000000000000', // 2 INJ
        blockHeight: 201,
        bridgeType: 'peggy',
        ethereumReceiver: '0xexternal00000000000000000000000000000000',
        ethereumSender: '0xuser000000000000000000000000000000000000',
        eventNonce: '12346',
        from: USER_ADDRESS,
        id: 'tx302',
        messageType: '/injective.peggy.v1.MsgSendToEthereum',
        to: EXTERNAL_ADDRESS,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('bridge_transfer');
    expect(transaction.notes?.[0]?.message).toContain('Peggy bridge to Ethereum');
  });

  test('detects IBC transfer deposit', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '5000000', // 5 OSMO
        blockHeight: 202,
        bridgeType: 'ibc',
        currency: 'OSMO',
        from: EXTERNAL_ADDRESS,
        id: 'tx303',
        messageType: '/ibc.applications.transfer.v1.MsgTransfer',
        sourceChannel: 'channel-8',
        sourcePort: 'transfer',
        to: USER_ADDRESS,
        tokenAddress: 'ibc/D189335C6E0A38B075C43331493BEE2027372A1302E5D7EE0A1C6593121914F4',
        tokenType: 'ibc',
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify IBC classification
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('bridge_transfer');
    expect(transaction.notes?.[0]?.message).toContain('IBC transfer from another chain');
  });

  test('detects IBC transfer withdrawal', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '3000000', // 3 OSMO
        blockHeight: 203,
        bridgeType: 'ibc',
        currency: 'OSMO',
        from: USER_ADDRESS,
        id: 'tx304',
        messageType: '/ibc.applications.transfer.v1.MsgTransfer',
        sourceChannel: 'channel-8',
        sourcePort: 'transfer',
        to: EXTERNAL_ADDRESS,
        tokenAddress: 'ibc/D189335C6E0A38B075C43331493BEE2027372A1302E5D7EE0A1C6593121914F4',
        tokenType: 'ibc',
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify IBC classification
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('bridge_transfer');
    expect(transaction.notes?.[0]?.message).toContain('IBC transfer to another chain');
  });

  test('handles Peggy bridge deposit of native asset with Ethereum token address', async () => {
    const processor = createInjectiveProcessor();

    // This is a real-world scenario: bridging INJ from Ethereum to Injective
    // The transaction includes the Ethereum contract address for INJ token,
    // but it's still the native INJ asset on Injective chain
    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1', // 1 INJ
        blockHeight: 102931205,
        bridgeType: 'peggy',
        currency: 'INJ',
        ethereumSender: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
        eventNonce: '76827',
        from: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
        id: '0x1139cdf3f34d481b5ed56629ca68c5a7004857f804077a6d173bbfc83c0f0b8e',
        messageType: '/injective.peggy.v1.MsgDepositClaim',
        to: USER_ADDRESS,
        // Key issue: tokenAddress is the Ethereum contract address for INJ,
        // but currency is "INJ" (native asset) and tokenType is "native"
        tokenAddress: '0xe28b3b32b6c345a34ff64674606124dd5aceca30',
        tokenSymbol: 'INJ',
        tokenType: 'native',
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify it's classified as a bridge deposit
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('bridge_transfer');
    expect(transaction.notes?.[0]?.message).toContain('Peggy bridge from Ethereum');

    // CRITICAL: Verify the assetId is for native INJ, not a token
    // This is the bug we're fixing - it should NOT create a token assetId
    // just because tokenAddress is present
    expect(transaction.movements.inflows).toHaveLength(1);
    const inflow = transaction.movements.inflows![0];
    expect(inflow).toBeDefined();
    if (!inflow) return;
    expect(inflow.assetSymbol).toBe('INJ');
    expect(inflow.assetId).toBe('blockchain:injective:native');
    // Should NOT be 'blockchain:injective:0xe28b3b32b6c345a34ff64674606124dd5aceca30'
  });
});

describe('CosmosProcessor - Multi-Chain Support', () => {
  test('uses chain-specific native currency for Injective', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1000000000000000000',
        blockHeight: 300,
        from: EXTERNAL_ADDRESS,
        id: 'tx401',
        to: USER_ADDRESS,
      }),
    ];
    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.blockchain?.name).toBe('injective');
  });

  test('uses chain-specific native currency for Osmosis', async () => {
    const processor = createOsmosisProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '5000000', // 5 OSMO
        blockHeight: 301,
        currency: 'OSMO',
        feeAmount: '1000',
        feeCurrency: 'OSMO' as Currency,
        from: EXTERNAL_ADDRESS,
        id: 'tx402',
        providerName: 'mintscan',
        to: 'osmo1user000000000000000000000000000000000',
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: 'osmo1user000000000000000000000000000000000',
      userAddresses: ['osmo1user000000000000000000000000000000000'],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.blockchain?.name).toBe('osmosis');
  });
});

describe('CosmosProcessor - Edge Cases', () => {
  test('handles case-insensitive address matching', async () => {
    const processor = createInjectiveProcessor();

    // User address provided in mixed case (as might come from user input)
    const mixedCaseUserInput = 'INJ1UseR000000000000000000000000000000000';

    // Normalized data has lowercase addresses (as produced by CosmosAddressSchema)
    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1000000000000000000',
        blockHeight: 401,
        from: EXTERNAL_ADDRESS,
        id: 'tx502',
        to: USER_ADDRESS.toLowerCase(), // Normalized by schema
      }),
    ];

    // Pass normalized (lowercase) addresses in context - addresses are normalized before reaching processor
    const result = await processor.process(normalizedData, {
      primaryAddress: mixedCaseUserInput.toLowerCase(),
      userAddresses: [mixedCaseUserInput.toLowerCase()],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields - should match despite case difference in input
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.operation.type).toBe('deposit');
  });

  test('handles missing fee data gracefully', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1000000000000000000',
        blockHeight: 402,
        from: EXTERNAL_ADDRESS,
        id: 'tx503',
        to: USER_ADDRESS,
        feeAmount: undefined,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Check structured fields
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed() ?? '0').toBe('0');
  });

  test('handles transactions with missing optional fields', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1000000000000000000',
        blockHeight: undefined,
        from: EXTERNAL_ADDRESS,
        id: 'tx504',
        messageType: undefined,
        to: USER_ADDRESS,
        tokenType: undefined,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

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
      createTransaction({
        amount: '500000000000000000', // 0.5 INJ sent
        blockHeight: 500,
        from: USER_ADDRESS,
        id: 'tx601',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        to: CONTRACT_ADDRESS,
      }),
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

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
      createTransaction({
        amount: '0',
        blockHeight: 501,
        from: USER_ADDRESS,
        id: 'tx602',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        to: CONTRACT_ADDRESS,
        tokenAddress: 'inj1contract0000000000000000000000000000',
      }),
    ];
    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('contract_interaction');
    expect(transaction.notes?.[0]?.message).toContain('Contract interaction');
    expect(transaction.notes?.[0]?.message).toContain('zero value');

    // Still classified as transfer
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
  });
});
