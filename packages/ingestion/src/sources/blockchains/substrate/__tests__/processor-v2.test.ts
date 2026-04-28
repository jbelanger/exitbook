import { SUBSTRATE_CHAINS, type SubstrateTransaction } from '@exitbook/blockchain-providers/substrate';
import type { Currency, Result } from '@exitbook/foundation';
import type { AccountingPostingDraft } from '@exitbook/ledger';
import { describe, expect, test } from 'vitest';

import type { SubstrateLedgerDraft } from '../journal-assembler.js';
import { SubstrateProcessorV2 } from '../processor-v2.js';

const USER_ADDRESS = '1exampleUserAddress1234567890abcdefghijklmn';
const EXTERNAL_ADDRESS = '1externalAddress1234567890abcdefghijklmnop';
const VALIDATOR_ADDRESS = '1validatorAddress1234567890abcdefghijklmn';
const BITTENSOR_USER_ADDRESS = '5GN1SbnEEVc7r3zGx8Unn3vjYeH7dN5z2V9WXvwoAeeDLDhG';
const BITTENSOR_EXTERNAL_ADDRESS = '5FLSigC9H8u7FhHLq7rkZKiQGXuHUztnT4Zpmd7nCK7GxenM';

const ACCOUNT_CONTEXT = {
  account: {
    fingerprint: 'account:fingerprint:polkadot-user',
    id: 42,
  },
  primaryAddress: USER_ADDRESS,
  userAddresses: [USER_ADDRESS],
};

const BITTENSOR_ACCOUNT_CONTEXT = {
  account: {
    fingerprint: 'account:fingerprint:bittensor-user',
    id: 43,
  },
  primaryAddress: BITTENSOR_USER_ADDRESS,
  userAddresses: [BITTENSOR_USER_ADDRESS],
};

function expectOk<T>(result: Result<T, Error>): T {
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) {
    throw result.error;
  }
  return result.value;
}

function createTransaction(overrides: Partial<SubstrateTransaction> = {}): SubstrateTransaction {
  const id = overrides.id ?? 'extrinsic-default';

  return {
    amount: '0',
    blockHeight: 100,
    call: 'transfer',
    chainName: 'polkadot',
    currency: 'DOT',
    eventId: `${id}:event-default`,
    extrinsicIndex: '100-1',
    feeAmount: '156000000',
    feeCurrency: 'DOT' as Currency,
    from: USER_ADDRESS,
    id,
    module: 'balances',
    providerName: 'subscan',
    status: 'success',
    timestamp: 1_700_000_000_000,
    to: EXTERNAL_ADDRESS,
    ...overrides,
  };
}

function createBittensorTransaction(overrides: Partial<SubstrateTransaction> = {}): SubstrateTransaction {
  const id = overrides.id ?? 'bittensor-extrinsic-default';

  return createTransaction({
    chainName: 'bittensor',
    currency: 'TAO',
    eventId: `${id}:event-default`,
    feeCurrency: 'TAO' as Currency,
    from: BITTENSOR_EXTERNAL_ADDRESS,
    id,
    providerName: 'taostats',
    ss58Format: 42,
    to: BITTENSOR_USER_ADDRESS,
    ...overrides,
  });
}

async function processTransactions(transactions: SubstrateTransaction[]): Promise<SubstrateLedgerDraft[]> {
  const processor = new SubstrateProcessorV2(SUBSTRATE_CHAINS['polkadot']!);
  return expectOk(await processor.process(transactions, ACCOUNT_CONTEXT));
}

async function processOne(transaction: SubstrateTransaction): Promise<SubstrateLedgerDraft> {
  const drafts = await processTransactions([transaction]);
  expect(drafts).toHaveLength(1);
  return drafts[0]!;
}

function postingsByRole(draft: SubstrateLedgerDraft, role: AccountingPostingDraft['role']): AccountingPostingDraft[] {
  return draft.journals.flatMap((journal) => journal.postings).filter((posting) => posting.role === role);
}

async function processBittensorTransactions(transactions: SubstrateTransaction[]): Promise<SubstrateLedgerDraft[]> {
  const processor = new SubstrateProcessorV2(SUBSTRATE_CHAINS['bittensor']!);
  return expectOk(await processor.process(transactions, BITTENSOR_ACCOUNT_CONTEXT));
}

describe('SubstrateProcessorV2', () => {
  test('emits a transfer journal for incoming native value without charging inbound fees', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '20000000000',
        eventId: 'event-inbound',
        feeAmount: '100000000',
        from: EXTERNAL_ADDRESS,
        id: 'tx-inbound',
        to: USER_ADDRESS,
      })
    );

    expect(draft.sourceActivity).toMatchObject({
      blockchainName: 'polkadot',
      blockchainTransactionHash: 'tx-inbound',
      ownerAccountId: 42,
      sourceActivityOrigin: 'provider_event',
      sourceActivityStableKey: 'tx-inbound',
    });
    expect(draft.journals).toHaveLength(1);
    expect(draft.journals[0]).toMatchObject({ journalKind: 'transfer', journalStableKey: 'transfer' });
    expect(draft.journals[0]?.postings).toHaveLength(1);
    expect(draft.journals[0]?.postings[0]).toMatchObject({
      assetId: 'blockchain:polkadot:native',
      assetSymbol: 'DOT',
      balanceCategory: 'liquid',
      role: 'principal',
    });
    expect(draft.journals[0]?.postings[0]?.quantity.toFixed()).toBe('2');
  });

  test('supports Bittensor native TAO transfers with 9 decimal rao normalization', async () => {
    const drafts = await processBittensorTransactions([
      createBittensorTransaction({
        amount: '2500000000',
        eventId: 'bittensor-event-inbound',
        feeAmount: '1000000',
        from: BITTENSOR_EXTERNAL_ADDRESS,
        id: 'bittensor-tx-inbound',
        to: BITTENSOR_USER_ADDRESS,
      }),
    ]);

    expect(drafts).toHaveLength(1);
    const [draft] = drafts;
    expect(draft?.sourceActivity).toMatchObject({
      blockchainName: 'bittensor',
      blockchainTransactionHash: 'bittensor-tx-inbound',
      ownerAccountId: 43,
      sourceActivityStableKey: 'bittensor-tx-inbound',
    });
    expect(draft?.journals[0]).toMatchObject({ journalKind: 'transfer', journalStableKey: 'transfer' });
    expect(draft?.journals[0]?.postings[0]).toMatchObject({
      assetId: 'blockchain:bittensor:native',
      assetSymbol: 'TAO',
      balanceCategory: 'liquid',
      role: 'principal',
    });
    expect(draft?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('2.5');
    expect(postingsByRole(draft!, 'fee')).toHaveLength(0);
  });

  test('emits outgoing principal plus network fee', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '30000000000',
        eventId: 'event-outbound',
        feeAmount: '200000000',
        from: USER_ADDRESS,
        id: 'tx-outbound',
        to: EXTERNAL_ADDRESS,
      })
    );

    const principal = postingsByRole(draft, 'principal')[0];
    const fee = postingsByRole(draft, 'fee')[0];

    expect(draft.journals[0]).toMatchObject({ journalKind: 'transfer' });
    expect(principal?.quantity.toFixed()).toBe('-3');
    expect(principal?.sourceComponentRefs[0]?.component.componentKind).toBe('account_delta');
    expect(fee?.quantity.toFixed()).toBe('-0.02');
    expect(fee?.settlement).toBe('on-chain');
    expect(fee?.sourceComponentRefs[0]?.component.componentKind).toBe('network_fee');
  });

  test('emits staking rewards as reward income without validator-paid fees', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '5000000000',
        call: 'payout_stakers',
        eventId: 'event-reward',
        feeAmount: '100000000',
        from: VALIDATOR_ADDRESS,
        id: 'tx-reward',
        module: 'staking',
        to: USER_ADDRESS,
      })
    );

    const reward = postingsByRole(draft, 'staking_reward')[0];

    expect(draft.journals[0]).toMatchObject({ journalKind: 'staking_reward' });
    expect(reward?.quantity.toFixed()).toBe('0.5');
    expect(reward?.balanceCategory).toBe('liquid');
    expect(reward?.sourceComponentRefs[0]?.component.componentKind).toBe('staking_reward');
    expect(postingsByRole(draft, 'fee')).toHaveLength(0);
  });

  test('emits bond principal as liquid to staked protocol custody movement', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '100000000000',
        call: 'bond',
        eventId: 'event-bond',
        feeAmount: '156000000',
        from: USER_ADDRESS,
        id: 'tx-bond',
        module: 'staking',
        to: VALIDATOR_ADDRESS,
      })
    );

    const protocolDeposit = postingsByRole(draft, 'protocol_deposit')[0];
    const stakedPrincipal = postingsByRole(draft, 'principal').find((posting) => posting.quantity.gt(0));
    const fee = postingsByRole(draft, 'fee')[0];

    expect(draft.journals[0]).toMatchObject({ journalKind: 'protocol_event', journalStableKey: 'staking_lifecycle' });
    expect(protocolDeposit?.quantity.toFixed()).toBe('-10');
    expect(protocolDeposit?.balanceCategory).toBe('liquid');
    expect(stakedPrincipal?.quantity.toFixed()).toBe('10');
    expect(stakedPrincipal?.balanceCategory).toBe('staked');
    expect(fee?.quantity.toFixed()).toBe('-0.0156');
  });

  test('emits unbond principal as staked to unbonding custody movement', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '50000000000',
        call: 'unbond',
        eventId: 'event-unbond',
        feeAmount: '156000000',
        from: VALIDATOR_ADDRESS,
        id: 'tx-unbond',
        module: 'staking',
        to: USER_ADDRESS,
      })
    );

    const stakedOut = postingsByRole(draft, 'principal').find((posting) => posting.quantity.lt(0));
    const unbondingIn = postingsByRole(draft, 'protocol_refund')[0];
    const fee = postingsByRole(draft, 'fee')[0];

    expect(draft.journals[0]).toMatchObject({ journalKind: 'protocol_event', journalStableKey: 'staking_lifecycle' });
    expect(stakedOut?.quantity.toFixed()).toBe('-5');
    expect(stakedOut?.balanceCategory).toBe('staked');
    expect(unbondingIn?.quantity.toFixed()).toBe('5');
    expect(unbondingIn?.balanceCategory).toBe('unbonding');
    expect(fee?.quantity.toFixed()).toBe('-0.0156');
  });

  test('emits withdraw_unbonded principal as unbonding to liquid custody movement', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '50000000000',
        call: 'withdraw_unbonded',
        eventId: 'event-withdraw-unbonded',
        feeAmount: '156000000',
        from: VALIDATOR_ADDRESS,
        id: 'tx-withdraw-unbonded',
        module: 'staking',
        to: USER_ADDRESS,
      })
    );

    const unbondingOut = postingsByRole(draft, 'principal').find((posting) => posting.quantity.lt(0));
    const liquidIn = postingsByRole(draft, 'protocol_refund').find((posting) => posting.balanceCategory === 'liquid');

    expect(draft.journals[0]).toMatchObject({ journalKind: 'protocol_event', journalStableKey: 'staking_lifecycle' });
    expect(unbondingOut?.quantity.toFixed()).toBe('-5');
    expect(unbondingOut?.balanceCategory).toBe('unbonding');
    expect(liquidIn?.quantity.toFixed()).toBe('5');
    expect(liquidIn?.balanceCategory).toBe('liquid');
  });

  test('keeps nomination-only transactions as protocol events instead of generic fee-only expenses', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '0',
        call: 'nominate',
        eventId: 'event-nominate',
        feeAmount: '156000000',
        from: USER_ADDRESS,
        id: 'tx-nominate',
        module: 'staking',
        to: VALIDATOR_ADDRESS,
      })
    );

    expect(draft.journals[0]).toMatchObject({ journalKind: 'protocol_event', journalStableKey: 'staking_lifecycle' });
    expect(draft.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['fee', '-0.0156'],
    ]);
  });

  test('failed outgoing value transactions keep only the paid fee', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '20000000000',
        eventId: 'event-failed-transfer',
        feeAmount: '156000000',
        from: USER_ADDRESS,
        id: 'tx-failed-transfer',
        status: 'failed',
        to: EXTERNAL_ADDRESS,
      })
    );

    expect(draft.journals[0]).toMatchObject({ journalKind: 'expense_only', journalStableKey: 'network_fee' });
    expect(draft.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['fee', '-0.0156'],
    ]);
  });

  test('rejects conflicting duplicate event payloads', async () => {
    const processor = new SubstrateProcessorV2(SUBSTRATE_CHAINS['polkadot']!);
    const first = createTransaction({ amount: '10000000000', eventId: 'duplicate-event', id: 'tx-duplicate' });
    const second = createTransaction({ amount: '20000000000', eventId: 'duplicate-event', id: 'tx-duplicate' });

    const result = await processor.process([first, second], ACCOUNT_CONTEXT);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('conflicting normalized payloads');
    }
  });
});
