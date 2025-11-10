import type { SubstrateChainConfig, SubstrateTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import {
  analyzeFundFlowFromNormalized,
  determineOperationFromFundFlow,
  didUserPayFee,
  enrichSourceContext,
  normalizeAmount,
} from '../processor-utils.js';
import type { SubstrateFundFlow } from '../types.js';

// Test addresses for Substrate chains (SS58 format)
const POLKADOT_ADDRESS = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
const POLKADOT_ADDRESS_2 = '13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB';
const KUSAMA_ADDRESS = 'FZsMKYHoQG1dAVhXBMyC7aYFYpASoBrrMYsAn1gJJUAueZZ';
const BITTENSOR_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const EXTERNAL_ADDRESS = '16ZL8yLyXv3V3L3z9ofR1ovFLziyXaN1DPq4yffMAZ9czzBD';

// Chain configurations for testing
const POLKADOT_CONFIG: SubstrateChainConfig = {
  chainName: 'polkadot',
  displayName: 'Polkadot Relay Chain',
  nativeCurrency: 'DOT',
  nativeDecimals: 10,
  ss58Format: 0,
};

const KUSAMA_CONFIG: SubstrateChainConfig = {
  chainName: 'kusama',
  displayName: 'Kusama Network',
  nativeCurrency: 'KSM',
  nativeDecimals: 12,
  ss58Format: 2,
};

const BITTENSOR_CONFIG: SubstrateChainConfig = {
  chainName: 'bittensor',
  displayName: 'Bittensor Network',
  nativeCurrency: 'TAO',
  nativeDecimals: 9,
  ss58Format: 42,
};

describe('enrichSourceContext', () => {
  test('enriches Polkadot address with SS58 variants', () => {
    const result = enrichSourceContext(POLKADOT_ADDRESS);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const context = result.value;
    expect(context.address).toBe(POLKADOT_ADDRESS);
    expect(Array.isArray(context.derivedAddresses)).toBe(true);
    expect((context.derivedAddresses as string[]).length).toBeGreaterThan(0);
    expect((context.derivedAddresses as string[]).includes(POLKADOT_ADDRESS)).toBe(true);
  });

  test('enriches Kusama address with SS58 variants', () => {
    const result = enrichSourceContext(KUSAMA_ADDRESS);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const context = result.value;
    expect(context.address).toBe(KUSAMA_ADDRESS);
    expect(Array.isArray(context.derivedAddresses)).toBe(true);
    expect((context.derivedAddresses as string[]).length).toBeGreaterThan(0);
  });

  test('enriches Bittensor address with SS58 variants', () => {
    const result = enrichSourceContext(BITTENSOR_ADDRESS);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const context = result.value;
    expect(context.address).toBe(BITTENSOR_ADDRESS);
    expect(Array.isArray(context.derivedAddresses)).toBe(true);
    expect((context.derivedAddresses as string[]).length).toBeGreaterThan(0);
  });

  test('returns error for empty address', () => {
    const result = enrichSourceContext('');

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error).toContain('Missing address');
  });

  test('generates unique derived addresses', () => {
    const result = enrichSourceContext(POLKADOT_ADDRESS);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const derivedAddresses = result.value.derivedAddresses as string[];
    const uniqueSet = new Set(derivedAddresses);
    expect(uniqueSet.size).toBe(derivedAddresses.length);
  });
});

describe('normalizeAmount', () => {
  test('normalizes Polkadot amount from planck to DOT', () => {
    const result = normalizeAmount('10000000000', POLKADOT_CONFIG.nativeDecimals); // 1 DOT in planck

    expect(result.unwrapOr('error')).toBe('1');
  });

  test('normalizes Kusama amount from planck to KSM', () => {
    const result = normalizeAmount('1000000000000', KUSAMA_CONFIG.nativeDecimals); // 1 KSM in planck

    expect(result.unwrapOr('error')).toBe('1');
  });

  test('normalizes Bittensor amount from rao to TAO', () => {
    const result = normalizeAmount('1000000000', BITTENSOR_CONFIG.nativeDecimals); // 1 TAO in rao

    expect(result.unwrapOr('error')).toBe('1');
  });

  test('handles fractional amounts correctly', () => {
    const result = normalizeAmount('12345678900', POLKADOT_CONFIG.nativeDecimals); // 1.23456789 DOT

    expect(result.unwrapOr('error')).toBe('1.23456789');
  });

  test('handles very small amounts', () => {
    const result = normalizeAmount('1', POLKADOT_CONFIG.nativeDecimals); // 0.0000000001 DOT

    expect(result.unwrapOr('error')).toBe('0.0000000001');
  });

  test('handles zero amount', () => {
    const result = normalizeAmount('0', POLKADOT_CONFIG.nativeDecimals);

    expect(result.unwrapOr('error')).toBe('0');
  });

  test('handles undefined amount', () => {
    const result = normalizeAmount(undefined, POLKADOT_CONFIG.nativeDecimals);

    expect(result.unwrapOr('error')).toBe('0');
  });

  test('returns error for invalid amount', () => {
    const result = normalizeAmount('invalid', POLKADOT_CONFIG.nativeDecimals);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Failed to convert');
  });
});

describe('analyzeFundFlowFromNormalized', () => {
  test('analyzes outgoing transfer correctly', () => {
    const transaction: SubstrateTransaction = {
      amount: '10000000000', // 1 DOT in planck
      blockHeight: 15000000,
      blockId: '0xabc123',
      call: 'transfer',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000', // 0.015625 DOT in planck
      feeCurrency: 'DOT',
      from: POLKADOT_ADDRESS,
      id: '0x123abc',
      module: 'balances',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const sessionContext = {
      address: POLKADOT_ADDRESS,
      derivedAddresses: [POLKADOT_ADDRESS],
    };

    const fundFlow = analyzeFundFlowFromNormalized(transaction, sessionContext, POLKADOT_CONFIG)._unsafeUnwrap();

    expect(fundFlow.outflows).toHaveLength(1);
    expect(fundFlow.outflows[0]?.amount).toBe('1');
    expect(fundFlow.outflows[0]?.asset).toBe('DOT');
    expect(fundFlow.inflows).toHaveLength(0);
    expect(fundFlow.primary.amount).toBe('1');
    expect(fundFlow.primary.asset).toBe('DOT');
    expect(fundFlow.feeAmount).toBe('0.015625');
    expect(fundFlow.fromAddress).toBe(POLKADOT_ADDRESS);
    expect(fundFlow.toAddress).toBe(EXTERNAL_ADDRESS);
  });

  test('analyzes incoming transfer correctly', () => {
    const transaction: SubstrateTransaction = {
      amount: '20000000000', // 2 DOT in planck
      blockHeight: 15000001,
      blockId: '0xdef456',
      call: 'transfer',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      feeCurrency: 'DOT',
      from: EXTERNAL_ADDRESS,
      id: '0x456def',
      module: 'balances',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const sessionContext = {
      address: POLKADOT_ADDRESS,
      derivedAddresses: [POLKADOT_ADDRESS],
    };

    const fundFlow = analyzeFundFlowFromNormalized(transaction, sessionContext, POLKADOT_CONFIG)._unsafeUnwrap();

    expect(fundFlow.inflows).toHaveLength(1);
    expect(fundFlow.inflows[0]?.amount).toBe('2');
    expect(fundFlow.inflows[0]?.asset).toBe('DOT');
    expect(fundFlow.outflows).toHaveLength(0);
    expect(fundFlow.primary.amount).toBe('2');
    expect(fundFlow.primary.asset).toBe('DOT');
    expect(fundFlow.fromAddress).toBe(EXTERNAL_ADDRESS);
    expect(fundFlow.toAddress).toBe(POLKADOT_ADDRESS);
  });

  test('analyzes self-transfer correctly', () => {
    const transaction: SubstrateTransaction = {
      amount: '5000000000', // 0.5 DOT in planck
      blockHeight: 15000002,
      blockId: '0xghi789',
      call: 'transfer',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      feeCurrency: 'DOT',
      from: POLKADOT_ADDRESS,
      id: '0x789ghi',
      module: 'balances',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const sessionContext = {
      address: POLKADOT_ADDRESS,
      derivedAddresses: [POLKADOT_ADDRESS],
    };

    const fundFlow = analyzeFundFlowFromNormalized(transaction, sessionContext, POLKADOT_CONFIG)._unsafeUnwrap();

    expect(fundFlow.inflows).toHaveLength(1);
    expect(fundFlow.inflows[0]?.amount).toBe('0.5');
    expect(fundFlow.outflows).toHaveLength(1);
    expect(fundFlow.outflows[0]?.amount).toBe('0.5');
    expect(fundFlow.primary.amount).toBe('0.5');
    expect(fundFlow.fromAddress).toBe(POLKADOT_ADDRESS);
    expect(fundFlow.toAddress).toBe(POLKADOT_ADDRESS);
  });

  test('detects staking transactions', () => {
    const transaction: SubstrateTransaction = {
      amount: '10000000000', // 1 DOT
      blockHeight: 15000003,
      blockId: '0xjkl012',
      call: 'bond',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      feeCurrency: 'DOT',
      from: POLKADOT_ADDRESS,
      id: '0x012jkl',
      module: 'staking',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const sessionContext = {
      address: POLKADOT_ADDRESS,
      derivedAddresses: [POLKADOT_ADDRESS],
    };

    const fundFlow = analyzeFundFlowFromNormalized(transaction, sessionContext, POLKADOT_CONFIG)._unsafeUnwrap();

    expect(fundFlow.hasStaking).toBe(true);
    expect(fundFlow.module).toBe('staking');
    expect(fundFlow.call).toBe('bond');
  });

  test('detects governance transactions', () => {
    const transaction: SubstrateTransaction = {
      amount: '100000000000', // 10 DOT
      blockHeight: 15000004,
      blockId: '0xmno345',
      call: 'vote',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      feeCurrency: 'DOT',
      from: POLKADOT_ADDRESS,
      id: '0x345mno',
      module: 'democracy',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const sessionContext = {
      address: POLKADOT_ADDRESS,
      derivedAddresses: [POLKADOT_ADDRESS],
    };

    const fundFlow = analyzeFundFlowFromNormalized(transaction, sessionContext, POLKADOT_CONFIG)._unsafeUnwrap();

    expect(fundFlow.hasGovernance).toBe(true);
    expect(fundFlow.module).toBe('democracy');
  });

  test('detects utility batch transactions', () => {
    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000005,
      blockId: '0xpqr678',
      call: 'batch_all',
      chainName: 'polkadot',
      currency: 'DOT',
      events: [
        { data: [], method: 'Transfer', section: 'balances' },
        { data: [], method: 'Transfer', section: 'balances' },
        { data: [], method: 'Transfer', section: 'balances' },
        { data: [], method: 'Transfer', section: 'balances' },
        { data: [], method: 'Transfer', section: 'balances' },
        { data: [], method: 'Transfer', section: 'balances' },
      ],
      feeAmount: '312500000',
      feeCurrency: 'DOT',
      from: POLKADOT_ADDRESS,
      id: '0x678pqr',
      module: 'utility',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const sessionContext = {
      address: POLKADOT_ADDRESS,
      derivedAddresses: [POLKADOT_ADDRESS],
    };

    const fundFlow = analyzeFundFlowFromNormalized(transaction, sessionContext, POLKADOT_CONFIG)._unsafeUnwrap();

    expect(fundFlow.hasUtilityBatch).toBe(true);
    expect(fundFlow.eventCount).toBe(6);
    expect(fundFlow.classificationUncertainty).toContain('Utility batch');
  });

  test('detects proxy transactions', () => {
    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000006,
      blockId: '0xstu901',
      call: 'proxy',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      feeCurrency: 'DOT',
      from: POLKADOT_ADDRESS,
      id: '0x901stu',
      module: 'proxy',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS_2,
    };

    const sessionContext = {
      address: POLKADOT_ADDRESS,
      derivedAddresses: [POLKADOT_ADDRESS],
    };

    const fundFlow = analyzeFundFlowFromNormalized(transaction, sessionContext, POLKADOT_CONFIG)._unsafeUnwrap();

    expect(fundFlow.hasProxy).toBe(true);
    expect(fundFlow.module).toBe('proxy');
  });

  test('detects multisig transactions', () => {
    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000007,
      blockId: '0xvwx234',
      call: 'as_multi',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      feeCurrency: 'DOT',
      from: POLKADOT_ADDRESS,
      id: '0x234vwx',
      module: 'multisig',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const sessionContext = {
      address: POLKADOT_ADDRESS,
      derivedAddresses: [POLKADOT_ADDRESS],
    };

    const fundFlow = analyzeFundFlowFromNormalized(transaction, sessionContext, POLKADOT_CONFIG)._unsafeUnwrap();

    expect(fundFlow.hasMultisig).toBe(true);
    expect(fundFlow.module).toBe('multisig');
  });

  test('handles zero amount transactions', () => {
    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000008,
      blockId: '0xyzab567',
      call: 'nominate',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      feeCurrency: 'DOT',
      from: POLKADOT_ADDRESS,
      id: '0x567yzab',
      module: 'staking',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const sessionContext = {
      address: POLKADOT_ADDRESS,
      derivedAddresses: [POLKADOT_ADDRESS],
    };

    const fundFlow = analyzeFundFlowFromNormalized(transaction, sessionContext, POLKADOT_CONFIG)._unsafeUnwrap();

    expect(fundFlow.inflows).toHaveLength(0);
    expect(fundFlow.outflows).toHaveLength(0);
    expect(fundFlow.primary.amount).toBe('0');
    expect(fundFlow.primary.asset).toBe('DOT');
    expect(fundFlow.feeAmount).toBe('0.015625');
  });

  test('handles transactions with derived addresses', () => {
    const genericAddress = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
    const polkadotAddress = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';

    const transaction: SubstrateTransaction = {
      amount: '10000000000',
      blockHeight: 15000009,
      blockId: '0xcdef890',
      call: 'transfer',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      feeCurrency: 'DOT',
      from: polkadotAddress,
      id: '0x890cdef',
      module: 'balances',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const sessionContext = {
      address: genericAddress,
      derivedAddresses: [genericAddress, polkadotAddress],
    };

    const fundFlow = analyzeFundFlowFromNormalized(transaction, sessionContext, POLKADOT_CONFIG)._unsafeUnwrap();

    expect(fundFlow.outflows).toHaveLength(1);
    expect(fundFlow.outflows[0]?.amount).toBe('1');
  });
});

describe('determineOperationFromFundFlow', () => {
  test('classifies staking bond as stake', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'bond',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: true,
      hasUtilityBatch: false,
      inflows: [],
      module: 'staking',
      outflows: [{ amount: '10', asset: 'DOT' }],
      primary: { amount: '10', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '100000000000',
      blockHeight: 15000000,
      call: 'bond',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0x123',
      module: 'staking',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('staking');
    expect(classification.operation.type).toBe('stake');
  });

  test('classifies staking unbond as unstake', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'unbond',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: true,
      hasUtilityBatch: false,
      inflows: [],
      module: 'staking',
      outflows: [],
      primary: { amount: '0', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000001,
      call: 'unbond',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0x456',
      module: 'staking',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('staking');
    expect(classification.operation.type).toBe('unstake');
  });

  test('classifies staking withdraw as unstake', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'withdraw_unbonded',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: true,
      hasUtilityBatch: false,
      inflows: [{ amount: '10', asset: 'DOT' }],
      module: 'staking',
      outflows: [],
      primary: { amount: '10', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '100000000000',
      blockHeight: 15000002,
      call: 'withdraw_unbonded',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0x789',
      module: 'staking',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('staking');
    expect(classification.operation.type).toBe('unstake');
  });

  test('classifies staking reward as reward', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'bond',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0',
      feeCurrency: 'DOT',
      fromAddress: EXTERNAL_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: true,
      hasUtilityBatch: false,
      inflows: [{ amount: '0.5', asset: 'DOT' }],
      module: 'staking',
      outflows: [],
      primary: { amount: '0.5', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '5000000000',
      blockHeight: 15000003,
      call: 'bond',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '0',
      from: EXTERNAL_ADDRESS,
      id: '0xabc',
      module: 'staking',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('staking');
    expect(classification.operation.type).toBe('reward');
  });

  test('classifies nominate with info note', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'nominate',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: true,
      hasUtilityBatch: false,
      inflows: [],
      module: 'staking',
      outflows: [],
      primary: { amount: '0', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000004,
      call: 'nominate',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0xdef',
      module: 'staking',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('staking');
    expect(classification.operation.type).toBe('stake');
    expect(classification.note).toBeDefined();
    expect(classification.note?.type).toBe('staking_operation');
    expect(classification.note?.message).toContain('nominate');
  });

  test('classifies governance proposal', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'propose',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: true,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [],
      module: 'democracy',
      outflows: [{ amount: '100', asset: 'DOT' }],
      primary: { amount: '100', asset: 'DOT' },
      toAddress: EXTERNAL_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '1000000000000',
      blockHeight: 15000005,
      call: 'propose',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0xghi',
      module: 'democracy',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('governance');
    expect(classification.operation.type).toBe('proposal');
  });

  test('classifies governance vote', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'vote',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: true,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [],
      module: 'democracy',
      outflows: [{ amount: '10', asset: 'DOT' }],
      primary: { amount: '10', asset: 'DOT' },
      toAddress: EXTERNAL_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '100000000000',
      blockHeight: 15000006,
      call: 'vote',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0xjkl',
      module: 'democracy',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('governance');
    expect(classification.operation.type).toBe('vote');
  });

  test('classifies governance refund', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'refund',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0',
      feeCurrency: 'DOT',
      fromAddress: EXTERNAL_ADDRESS,
      hasGovernance: true,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [{ amount: '10', asset: 'DOT' }],
      module: 'democracy',
      outflows: [],
      primary: { amount: '10', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '100000000000',
      blockHeight: 15000007,
      call: 'refund',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '0',
      from: EXTERNAL_ADDRESS,
      id: '0xmno',
      module: 'democracy',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('governance');
    expect(classification.operation.type).toBe('refund');
  });

  test('classifies utility batch with warning note', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'batch_all',
      chainName: 'polkadot',
      classificationUncertainty:
        'Utility batch with 6 events. May contain multiple operations that need separate accounting.',
      eventCount: 6,
      extrinsicCount: 1,
      feeAmount: '0.03125',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: true,
      inflows: [{ amount: '2', asset: 'DOT' }],
      module: 'utility',
      outflows: [{ amount: '5', asset: 'DOT' }],
      primary: { amount: '5', asset: 'DOT' },
      toAddress: EXTERNAL_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000008,
      call: 'batch_all',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '312500000',
      from: POLKADOT_ADDRESS,
      id: '0xpqr',
      module: 'utility',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('transfer');
    expect(classification.note).toBeDefined();
    expect(classification.note?.type).toBe('batch_operation');
    expect(classification.note?.severity).toBe('warning');
  });

  test('classifies proxy operation with info note', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'proxy',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: true,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [],
      module: 'proxy',
      outflows: [],
      primary: { amount: '0', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS_2,
    };

    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000009,
      call: 'proxy',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0xstu',
      module: 'proxy',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS_2,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('transfer');
    expect(classification.note).toBeDefined();
    expect(classification.note?.type).toBe('proxy_operation');
    expect(classification.note?.severity).toBe('info');
  });

  test('classifies multisig operation with info note', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'as_multi',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: true,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [],
      module: 'multisig',
      outflows: [{ amount: '1', asset: 'DOT' }],
      primary: { amount: '1', asset: 'DOT' },
      toAddress: EXTERNAL_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '10000000000',
      blockHeight: 15000010,
      call: 'as_multi',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0xvwx',
      module: 'multisig',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('transfer');
    expect(classification.note).toBeDefined();
    expect(classification.note?.type).toBe('multisig_operation');
    expect(classification.note?.severity).toBe('info');
  });

  test('classifies fee-only transaction', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'remark',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [],
      module: 'system',
      outflows: [],
      primary: { amount: '0', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000011,
      call: 'remark',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0xyzab',
      module: 'system',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('fee');
    expect(classification.operation.type).toBe('fee');
  });

  test('classifies simple deposit', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'transfer',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: EXTERNAL_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [{ amount: '5', asset: 'DOT' }],
      module: 'balances',
      outflows: [],
      primary: { amount: '5', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '50000000000',
      blockHeight: 15000012,
      call: 'transfer',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: EXTERNAL_ADDRESS,
      id: '0xcdef',
      module: 'balances',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('deposit');
  });

  test('classifies simple withdrawal', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'transfer',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [],
      module: 'balances',
      outflows: [{ amount: '3', asset: 'DOT' }],
      primary: { amount: '3', asset: 'DOT' },
      toAddress: EXTERNAL_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '30000000000',
      blockHeight: 15000013,
      call: 'transfer',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0xghij',
      module: 'balances',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('withdrawal');
  });

  test('classifies self-transfer', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'transfer',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [{ amount: '1', asset: 'DOT' }],
      module: 'balances',
      outflows: [{ amount: '1', asset: 'DOT' }],
      primary: { amount: '1', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '10000000000',
      blockHeight: 15000014,
      call: 'transfer',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0xklmn',
      module: 'balances',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('transfer');
  });

  test('classifies unknown transaction with warning note', () => {
    const fundFlow: SubstrateFundFlow = {
      call: 'unknown_call',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [
        { amount: '2', asset: 'DOT' },
        { amount: '1', asset: 'KSM' },
      ],
      module: 'unknown_module',
      outflows: [{ amount: '3', asset: 'DOT' }],
      primary: { amount: '3', asset: 'DOT' },
      toAddress: EXTERNAL_ADDRESS,
    };

    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000015,
      call: 'unknown_call',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0xopqr',
      module: 'unknown_module',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('transfer');
    expect(classification.note).toBeDefined();
    expect(classification.note?.type).toBe('classification_failed');
    expect(classification.note?.severity).toBe('warning');
  });
});

describe('didUserPayFee', () => {
  test('returns true when user has outflows', () => {
    const transaction: SubstrateTransaction = {
      amount: '10000000000',
      blockHeight: 15000000,
      call: 'transfer',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0x123',
      module: 'balances',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const fundFlow: SubstrateFundFlow = {
      call: 'transfer',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [],
      module: 'balances',
      outflows: [{ amount: '1', asset: 'DOT' }],
      primary: { amount: '1', asset: 'DOT' },
      toAddress: EXTERNAL_ADDRESS,
    };

    const userPaidFee = didUserPayFee(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(true);
  });

  test('returns true for user-initiated unbond', () => {
    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000001,
      call: 'unbond',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0x456',
      module: 'staking',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const fundFlow: SubstrateFundFlow = {
      call: 'unbond',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: true,
      hasUtilityBatch: false,
      inflows: [],
      module: 'staking',
      outflows: [],
      primary: { amount: '0', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const userPaidFee = didUserPayFee(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(true);
  });

  test('returns true for user-initiated withdraw', () => {
    const transaction: SubstrateTransaction = {
      amount: '10000000000',
      blockHeight: 15000002,
      call: 'withdraw_unbonded',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0x789',
      module: 'staking',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const fundFlow: SubstrateFundFlow = {
      call: 'withdraw_unbonded',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: true,
      hasUtilityBatch: false,
      inflows: [{ amount: '1', asset: 'DOT' }],
      module: 'staking',
      outflows: [],
      primary: { amount: '1', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const userPaidFee = didUserPayFee(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(true);
  });

  test('returns true for user-initiated nominate', () => {
    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000003,
      call: 'nominate',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0xabc',
      module: 'staking',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const fundFlow: SubstrateFundFlow = {
      call: 'nominate',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: true,
      hasUtilityBatch: false,
      inflows: [],
      module: 'staking',
      outflows: [],
      primary: { amount: '0', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const userPaidFee = didUserPayFee(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(true);
  });

  test('returns true for user-initiated chill', () => {
    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000004,
      call: 'chill',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0xdef',
      module: 'staking',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const fundFlow: SubstrateFundFlow = {
      call: 'chill',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: true,
      hasUtilityBatch: false,
      inflows: [],
      module: 'staking',
      outflows: [],
      primary: { amount: '0', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const userPaidFee = didUserPayFee(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(true);
  });

  test('returns true when from address matches user', () => {
    const transaction: SubstrateTransaction = {
      amount: '0',
      blockHeight: 15000005,
      call: 'remark',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: POLKADOT_ADDRESS,
      id: '0xghi',
      module: 'system',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const fundFlow: SubstrateFundFlow = {
      call: 'remark',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: POLKADOT_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [],
      module: 'system',
      outflows: [],
      primary: { amount: '0', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const userPaidFee = didUserPayFee(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(true);
  });

  test('returns false for incoming transfer', () => {
    const transaction: SubstrateTransaction = {
      amount: '10000000000',
      blockHeight: 15000006,
      call: 'transfer',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '156250000',
      from: EXTERNAL_ADDRESS,
      id: '0xjkl',
      module: 'balances',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const fundFlow: SubstrateFundFlow = {
      call: 'transfer',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0.015625',
      feeCurrency: 'DOT',
      fromAddress: EXTERNAL_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: false,
      hasUtilityBatch: false,
      inflows: [{ amount: '1', asset: 'DOT' }],
      module: 'balances',
      outflows: [],
      primary: { amount: '1', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const userPaidFee = didUserPayFee(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(false);
  });

  test('returns false for staking reward', () => {
    const transaction: SubstrateTransaction = {
      amount: '5000000000',
      blockHeight: 15000007,
      call: 'bond',
      chainName: 'polkadot',
      currency: 'DOT',
      feeAmount: '0',
      from: EXTERNAL_ADDRESS,
      id: '0xmno',
      module: 'staking',
      providerName: 'subscan',
      status: 'success',
      timestamp: Date.now(),
      to: POLKADOT_ADDRESS,
    };

    const fundFlow: SubstrateFundFlow = {
      call: 'bond',
      chainName: 'polkadot',
      eventCount: 1,
      extrinsicCount: 1,
      feeAmount: '0',
      feeCurrency: 'DOT',
      fromAddress: EXTERNAL_ADDRESS,
      hasGovernance: false,
      hasMultisig: false,
      hasProxy: false,
      hasStaking: true,
      hasUtilityBatch: false,
      inflows: [{ amount: '0.5', asset: 'DOT' }],
      module: 'staking',
      outflows: [],
      primary: { amount: '0.5', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    };

    const userPaidFee = didUserPayFee(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(false);
  });
});
