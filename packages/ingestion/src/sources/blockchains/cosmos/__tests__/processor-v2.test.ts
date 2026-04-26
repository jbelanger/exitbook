import { type CosmosChainConfig, type CosmosTransaction } from '@exitbook/blockchain-providers/cosmos';
import type { Currency, Result } from '@exitbook/foundation';
import type { AccountingPostingDraft } from '@exitbook/ledger';
import { describe, expect, test } from 'vitest';

import type { CosmosLedgerDraft } from '../journal-assembler.js';
import { CosmosProcessorV2 } from '../processor-v2.js';

const COSMOSHUB_CONFIG: CosmosChainConfig = {
  bech32Prefix: 'cosmos',
  chainId: 'cosmoshub-4',
  chainName: 'cosmoshub',
  displayName: 'Cosmos Hub',
  nativeCurrency: 'ATOM' as Currency,
  nativeDecimals: 6,
  nativeDenom: 'uatom',
};

const USER_ADDRESS = 'cosmos1user000000000000000000000000000000000';
const EXTERNAL_ADDRESS = 'cosmos1external0000000000000000000000000000';
const VALIDATOR_ADDRESS = 'cosmosvaloper1validator0000000000000000000000';
const DESTINATION_VALIDATOR_ADDRESS = 'cosmosvaloper1validator200000000000000000000';

const ACCOUNT_CONTEXT = {
  account: {
    fingerprint: 'account:fingerprint:cosmoshub-user',
    id: 42,
  },
  primaryAddress: USER_ADDRESS,
  userAddresses: [USER_ADDRESS],
};

function expectOk<T>(result: Result<T, Error>): T {
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) {
    throw result.error;
  }
  return result.value;
}

function createTransaction(overrides: Partial<CosmosTransaction> = {}): CosmosTransaction {
  return {
    amount: '1.25',
    blockHeight: 30000000,
    blockId: '30000000',
    currency: 'ATOM',
    eventId: 'event-default',
    feeAmount: '0.0075',
    feeCurrency: 'ATOM' as Currency,
    from: EXTERNAL_ADDRESS,
    gasUsed: 120000,
    gasWanted: 200000,
    id: 'tx-default',
    messageType: '/cosmos.bank.v1beta1.MsgSend',
    providerName: 'cosmos-rest',
    status: 'success',
    timestamp: 1776700800000,
    to: USER_ADDRESS,
    tokenSymbol: 'ATOM',
    tokenType: 'native',
    ...overrides,
  };
}

async function processOne(transaction: CosmosTransaction): Promise<CosmosLedgerDraft> {
  const processor = new CosmosProcessorV2(COSMOSHUB_CONFIG);
  const result = await processor.process([transaction], ACCOUNT_CONTEXT);
  const drafts = expectOk(result);
  expect(drafts).toHaveLength(1);
  return drafts[0]!;
}

function postingsByRole(draft: CosmosLedgerDraft, role: AccountingPostingDraft['role']): AccountingPostingDraft[] {
  return draft.journals.flatMap((journal) => journal.postings).filter((posting) => posting.role === role);
}

describe('CosmosProcessorV2', () => {
  test('emits a transfer journal for incoming native value without charging inbound fees', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '2',
        eventId: 'event-inbound',
        feeAmount: '0.01',
        from: EXTERNAL_ADDRESS,
        id: 'tx-inbound',
        to: USER_ADDRESS,
      })
    );

    expect(draft.sourceActivity).toMatchObject({
      blockchainName: 'cosmoshub',
      blockchainTransactionHash: 'tx-inbound',
      ownerAccountId: 42,
      sourceActivityOrigin: 'provider_event',
      sourceActivityStableKey: 'tx-inbound',
    });
    expect(draft.journals).toHaveLength(1);
    expect(draft.journals[0]).toMatchObject({ journalKind: 'transfer', journalStableKey: 'transfer' });
    expect(draft.journals[0]?.postings).toHaveLength(1);
    expect(draft.journals[0]?.postings[0]).toMatchObject({
      assetId: 'blockchain:cosmoshub:native',
      assetSymbol: 'ATOM',
      balanceCategory: 'liquid',
      role: 'principal',
    });
    expect(draft.journals[0]?.postings[0]?.quantity.toFixed()).toBe('2');
  });

  test('emits outgoing principal plus network fee', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '3',
        eventId: 'event-outbound',
        feeAmount: '0.02',
        from: USER_ADDRESS,
        id: 'tx-outbound',
        to: EXTERNAL_ADDRESS,
      })
    );

    const principal = postingsByRole(draft, 'principal')[0];
    const fee = postingsByRole(draft, 'fee')[0];

    expect(draft.journals[0]).toMatchObject({ journalKind: 'transfer' });
    expect(principal?.quantity.toFixed()).toBe('-3');
    expect(principal?.sourceComponentRefs[0]?.component.componentKind).toBe('message');
    expect(fee?.quantity.toFixed()).toBe('-0.02');
    expect(fee?.settlement).toBe('on-chain');
    expect(fee?.sourceComponentRefs[0]?.component.componentKind).toBe('network_fee');
  });

  test('emits claimed staking rewards as reward income plus claim fee', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '0.067732',
        eventId: 'event-reward',
        feeAmount: '0.0068',
        from: VALIDATOR_ADDRESS,
        id: 'tx-reward',
        messageType: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
        to: USER_ADDRESS,
        txType: 'staking_reward',
      })
    );

    const reward = postingsByRole(draft, 'staking_reward')[0];
    const fee = postingsByRole(draft, 'fee')[0];

    expect(draft.journals[0]).toMatchObject({ journalKind: 'staking_reward' });
    expect(reward?.quantity.toFixed()).toBe('0.067732');
    expect(reward?.balanceCategory).toBe('liquid');
    expect(reward?.sourceComponentRefs[0]?.component.componentKind).toBe('staking_reward');
    expect(fee?.quantity.toFixed()).toBe('-0.0068');
  });

  test('emits delegation principal as liquid to staked protocol custody movement', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '0',
        eventId: 'event-delegate',
        feeAmount: '0.004',
        from: USER_ADDRESS,
        id: 'tx-delegate',
        messageType: '/cosmos.staking.v1beta1.MsgDelegate',
        stakingPrincipalAmount: '10',
        stakingPrincipalCurrency: 'ATOM',
        stakingPrincipalDenom: 'uatom',
        stakingValidatorAddress: VALIDATOR_ADDRESS,
        to: VALIDATOR_ADDRESS,
        txType: 'staking_delegate',
      })
    );

    expect(draft.journals[0]).toMatchObject({ journalKind: 'protocol_event' });
    expect(draft.sourceActivity.fromAddress).toBe(USER_ADDRESS);
    expect(draft.sourceActivity.toAddress).toBe(VALIDATOR_ADDRESS);
    const protocolDeposit = postingsByRole(draft, 'protocol_deposit')[0];
    const stakedPrincipal = postingsByRole(draft, 'principal').find((posting) => posting.quantity.gt(0));

    expect(protocolDeposit?.quantity.toFixed()).toBe('-10');
    expect(protocolDeposit?.balanceCategory).toBe('liquid');
    expect(stakedPrincipal?.quantity.toFixed()).toBe('10');
    expect(stakedPrincipal?.balanceCategory).toBe('staked');
  });

  test('emits undelegation principal as staked to unbonding plus any claimed reward', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '0.000011',
        eventId: 'event-undelegate',
        feeAmount: '0.005',
        from: VALIDATOR_ADDRESS,
        id: 'tx-undelegate',
        messageType: '/cosmos.staking.v1beta1.MsgUndelegate',
        stakingPrincipalAmount: '4.45',
        stakingPrincipalCurrency: 'ATOM',
        stakingPrincipalDenom: 'uatom',
        stakingValidatorAddress: VALIDATOR_ADDRESS,
        to: USER_ADDRESS,
        txType: 'staking_undelegate',
      })
    );

    expect(draft.journals[0]).toMatchObject({ journalKind: 'protocol_event' });
    const stakedOut = postingsByRole(draft, 'principal').find((posting) => posting.quantity.lt(0));
    const unbondingIn = postingsByRole(draft, 'protocol_refund')[0];
    const reward = postingsByRole(draft, 'staking_reward')[0];

    expect(stakedOut?.quantity.toFixed()).toBe('-4.45');
    expect(stakedOut?.balanceCategory).toBe('staked');
    expect(unbondingIn?.quantity.toFixed()).toBe('4.45');
    expect(unbondingIn?.balanceCategory).toBe('unbonding');
    expect(reward?.quantity.toFixed()).toBe('0.000011');
    expect(reward?.balanceCategory).toBe('liquid');
  });

  test('emits redelegation as staked-to-staked custody movement', async () => {
    const draft = await processOne(
      createTransaction({
        amount: '0',
        eventId: 'event-redelegate',
        feeAmount: '0.004',
        from: VALIDATOR_ADDRESS,
        id: 'tx-redelegate',
        messageType: '/cosmos.staking.v1beta1.MsgBeginRedelegate',
        stakingDestinationValidatorAddress: DESTINATION_VALIDATOR_ADDRESS,
        stakingPrincipalAmount: '8',
        stakingPrincipalCurrency: 'ATOM',
        stakingPrincipalDenom: 'uatom',
        stakingValidatorAddress: VALIDATOR_ADDRESS,
        to: USER_ADDRESS,
        txType: 'staking_redelegate',
      })
    );

    const stakedPostings = postingsByRole(draft, 'principal').filter((posting) => posting.balanceCategory === 'staked');

    expect(draft.journals[0]).toMatchObject({ journalKind: 'protocol_event' });
    expect(draft.sourceActivity.fromAddress).toBe(VALIDATOR_ADDRESS);
    expect(draft.sourceActivity.toAddress).toBe(DESTINATION_VALIDATOR_ADDRESS);
    expect(stakedPostings.map((posting) => posting.quantity.toFixed()).sort()).toEqual(['-8', '8']);
  });

  test('rejects conflicting duplicate event payloads', async () => {
    const processor = new CosmosProcessorV2(COSMOSHUB_CONFIG);
    const first = createTransaction({ amount: '1', eventId: 'duplicate-event', id: 'tx-duplicate' });
    const second = createTransaction({ amount: '2', eventId: 'duplicate-event', id: 'tx-duplicate' });

    const result = await processor.process([first, second], ACCOUNT_CONTEXT);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('conflicting normalized payloads');
    }
  });
});
