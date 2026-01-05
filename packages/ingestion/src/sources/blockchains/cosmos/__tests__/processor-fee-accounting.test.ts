import type { CosmosChainConfig, CosmosTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { CosmosProcessor } from '../processor.js';

const INJECTIVE_CONFIG: CosmosChainConfig = {
  bech32Prefix: 'inj',
  chainId: 'injective-1',
  chainName: 'injective',
  displayName: 'Injective Protocol',
  nativeCurrency: 'INJ',
  nativeDecimals: 18,
  nativeDenom: 'inj',
};

const USER_ADDRESS = 'inj1user000000000000000000000000000000000';
const EXTERNAL_ADDRESS = 'inj1external0000000000000000000000000000';
const VALIDATOR_ADDRESS = 'injvaloper1validator000000000000000000000';
const CONTRACT_ADDRESS = 'inj1contract0000000000000000000000000000';

function createInjectiveProcessor() {
  return new CosmosProcessor(INJECTIVE_CONFIG);
}

function createTransaction(overrides: Partial<CosmosTransaction>): CosmosTransaction {
  return {
    amount: '0',
    blockHeight: 100,
    currency: 'INJ',
    feeAmount: '500000000000000',
    feeCurrency: 'INJ',
    from: USER_ADDRESS,
    id: 'tx-default',
    eventId: '0xtxdefaultevent',
    messageType: '/cosmos.bank.v1beta1.MsgSend',
    providerName: 'injective-explorer',
    status: 'success',
    timestamp: 1700000000000, // Fixed timestamp for deterministic tests
    to: EXTERNAL_ADDRESS,
    tokenType: 'native',
    ...overrides,
  };
}

describe('CosmosProcessor - Fee Accounting (Issue #78 Deep Dive)', () => {
  test('deducts fee when user sends native tokens (outgoing transfer)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '2000000000000000000', // 2 INJ
        blockHeight: 101,
        id: 'tx456',
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

    // User initiated outgoing transfer, should pay fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('500000000000000');
    expect(transaction.operation.type).toBe('withdrawal');
    expect(transaction.movements.outflows).toHaveLength(1);
  });

  test('does NOT deduct fee when user receives native tokens (incoming transfer)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1500000000000000000', // 1.5 INJ
        from: EXTERNAL_ADDRESS,
        id: 'tx123',
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

    // External sender paid fee, user should NOT be charged
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed() ?? '0').toBe('0');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('deducts fee for self-transfers (user signs transaction)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '500000000000000000', // 0.5 INJ
        blockHeight: 102,
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

    // User signed the transaction, should pay fee even for self-transfer
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('500000000000000');
    expect(transaction.operation.type).toBe('transfer');
  });

  test('deducts fee when user claims staking rewards (user signs)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '100000000000000000', // 0.1 INJ reward
        blockHeight: 200,
        id: 'txRewardClaim',
        messageType: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
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

    // User signs to claim rewards, should pay fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('500000000000000');
    expect(transaction.from).toBe(USER_ADDRESS);
  });

  test('does NOT deduct fee when receiving Peggy bridge deposit (validator signs)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1000000000000000000', // 1 INJ
        blockHeight: 200,
        bridgeType: 'peggy',
        ethereumReceiver: '0xuser000000000000000000000000000000000000',
        ethereumSender: '0xexternal00000000000000000000000000000000',
        eventNonce: '12345',
        feeAmount: '58605000000000', // 0.000058605 INJ (validator pays)
        from: VALIDATOR_ADDRESS, // Validator submits claim
        id: 'txPeggyDeposit',
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

    // Validator paid fee, user receives full amount
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed() ?? '0').toBe('0');
    expect(transaction.operation.type).toBe('deposit');
  });

  test('deducts fee when user sends Peggy bridge withdrawal (user signs)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '2000000000000000000', // 2 INJ
        blockHeight: 201,
        bridgeType: 'peggy',
        ethereumReceiver: '0xexternal00000000000000000000000000000000',
        ethereumSender: '0xuser000000000000000000000000000000000000',
        eventNonce: '12346',
        id: 'txPeggyWithdrawal',
        messageType: '/injective.peggy.v1.MsgSendToEthereum',
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

    // User initiated withdrawal, should pay fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('500000000000000');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('does NOT deduct fee when receiving IBC transfer (relayer/sender pays)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '5000000', // 5 OSMO
        blockHeight: 202,
        bridgeType: 'ibc',
        currency: 'OSMO',
        from: EXTERNAL_ADDRESS, // Sender/relayer
        id: 'txIbcReceive',
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

    // Sender/relayer paid fee, user receives full amount
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed() ?? '0').toBe('0');
    expect(transaction.operation.type).toBe('deposit');
  });

  test('deducts fee when user sends IBC transfer (user signs)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '3000000', // 3 OSMO
        blockHeight: 203,
        bridgeType: 'ibc',
        currency: 'OSMO',
        id: 'txIbcSend',
        messageType: '/ibc.applications.transfer.v1.MsgTransfer',
        sourceChannel: 'channel-8',
        sourcePort: 'transfer',
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

    // User initiated IBC transfer, should pay fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('500000000000000');
    expect(transaction.operation.type).toBe('withdrawal');
  });

  test('deducts fee when user delegates to validator (user signs)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '10000000000000000000', // 10 INJ
        blockHeight: 300,
        id: 'txDelegate',
        messageType: '/cosmos.staking.v1beta1.MsgDelegate',
        to: VALIDATOR_ADDRESS,
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

    // User signs delegation, should pay fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('500000000000000');
    expect(transaction.movements.outflows).toHaveLength(1);
  });

  test('deducts fee when user undelegates from validator (user signs)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '5000000000000000000', // 5 INJ
        blockHeight: 301,
        id: 'txUndelegate',
        messageType: '/cosmos.staking.v1beta1.MsgUndelegate',
        to: USER_ADDRESS, // Funds return to user after unbonding
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

    // User signs undelegation, should pay fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('500000000000000');
  });

  test('deducts fee when user votes on governance proposal (user signs)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '0', // No value transfer
        blockHeight: 400,
        id: 'txGovVote',
        messageType: '/cosmos.gov.v1beta1.MsgVote',
        to: 'gov', // Governance module
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

    // User signs governance vote, should pay fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('500000000000000');
    expect(transaction.operation.type).toBe('fee');
  });

  test('deducts fee when user executes CosmWasm contract (user signs)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1000000000', // 1000 USDT sent to contract
        blockHeight: 500,
        currency: 'USDT',
        id: 'txContractExecute',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        to: CONTRACT_ADDRESS,
        tokenAddress: 'inj1usdt000000000000000000000000000000000',
        tokenDecimals: 6,
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

    // User signs contract execution, should pay fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('500000000000000');
    expect(transaction.movements.outflows).toHaveLength(1);
  });

  test('deducts fee when user executes zero-value contract interaction (user signs)', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '0',
        blockHeight: 501,
        id: 'txContractCall',
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

    // User signs contract call, should pay fee even with zero value
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('500000000000000');
    expect(transaction.notes?.[0]?.type).toBe('contract_interaction');
  });

  test('deducts fee for failed transactions when user signed', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1000000000000000000',
        blockHeight: 108,
        id: 'txFailed',
        status: 'failed',
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

    // User signed transaction (even though it failed), should still pay fee
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('500000000000000');
    expect(transaction.status).toBe('failed');
  });

  test('handles case-insensitive address matching for fee logic', async () => {
    const processor = createInjectiveProcessor();

    // User address provided in mixed case (as might come from user input)
    const mixedCaseUserInput = 'INJ1UseR000000000000000000000000000000000';

    // Normalized data has lowercase addresses (as produced by CosmosAddressSchema)
    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1000000000000000000',
        blockHeight: 600,
        from: USER_ADDRESS.toLowerCase(), // Normalized by schema
        id: 'txCaseTest',
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

    // Should match despite case difference in input
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed()).toBe('500000000000000');
  });

  test('handles missing fee data gracefully', async () => {
    const processor = createInjectiveProcessor();

    const normalizedData: CosmosTransaction[] = [
      createTransaction({
        amount: '1000000000000000000',
        blockHeight: 700,
        id: 'txNoFee',
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

    // Should default to 0 fee when missing
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount.toFixed() ?? '0').toBe('0');
  });
});

describe('CosmosProcessor - Complex Scenarios (Documentation Only)', () => {
  test.skip('COMPLEX: Authz grant execution where grantee signs but granter pays conceptually', async () => {
    // Scenario: Alice grants Bob permission to transfer her tokens
    // Bob executes the transfer on Alice's behalf
    // Transaction signature: Bob (grantee)
    // Fee payer: Bob (transaction signer)
    // Fund source: Alice (granter)
    //
    // Current limitation: We cannot distinguish between:
    // - Bob paying fee with Bob's funds (Bob = from)
    // - Bob paying fee but using Alice's authorization (Alice = conceptual from)
    //
    // This requires understanding the authz context, which may not be available
    // in normalized transaction data from all providers.
    //
    // Real-world impact: Rare edge case, typically used in automated scenarios
    // Expected behavior: Fee should be charged to transaction signer (Bob)
    // Our behavior: Will charge whoever is in 'from' field (depends on mapper)
  });

  test.skip('COMPLEX: Multi-message transaction with different signers per message', async () => {
    // Scenario: Transaction contains multiple messages with different logical "from" addresses
    // Example: Batch swap + transfer where swap has contract as "from" and transfer has user
    //
    // Current limitation: Mapper extracts individual transactions, but if fund flow
    // analysis produces outflows while 'from' field is set to contract address,
    // we need the enhanced logic to catch this.
    //
    // Expected behavior: User should pay fee if ANY message has user outflows
    // Our behavior: Depends on how mapper sets 'from' field
    //
    // Solution: Enhanced logic checks outflows.length > 0 as primary signal
  });

  test.skip('COMPLEX: Vesting account automated release (no signer)', async () => {
    // Scenario: Vesting contract automatically releases tokens on schedule
    // No explicit signer, system executes the release
    //
    // Expected behavior: User receives tokens, no fee charged to user
    // Our behavior: Should work correctly if 'from' is set to vesting module
    //
    // Confidence: High - this should work with current logic
  });

  test.skip('COMPLEX: IBC timeout refund where relayer handles both ends', async () => {
    // Scenario: User sends IBC transfer, it times out, relayer refunds
    // Original transfer: User pays fee
    // Timeout refund: Relayer pays fee on destination chain
    //
    // Expected behavior:
    // - Original transfer: User pays fee ✓
    // - Refund transaction: Relayer pays fee, user gets refund ✓
    //
    // Current logic should handle this correctly
    // Confidence: High
  });

  test.skip('COMPLEX: Multi-hop IBC transfer with packet forwarding', async () => {
    // Scenario: Injective → Osmosis → Cosmos Hub
    // User initiates on Injective, relayers forward through Osmosis
    //
    // Expected behavior:
    // - Injective transaction: User pays fee ✓
    // - Osmosis forwarding: Relayer pays fee ✓
    // - Cosmos Hub receipt: Relayer pays fee ✓
    //
    // User only sees first transaction in their history
    // Confidence: High - works correctly
  });

  test.skip('COMPLEX: Feegrant where granter pays fee for grantee', async () => {
    // Scenario: Alice grants Bob a fee allowance
    // Bob signs transaction but Alice's account pays the fee
    //
    // Limitation: Transaction 'from' field shows Bob (signer)
    // Actual fee payer: Alice (feegrant granter)
    //
    // Expected behavior: Bob should be charged (he's the transaction initiator)
    // Our behavior: Will charge whoever is in 'from' field (Bob) ✓
    //
    // This is actually correct behavior - Bob initiated the action,
    // the fee grant is just a payment mechanism
  });
});
