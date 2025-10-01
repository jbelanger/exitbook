import type { ProcessingImportSession } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import { describe, expect, test } from 'vitest';

import { BITTENSOR_CONFIG } from '../../bittensor/config.js';
import { POLKADOT_CONFIG } from '../../polkadot/config.js';
import { SubstrateProcessor } from '../processor.js';
import type { SubstrateTransaction } from '../types.js';

const USER_ADDRESS = '1exampleUserAddress1234567890abcdefghijklmn';
const EXTERNAL_ADDRESS = '1externalAddress1234567890abcdefghijklmnop';
const VALIDATOR_ADDRESS = '1validatorAddress1234567890abcdefghijklmn';

function buildSession(
  normalizedData: SubstrateTransaction[],
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

function createPolkadotProcessor() {
  return new SubstrateProcessor(POLKADOT_CONFIG);
}

function createBittensorProcessor() {
  return new SubstrateProcessor(BITTENSOR_CONFIG);
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
        module: 'balances',
        providerId: 'subscan',
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

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('deposit');
    expect(transaction.amount.amount.toString()).toBe('1.5');
    expect(transaction.symbol).toBe('DOT');
    expect(transaction.from).toBe(EXTERNAL_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);
    expect(transaction.status).toBe('ok');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.isIncoming).toBe(true);
    expect(fundFlow.isOutgoing).toBe(false);
    expect(fundFlow.netAmount).toBe('15000000000');
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
        module: 'balances',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
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
    expect(transaction.amount.amount.toString()).toBe('2.5');
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(EXTERNAL_ADDRESS);

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.isOutgoing).toBe(true);
    expect(fundFlow.isIncoming).toBe(false);
    // Net amount should be -(amount + fee)
    expect(fundFlow.netAmount).toBe('-25156000000');
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
        module: 'balances',
        providerId: 'subscan',
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

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('internal_transfer');
    expect(transaction.from).toBe(USER_ADDRESS);
    expect(transaction.to).toBe(USER_ADDRESS);

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.isIncoming).toBe(true);
    expect(fundFlow.isOutgoing).toBe(true);
    // Net amount for self-transfer is just the negative fee
    expect(fundFlow.netAmount).toBe('-156000000');
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
        module: 'staking',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: VALIDATOR_ADDRESS,
        type: 'staking',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('staking_deposit');
    expect(transaction.amount.amount.toString()).toBe('10');
    expect(transaction.metadata.module).toBe('staking');
    expect(transaction.metadata.call).toBe('bond');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasStaking).toBe(true);
    expect(fundFlow.isOutgoing).toBe(true);
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
        module: 'staking',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'staking',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('staking_withdrawal');
    expect(transaction.metadata.call).toBe('unbond');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasStaking).toBe(true);
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
        module: 'staking',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'staking',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('staking_withdrawal');
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
        module: 'staking',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: VALIDATOR_ADDRESS,
        type: 'staking',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('staking_deposit');
    expect(transaction.metadata.call).toBe('nominate');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasStaking).toBe(true);
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
        module: 'staking',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'staking',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('staking_reward');
    expect(transaction.amount.amount.toString()).toBe('0.5');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasStaking).toBe(true);
    expect(fundFlow.isIncoming).toBe(true);
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
        module: 'democracy',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        type: 'democracy',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('governance_deposit');
    expect(transaction.metadata.module).toBe('democracy');
    expect(transaction.metadata.call).toBe('propose');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasGovernance).toBe(true);
    expect(fundFlow.isOutgoing).toBe(true);
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
        module: 'treasury',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'democracy',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('governance_refund');
    expect(transaction.metadata.module).toBe('treasury');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasGovernance).toBe(true);
    expect(fundFlow.isIncoming).toBe(true);
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
        module: 'council',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        type: 'council',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('governance_deposit');
    expect(transaction.metadata.module).toBe('council');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasGovernance).toBe(true);
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
        module: 'utility',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        type: 'utility',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('utility_batch');
    expect(transaction.metadata.module).toBe('utility');
    expect(transaction.metadata.call).toBe('batch');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasUtilityBatch).toBe(true);
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
        module: 'utility',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        type: 'utility',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('utility_batch');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasUtilityBatch).toBe(true);
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
        module: 'proxy',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        type: 'proxy',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('proxy');
    expect(transaction.metadata.module).toBe('proxy');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasProxy).toBe(true);
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
        module: 'multisig',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        type: 'multisig',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('multisig');
    expect(transaction.metadata.module).toBe('multisig');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasMultisig).toBe(true);
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
        module: 'balances',
        providerId: 'subscan',
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

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.symbol).toBe('DOT');
    expect(transaction.amount.currency).toBe('DOT');
    expect(transaction.amount.amount.toString()).toBe('1');
    expect(transaction.fee?.currency).toBe('DOT');
    expect(transaction.fee?.amount.toString()).toBe('0.0156');
    expect(transaction.metadata.chainName).toBe('polkadot');
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
        module: 'balances',
        providerId: 'taostats',
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

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.symbol).toBe('TAO');
    expect(transaction.amount.currency).toBe('TAO');
    expect(transaction.amount.amount.toString()).toBe('1');
    expect(transaction.fee?.currency).toBe('TAO');
    expect(transaction.fee?.amount.toString()).toBe('0.1');
    expect(transaction.metadata.chainName).toBe('bittensor');
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
        module: 'balances',
        providerId: 'subscan',
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

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.amount.amount.toString()).toBe('12.3456789012');
    expect(transaction.fee?.amount.toString()).toBe('0.0156789012');
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
        module: 'system',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'custom',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    // Net amount equals fee amount, so it's classified as 'fee'
    expect(transaction.type).toBe('fee');
    expect(transaction.amount.amount.toString()).toBe('0');
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
        module: 'balances',
        providerId: 'subscan',
        status: 'failed',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
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

describe('SubstrateProcessor - Event Tracking', () => {
  test('tracks event count in fund flow metadata', async () => {
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
        module: 'balances',
        providerId: 'subscan',
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

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.eventCount).toBe(2);
  });
});

describe('SubstrateProcessor - Edge Cases', () => {
  test('handles missing user address in session metadata', async () => {
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '10000000000',
        call: 'transfer',
        chainName: 'polkadot',
        currency: 'DOT',
        from: EXTERNAL_ADDRESS,
        id: 'extrinsic-121-1',
        module: 'balances',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'transfer',
      },
    ];

    const session = buildSession(normalizedData, '');

    const result = await processor.process(session);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('Missing session address');
    }
  });

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
        module: 'balances',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
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
    const processor = createPolkadotProcessor();

    const normalizedData: SubstrateTransaction[] = [
      {
        amount: '10000000000',
        currency: 'DOT',
        from: EXTERNAL_ADDRESS,
        id: 'extrinsic-123-1',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'transfer',
        // Missing: blockHeight, blockId, module, call, chainName, etc.
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
    expect(result.value[0].metadata.module).toBe('unknown');
    expect(result.value[0].metadata.call).toBe('unknown');
    expect(result.value[0].metadata.chainName).toBe('unknown');
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
        module: 'balances',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: USER_ADDRESS,
        type: 'transfer',
      },
      {
        amount: '20000000000',
        call: 'transfer',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        from: USER_ADDRESS,
        id: 'extrinsic-124-2',
        module: 'balances',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now() + 1000,
        to: EXTERNAL_ADDRESS,
        type: 'transfer',
      },
      {
        amount: '100000000000',
        call: 'bond',
        chainName: 'polkadot',
        currency: 'DOT',
        feeAmount: '156000000',
        from: USER_ADDRESS,
        id: 'extrinsic-124-3',
        module: 'staking',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now() + 2000,
        to: VALIDATOR_ADDRESS,
        type: 'staking',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(3);
    expect(result.value[0]).toBeDefined();
    expect(result.value[0]?.type).toBe('deposit');
    expect(result.value[1]).toBeDefined();
    expect(result.value[1]?.type).toBe('withdrawal');
    expect(result.value[2]).toBeDefined();
    expect(result.value[2]?.type).toBe('staking_deposit');
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
        module: 'staking',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: VALIDATOR_ADDRESS,
        type: 'staking',
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
        module: 'staking',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now() + 1000,
        to: VALIDATOR_ADDRESS,
        type: 'staking',
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
        module: 'staking',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now() + 2000,
        to: USER_ADDRESS,
        type: 'staking',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(3);

    // First transaction: bond (staking_deposit)
    expect(result.value[0]?.type).toBe('staking_deposit');
    expect(result.value[0]?.amount.amount.toString()).toBe('10');
    const fundFlow0 = result.value[0]?.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow0.hasStaking).toBe(true);
    expect(fundFlow0.eventCount).toBe(2);

    // Second transaction: nominate (staking_deposit)
    expect(result.value[1]?.type).toBe('staking_deposit');
    expect(result.value[1]?.amount.amount.toString()).toBe('0');
    const fundFlow1 = result.value[1]?.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow1.hasStaking).toBe(true);

    // Third transaction: reward (staking_reward)
    expect(result.value[2]?.type).toBe('staking_reward');
    expect(result.value[2]?.amount.amount.toString()).toBe('0.5');
    const fundFlow2 = result.value[2]?.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow2.hasStaking).toBe(true);
    expect(fundFlow2.isIncoming).toBe(true);
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
        module: 'utility',
        providerId: 'subscan',
        status: 'success',
        timestamp: Date.now(),
        to: EXTERNAL_ADDRESS,
        type: 'utility',
      },
    ];

    const session = buildSession(normalizedData);
    const result = await processor.process(session);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;
    expect(transaction.type).toBe('utility_batch');
    expect(transaction.metadata.module).toBe('utility');
    expect(transaction.metadata.call).toBe('batch');

    const fundFlow = transaction.metadata.fundFlow as Record<string, unknown>;
    expect(fundFlow.hasUtilityBatch).toBe(true);
    expect(fundFlow.eventCount).toBe(4);
    expect(fundFlow.isOutgoing).toBe(true);
  });
});
