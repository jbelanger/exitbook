import { describe, expect, it } from 'vitest';

import { expectOk } from '../../../../../test-support/provider-test-utils.js';
import { getCosmosChainConfig } from '../../../chain-registry.js';
import { mapGetBlockCosmosTransaction } from '../getblock.mapper-utils.js';
import type { GetBlockHydratedTx } from '../getblock.schemas.js';

const TEST_ADDRESS = 'cosmos1490khd3htq9e808qj7s48rvqtw2psu52rx4j02';
const OTHER_ADDRESS = 'cosmos1otheraccount0000000000000000000000000';
const VALIDATOR_ADDRESS = 'cosmosvaloper1validator0000000000000000000000';
const TX_HASH = 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';

const chainConfig = getCosmosChainConfig('cosmoshub');
if (!chainConfig) {
  throw new Error('cosmoshub chain config missing');
}

function buildHydratedTx(overrides: Partial<GetBlockHydratedTx>): GetBlockHydratedTx {
  return {
    hash: TX_HASH,
    height: '30000000',
    timestamp: '2026-04-20T12:00:00Z',
    tx_result: {
      code: 0,
      events: [],
      gas_used: '120000',
      gas_wanted: '200000',
    },
    ...overrides,
  };
}

describe('mapGetBlockCosmosTransaction', () => {
  it('maps bank transfer events from Tendermint tx_search results', () => {
    const mapped = expectOk(
      mapGetBlockCosmosTransaction(
        buildHydratedTx({
          tx_result: {
            code: 0,
            events: [
              {
                type: 'message',
                attributes: [
                  { key: 'action', value: '/cosmos.bank.v1beta1.MsgSend' },
                  { key: 'sender', value: TEST_ADDRESS },
                  { key: 'msg_index', value: '0' },
                ],
              },
              {
                type: 'transfer',
                attributes: [
                  { key: 'sender', value: TEST_ADDRESS },
                  { key: 'recipient', value: 'cosmos1feecollector000000000000000000000' },
                  { key: 'amount', value: '7500uatom' },
                ],
              },
              {
                type: 'transfer',
                attributes: [
                  { key: 'sender', value: TEST_ADDRESS },
                  { key: 'recipient', value: OTHER_ADDRESS },
                  { key: 'amount', value: '1000000uatom' },
                  { key: 'msg_index', value: '0' },
                ],
              },
              {
                type: 'fee_pay',
                attributes: [
                  { key: 'fee_payer', value: TEST_ADDRESS },
                  { key: 'fee', value: '7500uatom' },
                ],
              },
            ],
            gas_used: '110000',
            gas_wanted: '200000',
          },
        }),
        TEST_ADDRESS,
        'getblock-cosmos',
        chainConfig
      )
    );

    expect(mapped).toMatchObject({
      amount: '1',
      currency: 'ATOM',
      feeAmount: '0.0075',
      feeCurrency: 'ATOM',
      from: TEST_ADDRESS,
      messageType: '/cosmos.bank.v1beta1.MsgSend',
      providerName: 'getblock-cosmos',
      to: OTHER_ADDRESS,
      tokenSymbol: 'ATOM',
      tokenType: 'native',
    });
    expect(mapped.eventId).toHaveLength(64);
  });

  it('maps staking reward events without decoded transaction bodies', () => {
    const mapped = expectOk(
      mapGetBlockCosmosTransaction(
        buildHydratedTx({
          hash: 'REWARD1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
          tx_result: {
            code: 0,
            events: [
              {
                type: 'message',
                attributes: [
                  { key: 'action', value: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward' },
                  { key: 'sender', value: TEST_ADDRESS },
                  { key: 'msg_index', value: '0' },
                ],
              },
              {
                type: 'withdraw_rewards',
                attributes: [
                  { key: 'amount', value: '5ibc/ABCDEF,67732uatom' },
                  { key: 'validator', value: VALIDATOR_ADDRESS },
                  { key: 'delegator', value: TEST_ADDRESS },
                  { key: 'msg_index', value: '0' },
                ],
              },
            ],
            gas_used: '120000',
            gas_wanted: '200000',
          },
        }),
        TEST_ADDRESS,
        'getblock-cosmos',
        chainConfig
      )
    );

    expect(mapped).toMatchObject({
      amount: '0.067732',
      currency: 'ATOM',
      from: VALIDATOR_ADDRESS,
      messageType: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
      to: TEST_ADDRESS,
      txType: 'staking_reward',
    });
  });

  it('maps undelegation events as staking operations and preserves native reward components when present', () => {
    const mapped = expectOk(
      mapGetBlockCosmosTransaction(
        buildHydratedTx({
          hash: 'UNBOND1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456789',
          tx_result: {
            code: 0,
            events: [
              {
                type: 'message',
                attributes: [
                  { key: 'action', value: '/cosmos.staking.v1beta1.MsgUndelegate' },
                  { key: 'sender', value: TEST_ADDRESS },
                  { key: 'msg_index', value: '0' },
                ],
              },
              {
                type: 'withdraw_rewards',
                attributes: [
                  { key: 'amount', value: '11uatom' },
                  { key: 'validator', value: VALIDATOR_ADDRESS },
                  { key: 'delegator', value: TEST_ADDRESS },
                  { key: 'msg_index', value: '0' },
                ],
              },
              {
                type: 'unbond',
                attributes: [
                  { key: 'amount', value: '300000uatom' },
                  { key: 'validator', value: VALIDATOR_ADDRESS },
                  { key: 'delegator', value: TEST_ADDRESS },
                  { key: 'msg_index', value: '0' },
                ],
              },
            ],
            gas_used: '120000',
            gas_wanted: '200000',
          },
        }),
        TEST_ADDRESS,
        'getblock-cosmos',
        chainConfig
      )
    );

    expect(mapped).toMatchObject({
      amount: '0.000011',
      currency: 'ATOM',
      from: VALIDATOR_ADDRESS,
      messageType: '/cosmos.staking.v1beta1.MsgUndelegate',
      to: TEST_ADDRESS,
      txType: 'staking_undelegate',
    });
  });
});
