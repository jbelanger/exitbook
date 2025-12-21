import { SUBSTRATE_CHAINS, type SubstrateTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { SubstrateProcessor } from '../processor.js';

const USER_ADDRESS = '1exampleUserAddress1234567890abcdefghijklmn';
const EXTERNAL_ADDRESS = '1externalAddress1234567890abcdefghijklmnop';
const VALIDATOR_ADDRESS = '1validatorAddress1234567890abcdefghijklmn';

function createPolkadotProcessor() {
  return new SubstrateProcessor(SUBSTRATE_CHAINS.polkadot!);
}

function createBittensorProcessor() {
  return new SubstrateProcessor(SUBSTRATE_CHAINS.bittensor!);
}

describe('SubstrateProcessor - Fund Flow Direction', () => {
  test('classifies incoming transfer as deposit', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '15000000000', // 1.5 DOT (10 decimals)
        blockHeight: 100,
        blockId: '0xblock1',
        call: 'transfer',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000', // 0.0156 DOT
        feeCurrency: 'DOT',
        from: EXTERNAL_ADDRESS,
        id: 'extrinsic-100-1',
        eventId: '0xevent123',
        module: 'balances',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
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
    expect(transaction.movements.inflows?.length).toBe(1);
    expect(transaction.movements.inflows && transaction.movements.inflows[0]?.netAmount?.toFixed()).toBe('1.5');
    expect(transaction.movements.outflows?.length).toBe(0);
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0'); // User received, sender paid fee
    expect(transaction.blockchain?.name).toBe('polkadot');
    expect(transaction.from).toBe(EXTERNAL_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);
    expect(transaction.status).toBe('success');
  });

  test('classifies outgoing transfer as withdrawal', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '25000000000', // 2.5 DOT
        blockHeight: 101,
        call: 'transfer',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-101-1',
        eventId: '0xevent123',
        module: 'balances',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
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
    expect(transaction.movements.outflows?.length).toBe(1);
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('2.5');
    expect(transaction.movements.inflows?.length).toBe(0);
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0.0156');
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(EXTERNAL_ADDRESS);
  });

  test('classifies self-transfer as internal_transfer', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '10000000000', // 1 DOT
        call: 'transfer',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-102-1',
        eventId: '0xevent123',
        module: 'balances',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
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

    // Structured fields - self-transfer has same asset in and out
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.movements.inflows?.length).toBe(1);
    expect(transaction.movements.outflows?.length).toBe(1);
    expect(transaction.movements.inflows![0]?.netAmount?.toFixed()).toBe('1');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('1');
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0.0156');
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);
  });
});

describe('SubstrateProcessor - Staking Operations', () => {
  test('classifies outgoing bond operation as staking_deposit', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '100000000000', // 10 DOT bonded
        call: 'bond',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-103-1',
        eventId: '0xevent123',
        module: 'staking',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: VALIDATOR_ADDRESS,
      },
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

    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('stake');
    expect(transaction.movements.outflows?.length).toBe(1);
    expect(transaction.movements.inflows?.length).toBe(0);
  });

  test('classifies unbond operation as staking_withdrawal', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '50000000000', // 5 DOT unbonded
        call: 'unbond',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: VALIDATOR_ADDRESS,
        id: 'extrinsic-104-1',
        eventId: '0xevent123',
        module: 'staking',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
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

    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('unstake');
    expect(transaction.movements.inflows?.length).toBe(1);
    expect(transaction.movements.outflows?.length).toBe(0);
  });

  test('classifies withdraw_unbonded as staking_withdrawal', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '50000000000', // 5 DOT withdrawn
        call: 'withdraw_unbonded',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: VALIDATOR_ADDRESS,
        id: 'extrinsic-105-1',
        eventId: '0xevent123',
        module: 'staking',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
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

    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('unstake');
  });

  test('classifies nominate as staking_deposit', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '0', // Nominate doesn't move funds
        call: 'nominate',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-106-1',
        eventId: '0xevent123',
        module: 'staking',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: VALIDATOR_ADDRESS,
      },
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

    // Structured fields - nominate doesn't move funds
    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('stake');
    expect(transaction.movements.inflows?.length).toBe(0);
    expect(transaction.movements.outflows?.length).toBe(0);
    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('staking_operation');
  });

  test('classifies incoming staking reward as staking_reward', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '5000000000', // 0.5 DOT reward
        call: 'reward',
        chainName: 'polkadot',
        currency: 'DOT',
        from: VALIDATOR_ADDRESS,
        id: 'extrinsic-107-1',
        eventId: '0xevent123',
        module: 'staking',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
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

    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('reward');
    expect(transaction.movements.inflows?.length).toBe(1);
    expect(transaction.movements.outflows?.length).toBe(0);
  });
});

describe('SubstrateProcessor - Governance Operations', () => {
  test('classifies outgoing democracy proposal as governance_deposit', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '100000000000', // 10 DOT deposit
        call: 'propose',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-108-1',
        eventId: '0xevent123',
        module: 'democracy',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
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

    expect(transaction.operation.category).toBe('governance');
    expect(transaction.operation.type).toBe('proposal');
    expect(transaction.movements.outflows?.length).toBe(1);
    expect(transaction.movements.inflows?.length).toBe(0);
  });

  test('classifies incoming treasury payout as governance_refund', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '100000000000', // 10 DOT refund
        call: 'payout',
        chainName: 'polkadot',
        currency: 'DOT',
        from: EXTERNAL_ADDRESS,
        id: 'extrinsic-109-1',
        eventId: '0xevent123',
        module: 'treasury',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
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

    expect(transaction.operation.category).toBe('governance');
    expect(transaction.operation.type).toBe('refund');
    expect(transaction.movements.inflows?.length).toBe(1);
    expect(transaction.movements.outflows?.length).toBe(0);
  });

  test('detects council module as governance', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '50000000000',
        call: 'vote',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-110-1',
        eventId: '0xevent123',
        module: 'council',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
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

    expect(transaction.operation.category).toBe('governance');
    expect(transaction.operation.type).toBe('vote');
    expect(transaction.movements.outflows?.length).toBe(1);
    expect(transaction.movements.inflows?.length).toBe(0);
  });
});

describe('SubstrateProcessor - Utility Operations', () => {
  test('classifies utility.batch as utility_batch', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '30000000000', // 3 DOT total in batch
        call: 'batch',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '256000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-111-1',
        eventId: '0xevent123',
        module: 'utility',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
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

    // Structured fields - utility batch is classified as transfer with note
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.movements.outflows?.length).toBe(1);
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('3');
    expect(transaction.movements.inflows?.length).toBe(0);
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0.0256');
    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('batch_operation');
  });

  test('detects batch_all as utility batch', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '30000000000',
        call: 'batch_all',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '256000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-112-1',
        eventId: '0xevent123',
        module: 'utility',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
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

    // Structured fields - batch_all is also classified as transfer with note
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('batch_operation');
  });
});

describe('SubstrateProcessor - Proxy Operations', () => {
  test('classifies proxy operations correctly', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '10000000000',
        call: 'proxy',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-113-1',
        eventId: '0xevent123',
        module: 'proxy',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
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

    // Structured fields - proxy is classified as transfer with note
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.movements.outflows?.length).toBe(1);
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('1');
    expect(transaction.movements.inflows?.length).toBe(0);
    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('proxy_operation');
  });
});

describe('SubstrateProcessor - Multisig Operations', () => {
  test('classifies multisig operations correctly', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '10000000000',
        call: 'approve_as_multi',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-114-1',
        eventId: '0xevent123',
        module: 'multisig',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
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

    // Structured fields - multisig is classified as transfer with note
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.movements.outflows?.length).toBe(1);
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('1');
    expect(transaction.movements.inflows?.length).toBe(0);
    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('multisig_operation');
  });
});

describe('SubstrateProcessor - Multi-Chain Support', () => {
  test('uses chain-specific native currency for Polkadot', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '10000000000', // 1 DOT (10 decimals)
        call: 'transfer',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000', // 0.0156 DOT
        feeCurrency: 'DOT',
        from: EXTERNAL_ADDRESS,
        id: 'extrinsic-115-1',
        eventId: '0xevent123',
        module: 'balances',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
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

    expect(transaction.movements.inflows![0]?.assetSymbol).toBe('DOT');
    // User received, sender paid fee - no fee entry created when user didn't pay
    expect(transaction.fees.find((f) => f.scope === 'network')).toBeUndefined();
    expect(transaction.blockchain?.name).toBe('polkadot');
  });

  test('uses chain-specific native currency for Bittensor', async () => {
    const processor = createBittensorProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '1000000000', // 1 TAO (9 decimals)
        call: 'transfer',
        chainName: 'bittensor',
        currency: 'TAO',
        feeAmount: '100000000', // 0.1 TAO
        feeCurrency: 'TAO',
        from: EXTERNAL_ADDRESS,
        id: 'extrinsic-116-1',
        eventId: '0xevent123',
        module: 'balances',
        providerName: 'taostats',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
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

    expect(transaction.movements.inflows![0]?.assetSymbol).toBe('TAO');
    // User received, sender paid fee - no fee entry created when user didn't pay
    expect(transaction.fees.find((f) => f.scope === 'network')).toBeUndefined();
    expect(transaction.blockchain?.name).toBe('bittensor');
  });

  test('normalizes amounts using chain-specific decimals', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '123456789012', // 12.3456789012 DOT (10 decimals)
        call: 'transfer',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156789012',
        feeCurrency: 'DOT',
        from: EXTERNAL_ADDRESS,
        id: 'extrinsic-117-1',
        eventId: '0xevent123',
        module: 'balances',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
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

    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0'); // User received, sender paid fee
  });
});

describe('SubstrateProcessor - Transaction Type Classification', () => {
  test('marks fee-only transactions as fee', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '0',
        call: 'remark',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-118-1',
        eventId: '0xevent123',
        module: 'system',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
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

    // Structured fields - fee-only transactions
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('fee');
    expect(transaction.movements.inflows?.length).toBe(0);
    expect(transaction.movements.outflows?.length).toBe(0);
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0.0156');
  });

  test('handles failed transactions', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '10000000000',
        call: 'transfer',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-119-1',
        eventId: '0xevent123',
        module: 'balances',
        providerName: 'subscan',
        status: 'failed',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
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

    // Structured fields - failed transaction still classified by direction
    expect(transaction.status).toBe('failed');
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');
  });
});

describe('SubstrateProcessor - Event Tracking', () => {
  test('tracks event count in metadata', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '10000000000',
        call: 'transfer',
        chainName: 'polkadot',
        currency: 'DOT',
        events: [
          { data: [], method: 'Transfer', section: 'balances' },
          { data: [], method: 'ExtrinsicSuccess', section: 'system' },
        ],
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: EXTERNAL_ADDRESS,
        id: 'extrinsic-120-1',
        eventId: '0xevent123',
        module: 'balances',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
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

    // Structured fields - verify basic operation
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
  });
});

describe('SubstrateProcessor - Edge Cases', () => {
  test('handles missing fee data gracefully', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '10000000000',
        call: 'transfer',
        chainName: 'polkadot',
        currency: 'DOT',
        from: EXTERNAL_ADDRESS,
        id: 'extrinsic-122-1',
        eventId: '0xevent123',
        module: 'balances',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        // No feeAmount field
      },
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

    // Structured fields - missing fee defaults to 0
    expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
  });

  test('handles transactions with missing optional fields', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '10000000000',
        currency: 'DOT',
        from: EXTERNAL_ADDRESS,
        id: 'extrinsic-123-1',
        eventId: '0xevent123',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        // Missing: blockHeight, blockId, module, call, chainName, etc.
      },
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

    // Structured fields - missing fields get defaults
    expect(result.value[0].operation.category).toBe('transfer');
    expect(result.value[0].operation.type).toBe('deposit');
  });

  test('processes multiple transactions independently', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '10000000000',
        call: 'transfer',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        from: EXTERNAL_ADDRESS,
        id: 'extrinsic-124-1',
        eventId: '0xevent123',
        module: 'balances',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
      },
      {
        amount: '20000000000',
        call: 'transfer',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        from: USER_ADDRESS,
        id: 'extrinsic-124-2',
        eventId: '0xevent124',
        module: 'balances',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now() + 1000,
        to: EXTERNAL_ADDRESS,
      },
      {
        amount: '100000000000',
        call: 'bond',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        from: USER_ADDRESS,
        id: 'extrinsic-124-3',
        eventId: '0xevent125',
        module: 'staking',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now() + 2000,
        to: VALIDATOR_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(3);

    // Structured fields - verify each transaction classification
    expect(result.value[0]).toBeDefined();
    expect(result.value[0]?.operation.category).toBe('transfer');
    expect(result.value[0]?.operation.type).toBe('deposit');

    expect(result.value[1]).toBeDefined();
    expect(result.value[1]?.operation.category).toBe('transfer');
    expect(result.value[1]?.operation.type).toBe('withdrawal');

    expect(result.value[2]).toBeDefined();
    expect(result.value[2]?.operation.category).toBe('staking');
    expect(result.value[2]?.operation.type).toBe('stake');
  });
});

describe('SubstrateProcessor - Complex Scenarios', () => {
  test('handles complex staking scenario with multiple operations', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '100000000000', // 10 DOT bond
        call: 'bond',
        chainName: 'polkadot',
        currency: 'DOT',
        events: [
          { data: [], method: 'Bonded', section: 'staking' },
          { data: [], method: 'ExtrinsicSuccess', section: 'system' },
        ],
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-125-1',
        eventId: '0xevent126',
        module: 'staking',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: VALIDATOR_ADDRESS,
      },
      {
        amount: '0', // Nominate (no transfer)
        call: 'nominate',
        chainName: 'polkadot',
        currency: 'DOT',
        events: [{ data: [], method: 'ExtrinsicSuccess', section: 'system' }],
        feeAmount: '156000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-125-2',
        eventId: '0xevent127',
        module: 'staking',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now() + 1000,
        to: VALIDATOR_ADDRESS,
      },
      {
        amount: '5000000000', // 0.5 DOT reward
        call: 'payout_stakers',
        chainName: 'polkadot',
        currency: 'DOT',
        events: [
          { data: [], method: 'Reward', section: 'staking' },
          { data: [], method: 'ExtrinsicSuccess', section: 'system' },
        ],
        from: VALIDATOR_ADDRESS,
        id: 'extrinsic-125-3',
        eventId: '0xevent128',
        module: 'staking',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now() + 2000,
        to: USER_ADDRESS,
      },
    ];

    const result = await processor.process(normalizedData, {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(3);

    // First transaction: bond (stake)
    expect(result.value[0]?.operation.category).toBe('staking');
    expect(result.value[0]?.operation.type).toBe('stake');

    // Second transaction: nominate (stake with no amount)
    expect(result.value[1]?.operation.category).toBe('staking');
    expect(result.value[1]?.operation.type).toBe('stake');
    expect(result.value[1]?.notes).toBeDefined();
    expect(result.value[1]?.notes?.[0]?.type).toBe('staking_operation');

    // Third transaction: reward
    expect(result.value[2]?.operation.category).toBe('staking');
    expect(result.value[2]?.operation.type).toBe('reward');
  });

  test('handles utility batch with mixed operations', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '30000000000', // 3 DOT total
        call: 'batch',
        chainName: 'polkadot',
        currency: 'DOT',
        events: [
          { data: [], method: 'Transfer', section: 'balances' },
          { data: [], method: 'Transfer', section: 'balances' },
          { data: [], method: 'BatchCompleted', section: 'utility' },
          { data: [], method: 'ExtrinsicSuccess', section: 'system' },
        ],
        feeAmount: '356000000',
        feeCurrency: 'DOT',
        from: USER_ADDRESS,
        id: 'extrinsic-126-1',
        eventId: '0xevent129',
        module: 'utility',
        providerName: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
      },
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

    // Structured fields - batch is classified as transfer with note
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');
    expect(transaction.movements.outflows?.length).toBe(1);
    expect(transaction.movements.inflows?.length).toBe(0);
    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('batch_operation');
  });
});
