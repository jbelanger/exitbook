import type { SubstrateChainConfig, SubstrateTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import {
  analyzeFundFlowFromNormalized,
  determineOperationFromFundFlow,
  shouldRecordFeeEntry,
  expandSourceContext,
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

// Helper function to create transaction objects with defaults
function createTransaction(overrides: Partial<SubstrateTransaction> = {}): SubstrateTransaction {
  return {
    amount: '0',
    blockHeight: 15000000,
    blockId: '0xabc123',
    call: 'transfer',
    chainName: 'polkadot',
    currency: 'DOT',
    eventId: 'default_event_id',
    feeAmount: '156250000',
    feeCurrency: 'DOT',
    from: POLKADOT_ADDRESS,
    id: '0x123abc',
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
    primaryAddress: POLKADOT_ADDRESS,
    userAddresses: [POLKADOT_ADDRESS],
    ...overrides,
  };
}

// Helper function to create fund flow objects with defaults
function createFundFlow(overrides: Partial<SubstrateFundFlow> = {}): SubstrateFundFlow {
  return {
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
    outflows: [],
    primary: { amount: '0', asset: 'DOT' },
    toAddress: EXTERNAL_ADDRESS,
    ...overrides,
  };
}

// Helper function to analyze fund flow with defaults
function getFundFlow(
  transaction: SubstrateTransaction,
  sessionContext = createSessionContext(),
  config = POLKADOT_CONFIG
) {
  return analyzeFundFlowFromNormalized(transaction, sessionContext, config)._unsafeUnwrap();
}

describe('expandSourceContext', () => {
  test('enriches Polkadot address with SS58 variants', () => {
    const result = expandSourceContext(POLKADOT_ADDRESS);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const context = result.value;
    expect(context.address).toBe(POLKADOT_ADDRESS);
    expect(Array.isArray(context.derivedAddresses)).toBe(true);
    expect((context.derivedAddresses as string[]).length).toBeGreaterThan(0);
    expect((context.derivedAddresses as string[]).includes(POLKADOT_ADDRESS)).toBe(true);
  });

  test('enriches Kusama address with SS58 variants', () => {
    const result = expandSourceContext(KUSAMA_ADDRESS);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const context = result.value;
    expect(context.address).toBe(KUSAMA_ADDRESS);
    expect(Array.isArray(context.derivedAddresses)).toBe(true);
    expect((context.derivedAddresses as string[]).length).toBeGreaterThan(0);
  });

  test('enriches Bittensor address with SS58 variants', () => {
    const result = expandSourceContext(BITTENSOR_ADDRESS);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const context = result.value;
    expect(context.address).toBe(BITTENSOR_ADDRESS);
    expect(Array.isArray(context.derivedAddresses)).toBe(true);
    expect((context.derivedAddresses as string[]).length).toBeGreaterThan(0);
  });

  test('returns error for empty address', () => {
    const result = expandSourceContext('');

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error).toContain('Missing address');
  });

  test('generates unique derived addresses', () => {
    const result = expandSourceContext(POLKADOT_ADDRESS);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const derivedAddresses = result.value.derivedAddresses as string[];
    const uniqueSet = new Set(derivedAddresses);
    expect(uniqueSet.size).toBe(derivedAddresses.length);
  });
});

describe('analyzeFundFlowFromNormalized', () => {
  test('analyzes outgoing transfer correctly', () => {
    const transaction = createTransaction({
      amount: '10000000000', // 1 DOT in planck
      feeAmount: '156250000', // 0.015625 DOT in planck
    });

    const fundFlow = getFundFlow(transaction);

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
    const transaction = createTransaction({
      amount: '20000000000', // 2 DOT in planck
      from: EXTERNAL_ADDRESS,
      to: POLKADOT_ADDRESS,
    });

    const fundFlow = getFundFlow(transaction);

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
    const transaction = createTransaction({
      amount: '5000000000', // 0.5 DOT in planck
      to: POLKADOT_ADDRESS,
    });

    const fundFlow = getFundFlow(transaction);

    expect(fundFlow.inflows).toHaveLength(1);
    expect(fundFlow.inflows[0]?.amount).toBe('0.5');
    expect(fundFlow.outflows).toHaveLength(1);
    expect(fundFlow.outflows[0]?.amount).toBe('0.5');
    expect(fundFlow.primary.amount).toBe('0.5');
    expect(fundFlow.fromAddress).toBe(POLKADOT_ADDRESS);
    expect(fundFlow.toAddress).toBe(POLKADOT_ADDRESS);
  });

  test('detects staking transactions', () => {
    const transaction = createTransaction({
      amount: '10000000000', // 1 DOT
      call: 'bond',
      module: 'staking',
    });

    const fundFlow = getFundFlow(transaction);

    expect(fundFlow.hasStaking).toBe(true);
    expect(fundFlow.module).toBe('staking');
    expect(fundFlow.call).toBe('bond');
  });

  test('detects governance transactions', () => {
    const transaction = createTransaction({
      amount: '100000000000', // 10 DOT
      call: 'vote',
      module: 'democracy',
      to: EXTERNAL_ADDRESS,
    });

    const fundFlow = getFundFlow(transaction);

    expect(fundFlow.hasGovernance).toBe(true);
    expect(fundFlow.module).toBe('democracy');
  });

  test('detects utility batch transactions', () => {
    const transaction = createTransaction({
      amount: '0',
      call: 'batch_all',
      events: [
        { data: [], method: 'Transfer', section: 'balances' },
        { data: [], method: 'Transfer', section: 'balances' },
        { data: [], method: 'Transfer', section: 'balances' },
        { data: [], method: 'Transfer', section: 'balances' },
        { data: [], method: 'Transfer', section: 'balances' },
        { data: [], method: 'Transfer', section: 'balances' },
      ],
      feeAmount: '312500000',
      module: 'utility',
      to: POLKADOT_ADDRESS,
    });

    const fundFlow = getFundFlow(transaction);

    expect(fundFlow.hasUtilityBatch).toBe(true);
    expect(fundFlow.eventCount).toBe(6);
    expect(fundFlow.classificationUncertainty).toContain('Utility batch');
  });

  test('detects proxy transactions', () => {
    const transaction = createTransaction({
      amount: '0',
      call: 'proxy',
      module: 'proxy',
      to: POLKADOT_ADDRESS_2,
    });

    const fundFlow = getFundFlow(transaction);

    expect(fundFlow.hasProxy).toBe(true);
    expect(fundFlow.module).toBe('proxy');
  });

  test('detects multisig transactions', () => {
    const transaction = createTransaction({
      amount: '0',
      call: 'as_multi',
      module: 'multisig',
    });

    const fundFlow = getFundFlow(transaction);

    expect(fundFlow.hasMultisig).toBe(true);
    expect(fundFlow.module).toBe('multisig');
  });

  test('handles zero amount transactions', () => {
    const transaction = createTransaction({
      amount: '0',
      call: 'nominate',
      module: 'staking',
      to: POLKADOT_ADDRESS,
    });

    const fundFlow = getFundFlow(transaction);

    expect(fundFlow.inflows).toHaveLength(0);
    expect(fundFlow.outflows).toHaveLength(0);
    expect(fundFlow.primary.amount).toBe('0');
    expect(fundFlow.primary.asset).toBe('DOT');
    expect(fundFlow.feeAmount).toBe('0.015625');
  });

  test('handles transactions with derived addresses', () => {
    const genericAddress = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
    const polkadotAddress = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';

    const transaction = createTransaction({
      amount: '10000000000',
      from: polkadotAddress,
    });

    const sessionContext = createSessionContext({
      primaryAddress: genericAddress,
      userAddresses: [genericAddress, polkadotAddress],
    });

    const fundFlow = getFundFlow(transaction, sessionContext);

    expect(fundFlow.outflows).toHaveLength(1);
    expect(fundFlow.outflows[0]?.amount).toBe('1');
  });
});

describe('determineOperationFromFundFlow', () => {
  test('classifies staking bond as stake', () => {
    const fundFlow = createFundFlow({
      call: 'bond',
      hasStaking: true,
      module: 'staking',
      outflows: [{ amount: '10', asset: 'DOT' }],
      primary: { amount: '10', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    });

    const transaction = createTransaction({
      amount: '100000000000',
      call: 'bond',
      module: 'staking',
      to: POLKADOT_ADDRESS,
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('staking');
    expect(classification.operation.type).toBe('stake');
  });

  test('classifies staking unbond as unstake', () => {
    const fundFlow = createFundFlow({
      call: 'unbond',
      hasStaking: true,
      module: 'staking',
      toAddress: POLKADOT_ADDRESS,
    });

    const transaction = createTransaction({
      amount: '0',
      call: 'unbond',
      module: 'staking',
      to: POLKADOT_ADDRESS,
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('staking');
    expect(classification.operation.type).toBe('unstake');
  });

  test('classifies staking withdraw as unstake', () => {
    const fundFlow = createFundFlow({
      call: 'withdraw_unbonded',
      hasStaking: true,
      inflows: [{ amount: '10', asset: 'DOT' }],
      module: 'staking',
      primary: { amount: '10', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    });

    const transaction = createTransaction({
      amount: '100000000000',
      call: 'withdraw_unbonded',
      module: 'staking',
      to: POLKADOT_ADDRESS,
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('staking');
    expect(classification.operation.type).toBe('unstake');
  });

  test('classifies staking reward as reward', () => {
    const fundFlow = createFundFlow({
      call: 'bond',
      feeAmount: '0',
      fromAddress: EXTERNAL_ADDRESS,
      hasStaking: true,
      inflows: [{ amount: '0.5', asset: 'DOT' }],
      module: 'staking',
      outflows: [],
      primary: { amount: '0.5', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    });

    const transaction = createTransaction({
      amount: '5000000000',
      blockHeight: 15000003,
      call: 'bond',
      feeAmount: '0',
      from: EXTERNAL_ADDRESS,
      id: '0xabc',
      module: 'staking',
      to: POLKADOT_ADDRESS,
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('staking');
    expect(classification.operation.type).toBe('reward');
  });

  test('classifies nominate with info note', () => {
    const fundFlow = createFundFlow({
      call: 'nominate',
      hasStaking: true,
      module: 'staking',
      toAddress: POLKADOT_ADDRESS,
    });

    const transaction = createTransaction({
      amount: '0',
      call: 'nominate',
      module: 'staking',
      to: POLKADOT_ADDRESS,
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('staking');
    expect(classification.operation.type).toBe('stake');
    expect(classification.notes).toBeDefined();
    expect(classification.notes?.[0]?.type).toBe('staking_operation');
    expect(classification.notes?.[0]?.message).toContain('nominate');
  });

  test('classifies governance proposal', () => {
    const fundFlow = createFundFlow({
      call: 'propose',
      hasGovernance: true,
      module: 'democracy',
      outflows: [{ amount: '100', asset: 'DOT' }],
      primary: { amount: '100', asset: 'DOT' },
    });

    const transaction = createTransaction({
      amount: '1000000000000',
      call: 'propose',
      module: 'democracy',
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('governance');
    expect(classification.operation.type).toBe('proposal');
  });

  test('classifies governance vote', () => {
    const fundFlow = createFundFlow({
      call: 'vote',
      hasGovernance: true,
      module: 'democracy',
      outflows: [{ amount: '10', asset: 'DOT' }],
      primary: { amount: '10', asset: 'DOT' },
    });

    const transaction = createTransaction({
      amount: '100000000000',
      call: 'vote',
      module: 'democracy',
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('governance');
    expect(classification.operation.type).toBe('vote');
  });

  test('classifies governance refund', () => {
    const fundFlow = createFundFlow({
      call: 'refund',
      feeAmount: '0',
      fromAddress: EXTERNAL_ADDRESS,
      hasGovernance: true,
      inflows: [{ amount: '10', asset: 'DOT' }],
      module: 'democracy',
      primary: { amount: '10', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    });

    const transaction = createTransaction({
      amount: '100000000000',
      call: 'refund',
      feeAmount: '0',
      from: EXTERNAL_ADDRESS,
      module: 'democracy',
      to: POLKADOT_ADDRESS,
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('governance');
    expect(classification.operation.type).toBe('refund');
  });

  test('classifies utility batch with warning note', () => {
    const fundFlow = createFundFlow({
      call: 'batch_all',
      classificationUncertainty:
        'Utility batch with 6 events. May contain multiple operations that need separate accounting.',
      eventCount: 6,
      feeAmount: '0.03125',
      hasUtilityBatch: true,
      inflows: [{ amount: '2', asset: 'DOT' }],
      module: 'utility',
      outflows: [{ amount: '5', asset: 'DOT' }],
      primary: { amount: '5', asset: 'DOT' },
    });

    const transaction = createTransaction({
      amount: '0',
      blockHeight: 15000008,
      call: 'batch_all',
      feeAmount: '312500000',
      from: POLKADOT_ADDRESS,
      id: '0xpqr',
      module: 'utility',
      to: EXTERNAL_ADDRESS,
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('transfer');
    expect(classification.notes).toBeDefined();
    expect(classification.notes?.[0]?.type).toBe('batch_operation');
    expect(classification.notes?.[0]?.severity).toBe('warning');
  });

  test('classifies proxy operation with info note', () => {
    const fundFlow = createFundFlow({
      call: 'proxy',
      hasProxy: true,
      module: 'proxy',
      toAddress: POLKADOT_ADDRESS_2,
    });

    const transaction = createTransaction({
      amount: '0',
      call: 'proxy',
      module: 'proxy',
      to: POLKADOT_ADDRESS_2,
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('transfer');
    expect(classification.notes).toBeDefined();
    expect(classification.notes?.[0]?.type).toBe('proxy_operation');
    expect(classification.notes?.[0]?.severity).toBe('info');
  });

  test('classifies multisig operation with info note', () => {
    const fundFlow = createFundFlow({
      call: 'as_multi',
      hasMultisig: true,
      module: 'multisig',
      outflows: [{ amount: '1', asset: 'DOT' }],
      primary: { amount: '1', asset: 'DOT' },
    });

    const transaction = createTransaction({
      amount: '10000000000',
      call: 'as_multi',
      module: 'multisig',
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('transfer');
    expect(classification.notes).toBeDefined();
    expect(classification.notes?.[0]?.type).toBe('multisig_operation');
    expect(classification.notes?.[0]?.severity).toBe('info');
  });

  test('classifies fee-only transaction', () => {
    const fundFlow = createFundFlow({
      call: 'remark',
      module: 'system',
      toAddress: POLKADOT_ADDRESS,
    });

    const transaction = createTransaction({
      amount: '0',
      call: 'remark',
      module: 'system',
      to: POLKADOT_ADDRESS,
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('fee');
    expect(classification.operation.type).toBe('fee');
  });

  test('classifies simple deposit', () => {
    const fundFlow = createFundFlow({
      fromAddress: EXTERNAL_ADDRESS,
      inflows: [{ amount: '5', asset: 'DOT' }],
      primary: { amount: '5', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    });

    const transaction = createTransaction({
      amount: '50000000000',
      from: EXTERNAL_ADDRESS,
      to: POLKADOT_ADDRESS,
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('deposit');
  });

  test('classifies simple withdrawal', () => {
    const fundFlow = createFundFlow({
      outflows: [{ amount: '3', asset: 'DOT' }],
      primary: { amount: '3', asset: 'DOT' },
    });

    const transaction = createTransaction({
      amount: '30000000000',
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('withdrawal');
  });

  test('classifies self-transfer', () => {
    const fundFlow = createFundFlow({
      inflows: [{ amount: '1', asset: 'DOT' }],
      outflows: [{ amount: '1', asset: 'DOT' }],
      primary: { amount: '1', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    });

    const transaction = createTransaction({
      amount: '10000000000',
      to: POLKADOT_ADDRESS,
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('transfer');
  });

  test('classifies unknown transaction with warning note', () => {
    const fundFlow = createFundFlow({
      call: 'unknown_call',
      inflows: [
        { amount: '2', asset: 'DOT' },
        { amount: '1', asset: 'KSM' },
      ],
      module: 'unknown_module',
      outflows: [{ amount: '3', asset: 'DOT' }],
      primary: { amount: '3', asset: 'DOT' },
    });

    const transaction = createTransaction({
      amount: '0',
      call: 'unknown_call',
      module: 'unknown_module',
    });

    const classification = determineOperationFromFundFlow(fundFlow, transaction);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('transfer');
    expect(classification.notes).toBeDefined();
    expect(classification.notes?.[0]?.type).toBe('classification_failed');
    expect(classification.notes?.[0]?.severity).toBe('warning');
  });
});

describe('shouldRecordFeeEntry', () => {
  test('returns true when user has outflows', () => {
    const transaction = createTransaction({
      amount: '10000000000',
    });

    const fundFlow = createFundFlow({
      outflows: [{ amount: '1', asset: 'DOT' }],
      primary: { amount: '1', asset: 'DOT' },
    });

    const userPaidFee = shouldRecordFeeEntry(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(true);
  });

  test('returns true for user-initiated unbond', () => {
    const transaction = createTransaction({
      amount: '0',
      call: 'unbond',
      module: 'staking',
      to: POLKADOT_ADDRESS,
    });

    const fundFlow = createFundFlow({
      call: 'unbond',
      hasStaking: true,
      module: 'staking',
      toAddress: POLKADOT_ADDRESS,
    });

    const userPaidFee = shouldRecordFeeEntry(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(true);
  });

  test('returns true for user-initiated withdraw', () => {
    const transaction = createTransaction({
      amount: '10000000000',
      call: 'withdraw_unbonded',
      module: 'staking',
      to: POLKADOT_ADDRESS,
    });

    const fundFlow = createFundFlow({
      call: 'withdraw_unbonded',
      hasStaking: true,
      inflows: [{ amount: '1', asset: 'DOT' }],
      module: 'staking',
      primary: { amount: '1', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    });

    const userPaidFee = shouldRecordFeeEntry(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(true);
  });

  test('returns true for user-initiated nominate', () => {
    const transaction = createTransaction({
      amount: '0',
      call: 'nominate',
      module: 'staking',
      to: POLKADOT_ADDRESS,
    });

    const fundFlow = createFundFlow({
      call: 'nominate',
      hasStaking: true,
      module: 'staking',
      toAddress: POLKADOT_ADDRESS,
    });

    const userPaidFee = shouldRecordFeeEntry(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(true);
  });

  test('returns true for user-initiated chill', () => {
    const transaction = createTransaction({
      amount: '0',
      call: 'chill',
      module: 'staking',
      to: POLKADOT_ADDRESS,
    });

    const fundFlow = createFundFlow({
      call: 'chill',
      hasStaking: true,
      module: 'staking',
      toAddress: POLKADOT_ADDRESS,
    });

    const userPaidFee = shouldRecordFeeEntry(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(true);
  });

  test('returns true when from address matches user', () => {
    const transaction = createTransaction({
      amount: '0',
      call: 'remark',
      module: 'system',
      to: POLKADOT_ADDRESS,
    });

    const fundFlow = createFundFlow({
      call: 'remark',
      module: 'system',
      toAddress: POLKADOT_ADDRESS,
    });

    const userPaidFee = shouldRecordFeeEntry(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(true);
  });

  test('returns false for incoming transfer', () => {
    const transaction = createTransaction({
      amount: '10000000000',
      from: EXTERNAL_ADDRESS,
      to: POLKADOT_ADDRESS,
    });

    const fundFlow = createFundFlow({
      fromAddress: EXTERNAL_ADDRESS,
      inflows: [{ amount: '1', asset: 'DOT' }],
      primary: { amount: '1', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    });

    const userPaidFee = shouldRecordFeeEntry(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(false);
  });

  test('returns false for staking reward', () => {
    const transaction = createTransaction({
      amount: '5000000000',
      call: 'bond',
      feeAmount: '0',
      from: EXTERNAL_ADDRESS,
      module: 'staking',
      to: POLKADOT_ADDRESS,
    });

    const fundFlow = createFundFlow({
      call: 'bond',
      feeAmount: '0',
      fromAddress: EXTERNAL_ADDRESS,
      hasStaking: true,
      inflows: [{ amount: '0.5', asset: 'DOT' }],
      module: 'staking',
      primary: { amount: '0.5', asset: 'DOT' },
      toAddress: POLKADOT_ADDRESS,
    });

    const userPaidFee = shouldRecordFeeEntry(transaction, fundFlow, POLKADOT_ADDRESS);

    expect(userPaidFee).toBe(false);
  });
});
