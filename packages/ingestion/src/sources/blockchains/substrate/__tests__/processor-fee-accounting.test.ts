import { SUBSTRATE_CHAINS, type SubstrateTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { SubstrateProcessor } from '../processor.js';

const USER_ADDRESS = '1exampleUserAddress1234567890abcdefghijklmn';
const EXTERNAL_ADDRESS = '1externalAddress1234567890abcdefghijklmnop';
const VALIDATOR_ADDRESS = '1validatorAddress1234567890abcdefghijklmn';

function createPolkadotProcessor() {
  return new SubstrateProcessor(SUBSTRATE_CHAINS.polkadot!);
}

// Helper function to create transaction objects with defaults
function createTransaction(overrides: Partial<SubstrateTransaction> = {}): SubstrateTransaction {
  return {
    amount: '0',
    blockHeight: 100,
    call: 'transfer',
    chainName: 'polkadot',
    currency: 'DOT',
    feeAmount: '156000000',
    feeCurrency: 'DOT',
    from: USER_ADDRESS,
    id: 'extrinsic-default',
    eventId: 'event-default',
    module: 'balances',
    providerName: 'subscan',
    status: 'success',
    timestamp: Date.now(),
    to: EXTERNAL_ADDRESS,
    ...overrides,
  };
}

// Helper function to create session context with defaults
function createSessionContext(overrides: Partial<{ primaryAddress: string; userAddresses: string[] }> = {}) {
  return {
    primaryAddress: USER_ADDRESS,
    userAddresses: [USER_ADDRESS],
    ...overrides,
  };
}

describe('SubstrateProcessor - Fee Accounting', () => {
  describe('High Confidence Cases (9/10)', () => {
    test('user pays fee when sending tokens (outgoing transfer)', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '25000000000', // 2.5 DOT
          blockHeight: 101,
          id: 'extrinsic-101-1',
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User sent funds -> user pays fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
      expect(transaction.movements.outflows?.length).toBe(1);
      expect(transaction.movements.inflows?.length).toBe(0);
    });

    test('user does NOT pay fee when receiving tokens (incoming transfer)', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '15000000000', // 1.5 DOT
          blockId: '0xblock1',
          from: EXTERNAL_ADDRESS,
          id: 'extrinsic-100-1',
          to: USER_ADDRESS,
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User received funds -> sender paid fee, user pays 0
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
      expect(transaction.movements.inflows?.length).toBe(1);
      expect(transaction.movements.outflows?.length).toBe(0);
    });

    test('user pays fee for self-transfer', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '10000000000', // 1 DOT
          id: 'extrinsic-102-1',
          to: USER_ADDRESS,
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // Self-transfer -> user initiated and paid fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
      expect(transaction.movements.inflows?.length).toBe(1);
      expect(transaction.movements.outflows?.length).toBe(1);
    });

    test('user pays fee when bonding tokens (staking deposit)', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '100000000000', // 10 DOT bonded
          call: 'bond',
          id: 'extrinsic-103-1',
          module: 'staking',
          to: VALIDATOR_ADDRESS,
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User bonding -> user pays fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
      expect(transaction.movements.outflows?.length).toBe(1);
    });

    test('user pays fee when unbonding tokens (even though receiving funds)', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '50000000000', // 5 DOT unbonded
          call: 'unbond',
          from: VALIDATOR_ADDRESS, // Funds come FROM staking module
          id: 'extrinsic-104-1',
          module: 'staking',
          to: USER_ADDRESS, // Going TO user
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User initiated unbond -> user pays fee (even though receiving funds)
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
      expect(transaction.movements.inflows?.length).toBe(1);
      expect(transaction.movements.outflows?.length).toBe(0);
    });

    test('user pays fee when withdrawing unbonded tokens', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '50000000000', // 5 DOT withdrawn
          call: 'withdraw_unbonded',
          from: VALIDATOR_ADDRESS,
          id: 'extrinsic-105-1',
          module: 'staking',
          to: USER_ADDRESS,
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User initiated withdraw -> user pays fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
    });

    test('user pays fee when nominating validators (no fund movement)', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '0', // Nominate doesn't move funds
          call: 'nominate',
          id: 'extrinsic-106-1',
          module: 'staking',
          to: VALIDATOR_ADDRESS,
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User initiated nominate -> user pays fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
      expect(transaction.movements.inflows?.length).toBe(0);
      expect(transaction.movements.outflows?.length).toBe(0);
    });

    test('user pays fee when stopping nomination (chill)', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '0',
          call: 'chill',
          id: 'extrinsic-107-1',
          module: 'staking',
          to: USER_ADDRESS,
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User initiated chill -> user pays fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
    });

    test('user does NOT pay fee for staking rewards (incoming from validator)', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '5000000000', // 0.5 DOT reward
          call: 'payout_stakers', // Validator paid out
          feeAmount: '100000000', // Validator paid this fee
          from: VALIDATOR_ADDRESS,
          id: 'extrinsic-108-1',
          module: 'staking',
          to: USER_ADDRESS,
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // Validator paid out rewards -> validator paid fee, user pays 0
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
      expect(transaction.movements.inflows?.length).toBe(1);
      expect(transaction.movements.outflows?.length).toBe(0);
    });

    test('user pays fee when voting in governance', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '50000000000', // 5 DOT locked for vote
          call: 'vote',
          id: 'extrinsic-109-1',
          module: 'democracy',
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User voting -> user pays fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
      expect(transaction.movements.outflows?.length).toBe(1);
    });

    test('user pays fee for failed transactions (when they initiated)', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '10000000000',
          id: 'extrinsic-110-1',
          status: 'failed',
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // Failed transaction but user initiated -> user still pays fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
      expect(transaction.status).toBe('failed');
    });
  });

  describe('Medium Confidence Cases (7/10)', () => {
    test('user does NOT pay fee for treasury payouts (incoming governance refund)', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '100000000000', // 10 DOT refund
          call: 'payout',
          feeAmount: '200000000', // Treasury/system paid this
          from: EXTERNAL_ADDRESS, // Treasury address
          id: 'extrinsic-111-1',
          module: 'treasury',
          to: USER_ADDRESS,
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // Treasury payout -> system paid fee, user pays 0
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
      expect(transaction.movements.inflows?.length).toBe(1);
      expect(transaction.movements.outflows?.length).toBe(0);
    });

    test('user pays fee for utility batch operations', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '30000000000', // 3 DOT total
          call: 'batch',
          feeAmount: '256000000',
          id: 'extrinsic-112-1',
          module: 'utility',
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User initiated batch -> user pays fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0256');
      expect(transaction.movements.outflows?.length).toBe(1);
    });

    test('user pays fee for proxy operations (when user is proxy signer)', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '10000000000',
          call: 'proxy',
          id: 'extrinsic-113-1',
          module: 'proxy',
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User as proxy initiator -> user pays fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
      expect(transaction.movements.outflows?.length).toBe(1);
    });

    test('user pays fee for multisig approval', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '10000000000',
          call: 'approve_as_multi',
          id: 'extrinsic-114-1',
          module: 'multisig',
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User approving multisig -> user pays fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
      expect(transaction.movements.outflows?.length).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    test('handles case-sensitive address matching (SS58 addresses are case-sensitive)', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '10000000000',
          id: 'extrinsic-115-1',
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // Should match with exact case match (SS58 addresses are case-sensitive)
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
    });

    test('handles zero-amount transactions (fee-only)', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '0',
          call: 'remark',
          id: 'extrinsic-116-1',
          module: 'system',
          to: USER_ADDRESS,
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User initiated remark -> user pays fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.0156');
    });

    test('handles missing fee amount gracefully', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '10000000000',
          feeAmount: undefined,
          id: 'extrinsic-117-1',
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // Missing fee defaults to 0
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed() ?? '0').toBe('0');
    });

    test('multi-chain support: Bittensor (TAO) with different decimals', async () => {
      const processor = new SubstrateProcessor(SUBSTRATE_CHAINS.bittensor!);

      const normalizedData: SubstrateTransaction[] = [
        createTransaction({
          amount: '1000000000', // 1 TAO (9 decimals)
          chainName: 'bittensor',
          currency: 'TAO',
          feeAmount: '100000000', // 0.1 TAO
          feeCurrency: 'TAO',
          id: 'extrinsic-118-1',
          providerName: 'taostats',
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const [transaction] = result.value;
      expect(transaction).toBeDefined();
      if (!transaction) return;

      // User sent TAO -> user pays fee
      expect(transaction.fees.find((f) => f.scope === 'network')?.amount?.toFixed()).toBe('0.1');
      expect(transaction.fees.find((f) => f.scope === 'network')?.asset.toString()).toBe('TAO');
    });
  });

  describe('Complex Staking Scenarios', () => {
    test('staking workflow: bond -> nominate -> unbond -> withdraw', async () => {
      const processor = createPolkadotProcessor();

      const normalizedData: SubstrateTransaction[] = [
        // 1. Bond
        createTransaction({
          amount: '100000000000', // 10 DOT
          call: 'bond',
          id: 'extrinsic-119-1',
          module: 'staking',
          to: VALIDATOR_ADDRESS,
        }),
        // 2. Nominate
        createTransaction({
          amount: '0',
          call: 'nominate',
          id: 'extrinsic-119-2',
          module: 'staking',
          timestamp: Date.now() + 1000,
          to: VALIDATOR_ADDRESS,
        }),
        // 3. Unbond
        createTransaction({
          amount: '50000000000', // 5 DOT
          call: 'unbond',
          from: VALIDATOR_ADDRESS,
          id: 'extrinsic-119-3',
          module: 'staking',
          timestamp: Date.now() + 2000,
          to: USER_ADDRESS,
        }),
        // 4. Withdraw
        createTransaction({
          amount: '50000000000', // 5 DOT
          call: 'withdraw_unbonded',
          from: VALIDATOR_ADDRESS,
          id: 'extrinsic-119-4',
          module: 'staking',
          timestamp: Date.now() + 3000,
          to: USER_ADDRESS,
        }),
      ];

      const result = await processor.process(normalizedData, createSessionContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value).toHaveLength(4);

      // All 4 operations initiated by user -> user pays all fees
      result.value.forEach((tx) => {
        const networkFee = tx.fees.find((f) => f.scope === 'network');
        expect(networkFee?.amount.toFixed()).toBe('0.0156');
      });
    });
  });
});
