import type { NearTransaction } from '@exitbook/providers';
import { describe, expect, test } from 'vitest';

import {
  analyzeNearFundFlow,
  classifyNearOperationFromFundFlow,
  consolidateNearMovements,
  detectNearContractCalls,
  detectNearStakingActions,
  detectNearTokenTransfers,
  determineNearTransactionType,
  extractNearTokenTransfers,
  isZeroDecimal,
} from '../processor-utils.js';
import type { NearFundFlow } from '../types.js';

const USER_ADDRESS = 'user.near';
const EXTERNAL_ADDRESS = 'external.near';
const CONTRACT_ADDRESS = 'token.near';

describe('NEAR Processor Utils - Detection Functions', () => {
  test('detectNearStakingActions identifies stake action', () => {
    const actions = [
      {
        actionType: 'Stake',
        deposit: '1000000000000000000000000', // 1 NEAR
      },
    ];

    expect(detectNearStakingActions(actions)).toBe(true);
  });

  test('detectNearStakingActions identifies stake action (uppercase)', () => {
    const actions = [
      {
        actionType: 'STAKE',
        deposit: '1000000000000000000000000',
      },
    ];

    expect(detectNearStakingActions(actions)).toBe(true);
  });

  test('detectNearStakingActions identifies unstake action', () => {
    const actions = [
      {
        actionType: 'Unstake',
        deposit: '1000000000000000000000000',
      },
    ];

    expect(detectNearStakingActions(actions)).toBe(true);
  });

  test('detectNearStakingActions returns false for non-staking actions', () => {
    const actions = [
      {
        actionType: 'Transfer',
        deposit: '1000000000000000000000000',
      },
    ];

    expect(detectNearStakingActions(actions)).toBe(false);
  });

  test('detectNearContractCalls identifies function call', () => {
    const actions = [
      {
        actionType: 'FunctionCall',
        gas: '30000000000000',
        methodName: 'ft_transfer',
      },
    ];

    expect(detectNearContractCalls(actions)).toBe(true);
  });

  test('detectNearContractCalls identifies function call (uppercase)', () => {
    const actions = [
      {
        actionType: 'FUNCTION_CALL',
        gas: '30000000000000',
        methodName: 'ft_transfer',
      },
    ];

    expect(detectNearContractCalls(actions)).toBe(true);
  });

  test('detectNearTokenTransfers identifies token transfer method', () => {
    const actions = [
      {
        actionType: 'FunctionCall',
        gas: '30000000000000',
        methodName: 'ft_transfer',
      },
    ];

    expect(detectNearTokenTransfers(actions)).toBe(true);
  });

  test('detectNearTokenTransfers identifies ft_transfer_call method', () => {
    const actions = [
      {
        actionType: 'FunctionCall',
        gas: '30000000000000',
        methodName: 'ft_transfer_call',
      },
    ];

    expect(detectNearTokenTransfers(actions)).toBe(true);
  });

  test('detectNearTokenTransfers identifies token transfer (uppercase action)', () => {
    const actions = [
      {
        actionType: 'FUNCTION_CALL',
        gas: '30000000000000',
        methodName: 'ft_transfer',
      },
    ];

    expect(detectNearTokenTransfers(actions)).toBe(true);
  });
});

describe('NEAR Processor Utils - Token Transfer Extraction', () => {
  test('extractNearTokenTransfers parses NEP-141 token transfers', () => {
    const tx: NearTransaction = {
      amount: '0',
      currency: 'NEAR',
      from: USER_ADDRESS,
      id: 'tx1',
      providerName: 'nearblocks',
      status: 'success',
      timestamp: Date.now(),
      to: CONTRACT_ADDRESS,
      tokenTransfers: [
        {
          amount: '1000000', // 1 token with 6 decimals
          contractAddress: CONTRACT_ADDRESS,
          decimals: 6,
          from: USER_ADDRESS,
          symbol: 'USDC',
          to: EXTERNAL_ADDRESS,
        },
      ],
    };

    const movements = extractNearTokenTransfers(tx);

    expect(movements).toHaveLength(1);
    expect(movements[0]?.asset).toBe('USDC');
    expect(movements[0]?.amount).toBe('1');
    expect(movements[0]?.decimals).toBe(6);
    expect(movements[0]?.tokenAddress).toBe(CONTRACT_ADDRESS);
  });

  test('extractNearTokenTransfers returns empty array when no token transfers', () => {
    const tx: NearTransaction = {
      amount: '1000000000000000000000000',
      currency: 'NEAR',
      from: USER_ADDRESS,
      id: 'tx1',
      providerName: 'nearblocks',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const movements = extractNearTokenTransfers(tx);

    expect(movements).toHaveLength(0);
  });
});

describe('NEAR Processor Utils - Movement Consolidation', () => {
  test('consolidateNearMovements sums duplicate assets', () => {
    const movements = [
      { amount: '1.5', asset: 'NEAR' },
      { amount: '2.5', asset: 'NEAR' },
      { amount: '1.0', asset: 'USDC', decimals: 6, tokenAddress: CONTRACT_ADDRESS },
    ];

    const consolidated = consolidateNearMovements(movements);

    expect(consolidated).toHaveLength(2);
    const nearMovement = consolidated.find((m) => m.asset === 'NEAR');
    expect(nearMovement?.amount).toBe('4');
    const usdcMovement = consolidated.find((m) => m.asset === 'USDC');
    expect(usdcMovement?.amount).toBe('1');
  });

  test('consolidateNearMovements preserves decimals and token address', () => {
    const movements = [
      { amount: '1.0', asset: 'USDC', decimals: 6, tokenAddress: CONTRACT_ADDRESS },
      { amount: '2.0', asset: 'USDC', decimals: 6, tokenAddress: CONTRACT_ADDRESS },
    ];

    const consolidated = consolidateNearMovements(movements);

    expect(consolidated).toHaveLength(1);
    expect(consolidated[0]?.amount).toBe('3');
    expect(consolidated[0]?.decimals).toBe(6);
    expect(consolidated[0]?.tokenAddress).toBe(CONTRACT_ADDRESS);
  });
});

describe('NEAR Processor Utils - Zero Detection', () => {
  test('isZeroDecimal identifies zero values', () => {
    expect(isZeroDecimal('0')).toBe(true);
    expect(isZeroDecimal('0.0')).toBe(true);
    expect(isZeroDecimal('0.00000000')).toBe(true);
  });

  test('isZeroDecimal identifies non-zero values', () => {
    expect(isZeroDecimal('1')).toBe(false);
    expect(isZeroDecimal('0.1')).toBe(false);
    expect(isZeroDecimal('0.00000001')).toBe(false);
  });

  test('isZeroDecimal handles invalid values', () => {
    expect(isZeroDecimal('')).toBe(true);
    expect(isZeroDecimal('invalid')).toBe(true);
  });
});

describe('NEAR Processor Utils - Fund Flow Analysis', () => {
  test('analyzeNearFundFlow detects incoming NEAR transfer', () => {
    const tx: NearTransaction = {
      accountChanges: [
        {
          account: USER_ADDRESS,
          postBalance: '2000000000000000000000000', // 2 NEAR
          preBalance: '1000000000000000000000000', // 1 NEAR
        },
      ],
      amount: '1000000000000000000000000',
      currency: 'NEAR',
      feeAmount: '0.0001',
      from: EXTERNAL_ADDRESS,
      id: 'tx1',
      providerName: 'nearblocks',
      status: 'success',
      timestamp: Date.now(),
      to: USER_ADDRESS,
    };

    const result = analyzeNearFundFlow(tx, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.inflows).toHaveLength(1);
    expect(fundFlow.inflows[0]?.asset).toBe('NEAR');
    expect(fundFlow.inflows[0]?.amount).toBe('1');
    expect(fundFlow.outflows).toHaveLength(0);
    expect(fundFlow.feePaidByUser).toBe(false); // Receiver doesn't pay fee
  });

  test('analyzeNearFundFlow detects outgoing NEAR transfer', () => {
    const tx: NearTransaction = {
      accountChanges: [
        {
          account: USER_ADDRESS,
          postBalance: '0', // All NEAR sent
          preBalance: '5100000000000000000000000', // 5.1 NEAR total
        },
      ],
      amount: '5000000000000000000000000',
      currency: 'NEAR',
      feeAmount: '0.1', // 0.1 NEAR fee
      from: USER_ADDRESS,
      id: 'tx2',
      providerName: 'nearblocks',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const result = analyzeNearFundFlow(tx, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.inflows).toHaveLength(0);
    expect(fundFlow.outflows).toHaveLength(1);
    expect(fundFlow.outflows[0]?.asset).toBe('NEAR');
    expect(fundFlow.outflows[0]?.amount).toBe('5'); // Fee deducted from outflow
    expect(fundFlow.feePaidByUser).toBe(true); // Sender pays fee
  });

  test('analyzeNearFundFlow handles token transfers', () => {
    const tx: NearTransaction = {
      actions: [
        {
          actionType: 'FunctionCall',
          gas: '30000000000000',
          methodName: 'ft_transfer',
        },
      ],
      amount: '0',
      currency: 'NEAR',
      feeAmount: '0.0001',
      from: USER_ADDRESS,
      id: 'tx3',
      providerName: 'nearblocks',
      status: 'success',
      timestamp: Date.now(),
      to: CONTRACT_ADDRESS,
      tokenTransfers: [
        {
          amount: '1000000', // 1 USDC
          contractAddress: CONTRACT_ADDRESS,
          decimals: 6,
          from: USER_ADDRESS,
          symbol: 'USDC',
          to: EXTERNAL_ADDRESS,
        },
      ],
    };

    const result = analyzeNearFundFlow(tx, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;
    expect(fundFlow.outflows).toHaveLength(1);
    expect(fundFlow.outflows[0]?.asset).toBe('USDC');
    expect(fundFlow.outflows[0]?.amount).toBe('1');
    expect(fundFlow.hasTokenTransfers).toBe(true);
  });

  test('analyzeNearFundFlow requires user address in metadata', () => {
    const tx: NearTransaction = {
      amount: '0',
      currency: 'NEAR',
      from: USER_ADDRESS,
      id: 'tx4',
      providerName: 'nearblocks',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const result = analyzeNearFundFlow(tx, {});

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error).toContain('Missing user address');
  });
});

describe('NEAR Processor Utils - Operation Classification', () => {
  test('classifyNearOperationFromFundFlow identifies stake operation', () => {
    const fundFlow: NearFundFlow = {
      actionCount: 1,
      actionTypes: ['Stake'],
      feeAbsorbedByMovement: false,
      feeAmount: '0.0001',
      feeCurrency: 'NEAR',
      feePaidByUser: true,
      hasContractCall: false,
      hasStaking: true,
      hasTokenTransfers: false,
      inflows: [],
      outflows: [{ amount: '10', asset: 'NEAR' }],
      primary: { amount: '10', asset: 'NEAR' },
    };

    const classification = classifyNearOperationFromFundFlow(fundFlow, []);

    expect(classification.operation.category).toBe('staking');
    expect(classification.operation.type).toBe('stake');
  });

  test('classifyNearOperationFromFundFlow identifies unstake operation', () => {
    const fundFlow: NearFundFlow = {
      actionCount: 1,
      actionTypes: ['Unstake'],
      feeAbsorbedByMovement: false,
      feeAmount: '0.0001',
      feeCurrency: 'NEAR',
      feePaidByUser: false,
      hasContractCall: false,
      hasStaking: true,
      hasTokenTransfers: false,
      inflows: [{ amount: '10', asset: 'NEAR' }],
      outflows: [],
      primary: { amount: '10', asset: 'NEAR' },
    };

    const classification = classifyNearOperationFromFundFlow(fundFlow, []);

    expect(classification.operation.category).toBe('staking');
    expect(classification.operation.type).toBe('unstake');
  });

  test('classifyNearOperationFromFundFlow identifies swap', () => {
    const fundFlow: NearFundFlow = {
      actionCount: 1,
      actionTypes: ['FunctionCall'],
      feeAbsorbedByMovement: false,
      feeAmount: '0.0001',
      feeCurrency: 'NEAR',
      feePaidByUser: true,
      hasContractCall: false,
      hasStaking: false,
      hasTokenTransfers: false,
      inflows: [{ amount: '100', asset: 'USDC', decimals: 6 }],
      outflows: [{ amount: '1', asset: 'NEAR' }],
      primary: { amount: '100', asset: 'USDC', decimals: 6 },
    };

    const classification = classifyNearOperationFromFundFlow(fundFlow, []);

    expect(classification.operation.category).toBe('trade');
    expect(classification.operation.type).toBe('swap');
  });

  test('classifyNearOperationFromFundFlow identifies deposit', () => {
    const fundFlow: NearFundFlow = {
      actionCount: 1,
      actionTypes: ['Transfer'],
      feeAbsorbedByMovement: false,
      feeAmount: '0.0001',
      feeCurrency: 'NEAR',
      feePaidByUser: false,
      hasContractCall: false,
      hasStaking: false,
      hasTokenTransfers: false,
      inflows: [{ amount: '5', asset: 'NEAR' }],
      outflows: [],
      primary: { amount: '5', asset: 'NEAR' },
    };

    const classification = classifyNearOperationFromFundFlow(fundFlow, []);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('deposit');
  });

  test('classifyNearOperationFromFundFlow identifies withdrawal', () => {
    const fundFlow: NearFundFlow = {
      actionCount: 1,
      actionTypes: ['Transfer'],
      feeAbsorbedByMovement: false,
      feeAmount: '0.0001',
      feeCurrency: 'NEAR',
      feePaidByUser: true,
      hasContractCall: false,
      hasStaking: false,
      hasTokenTransfers: false,
      inflows: [],
      outflows: [{ amount: '5', asset: 'NEAR' }],
      primary: { amount: '5', asset: 'NEAR' },
    };

    const classification = classifyNearOperationFromFundFlow(fundFlow, []);

    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('withdrawal');
  });

  test('classifyNearOperationFromFundFlow identifies fee-only transaction', () => {
    const fundFlow: NearFundFlow = {
      actionCount: 1,
      actionTypes: ['FunctionCall'],
      feeAbsorbedByMovement: true,
      feeAmount: '0.0001',
      feeCurrency: 'NEAR',
      feePaidByUser: true,
      hasContractCall: true,
      hasStaking: false,
      hasTokenTransfers: false,
      inflows: [],
      outflows: [],
      primary: { amount: '0', asset: 'NEAR' },
    };

    const classification = classifyNearOperationFromFundFlow(fundFlow, []);

    expect(classification.operation.category).toBe('fee');
    expect(classification.operation.type).toBe('fee');
  });
});

describe('NEAR Processor Utils - Transaction Type Determination', () => {
  test('determineNearTransactionType identifies stake', () => {
    const fundFlow: NearFundFlow = {
      actionCount: 1,
      actionTypes: ['Stake'],
      feeAbsorbedByMovement: false,
      feeAmount: '0.0001',
      feeCurrency: 'NEAR',
      feePaidByUser: true,
      hasContractCall: false,
      hasStaking: true,
      hasTokenTransfers: false,
      inflows: [],
      outflows: [{ amount: '10', asset: 'NEAR' }],
      primary: { amount: '10', asset: 'NEAR' },
    };

    expect(determineNearTransactionType(fundFlow)).toBe('Stake');
  });

  test('determineNearTransactionType identifies unstake', () => {
    const fundFlow: NearFundFlow = {
      actionCount: 1,
      actionTypes: ['Unstake'],
      feeAbsorbedByMovement: false,
      feeAmount: '0.0001',
      feeCurrency: 'NEAR',
      feePaidByUser: false,
      hasContractCall: false,
      hasStaking: true,
      hasTokenTransfers: false,
      inflows: [{ amount: '10', asset: 'NEAR' }],
      outflows: [],
      primary: { amount: '10', asset: 'NEAR' },
    };

    expect(determineNearTransactionType(fundFlow)).toBe('Unstake');
  });

  test('determineNearTransactionType identifies token transfer', () => {
    const fundFlow: NearFundFlow = {
      actionCount: 1,
      actionTypes: ['FunctionCall'],
      feeAbsorbedByMovement: false,
      feeAmount: '0.0001',
      feeCurrency: 'NEAR',
      feePaidByUser: true,
      hasContractCall: true,
      hasStaking: false,
      hasTokenTransfers: true,
      inflows: [],
      outflows: [{ amount: '100', asset: 'USDC', decimals: 6 }],
      primary: { amount: '100', asset: 'USDC', decimals: 6 },
    };

    expect(determineNearTransactionType(fundFlow)).toBe('Token Transfer');
  });

  test('determineNearTransactionType identifies contract call', () => {
    const fundFlow: NearFundFlow = {
      actionCount: 1,
      actionTypes: ['FunctionCall'],
      feeAbsorbedByMovement: false,
      feeAmount: '0.0001',
      feeCurrency: 'NEAR',
      feePaidByUser: true,
      hasContractCall: true,
      hasStaking: false,
      hasTokenTransfers: false,
      inflows: [],
      outflows: [],
      primary: { amount: '0', asset: 'NEAR' },
    };

    expect(determineNearTransactionType(fundFlow)).toBe('Contract Call');
  });
});

describe('NEAR Processor Utils - Phase 2 Enrichment Regression Tests', () => {
  test('handles simple inbound NEAR transfer with activity direction INBOUND', () => {
    // Regression test for Phase 2 enrichment: Verify processor correctly handles
    // accountChanges from /activity endpoint for incoming transfers
    const tx: NearTransaction = {
      accountChanges: [
        {
          account: USER_ADDRESS,
          postBalance: '10000000000000000000000000', // 10 NEAR
          preBalance: '5000000000000000000000000', // 5 NEAR
        },
      ],
      actions: [
        {
          actionType: 'Transfer',
          deposit: '5000000000000000000000000', // 5 NEAR
        },
      ],
      amount: '5000000000000000000000000',
      currency: 'NEAR',
      feeAmount: '0.0001',
      from: EXTERNAL_ADDRESS,
      id: 'inbound_tx',
      providerName: 'nearblocks',
      status: 'success',
      timestamp: Date.now(),
      to: USER_ADDRESS,
    };

    const result = analyzeNearFundFlow(tx, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;

    // Verify inflow calculated from accountChanges (postBalance - preBalance)
    expect(fundFlow.inflows).toHaveLength(1);
    expect(fundFlow.inflows[0]?.asset).toBe('NEAR');
    expect(fundFlow.inflows[0]?.amount).toBe('5'); // 10 - 5 = 5 NEAR
    expect(fundFlow.outflows).toHaveLength(0);
    expect(fundFlow.feePaidByUser).toBe(false);

    // Verify classification as deposit
    const classification = classifyNearOperationFromFundFlow(fundFlow, tx.actions || []);
    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('deposit');
  });

  test('handles outbound NEAR transfer with fee deduction from activity OUTBOUND', () => {
    // Regression test for Phase 2 enrichment: Verify processor correctly deducts fees
    // from NEAR outflows when accountChanges show net balance reduction
    const tx: NearTransaction = {
      accountChanges: [
        {
          account: USER_ADDRESS,
          postBalance: '0', // Empty after sending
          preBalance: '3100000000000000000000000', // 3.1 NEAR (3 + 0.1 fee)
        },
      ],
      actions: [
        {
          actionType: 'Transfer',
          deposit: '3000000000000000000000000', // 3 NEAR transfer
        },
      ],
      amount: '3000000000000000000000000',
      currency: 'NEAR',
      feeAmount: '0.1', // 0.1 NEAR fee
      from: USER_ADDRESS,
      id: 'outbound_tx',
      providerName: 'nearblocks',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const result = analyzeNearFundFlow(tx, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;

    // Verify outflow calculated from accountChanges (negative delta)
    expect(fundFlow.inflows).toHaveLength(0);
    expect(fundFlow.outflows).toHaveLength(1);
    expect(fundFlow.outflows[0]?.asset).toBe('NEAR');
    // accountChanges: 0 - 3.1 = -3.1 NEAR gross, minus 0.1 fee = 3 NEAR net outflow
    expect(fundFlow.outflows[0]?.amount).toBe('3');
    expect(fundFlow.outflows[0]?.grossAmount).toBe('3.1'); // Gross amount before fee
    expect(fundFlow.feePaidByUser).toBe(true);

    // Verify classification as withdrawal
    const classification = classifyNearOperationFromFundFlow(fundFlow, tx.actions || []);
    expect(classification.operation.category).toBe('transfer');
    expect(classification.operation.type).toBe('withdrawal');
  });

  test('handles token swap with tokenTransfers inflow/outflow and NEAR fee-only activity', () => {
    // Regression test for Phase 2 enrichment: Verify processor correctly handles
    // multi-asset swaps with token transfers from /ft-txns and NEAR fees from /activity
    const tx: NearTransaction = {
      accountChanges: [
        {
          account: USER_ADDRESS,
          postBalance: '9900000000000000000000000', // 9.9 NEAR (10 - 0.1 fee)
          preBalance: '10000000000000000000000000', // 10 NEAR
        },
      ],
      actions: [
        {
          actionType: 'FunctionCall',
          gas: '30000000000000',
          methodName: 'swap',
        },
      ],
      amount: '0', // No NEAR transferred, only fee
      currency: 'NEAR',
      feeAmount: '0.1', // 0.1 NEAR fee
      from: USER_ADDRESS,
      id: 'swap_tx',
      providerName: 'nearblocks',
      status: 'success',
      timestamp: Date.now(),
      to: 'ref-finance.near',
      tokenTransfers: [
        {
          amount: '5000000', // 5 USDC out (6 decimals)
          contractAddress: 'usdc.token.near',
          decimals: 6,
          from: USER_ADDRESS,
          symbol: 'USDC',
          to: 'ref-finance.near',
        },
        {
          amount: '2000000000000000000', // 2 USDT in (18 decimals)
          contractAddress: 'usdt.token.near',
          decimals: 18,
          from: 'ref-finance.near',
          symbol: 'USDT',
          to: USER_ADDRESS,
        },
      ],
    };

    const result = analyzeNearFundFlow(tx, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;

    // Verify token inflow (USDT)
    expect(fundFlow.inflows).toHaveLength(1);
    expect(fundFlow.inflows[0]?.asset).toBe('USDT');
    expect(fundFlow.inflows[0]?.amount).toBe('2'); // 2 USDT
    expect(fundFlow.inflows[0]?.decimals).toBe(18);
    expect(fundFlow.inflows[0]?.tokenAddress).toBe('usdt.token.near');

    // Verify token outflow (USDC) - fee deduction does not apply to non-NEAR assets
    expect(fundFlow.outflows).toHaveLength(1);
    expect(fundFlow.outflows[0]?.asset).toBe('USDC');
    expect(fundFlow.outflows[0]?.amount).toBe('5'); // 5 USDC
    expect(fundFlow.outflows[0]?.decimals).toBe(6);
    expect(fundFlow.outflows[0]?.tokenAddress).toBe('usdc.token.near');

    // Verify NEAR fee deducted from accountChanges but not creating separate outflow
    // (fee is absorbed into the negative balance change)
    expect(fundFlow.feeAmount).toBe('0.1');
    expect(fundFlow.feePaidByUser).toBe(true);

    // Verify classification as swap
    const classification = classifyNearOperationFromFundFlow(fundFlow, tx.actions || []);
    expect(classification.operation.category).toBe('trade');
    expect(classification.operation.type).toBe('swap');
  });

  test('handles fee-only transaction with accountChanges but no token transfers', () => {
    // Regression test: Verify processor handles contract calls that only incur fees
    // without any asset movements (e.g., failed swaps, view calls with fees)
    const tx: NearTransaction = {
      accountChanges: [
        {
          account: USER_ADDRESS,
          postBalance: '9999000000000000000000000', // 9.999 NEAR (10 - 0.001 fee)
          preBalance: '10000000000000000000000000', // 10 NEAR
        },
      ],
      actions: [
        {
          actionType: 'FunctionCall',
          gas: '30000000000000',
          methodName: 'attempt_swap',
        },
      ],
      amount: '0',
      currency: 'NEAR',
      feeAmount: '0.001', // Small fee
      from: USER_ADDRESS,
      id: 'fee_only_tx',
      providerName: 'nearblocks',
      status: 'success',
      timestamp: Date.now(),
      to: 'dex.near',
    };

    const result = analyzeNearFundFlow(tx, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;

    // The NEAR outflow from accountChanges should be fully absorbed by fee deduction
    expect(fundFlow.inflows).toHaveLength(0);
    expect(fundFlow.outflows).toHaveLength(0); // Fee absorbed, no net movement
    expect(fundFlow.feeAbsorbedByMovement).toBe(true);
    expect(fundFlow.feePaidByUser).toBe(true);

    // Verify classification as fee-only
    const classification = classifyNearOperationFromFundFlow(fundFlow, tx.actions || []);
    expect(classification.operation.category).toBe('fee');
    expect(classification.operation.type).toBe('fee');
  });

  test('handles transaction with multiple accountChanges for same user', () => {
    // Edge case: Multiple balance changes for the same account in complex transactions
    const tx: NearTransaction = {
      accountChanges: [
        {
          account: USER_ADDRESS,
          postBalance: '8000000000000000000000000', // First change: +3 NEAR
          preBalance: '5000000000000000000000000',
        },
        {
          account: USER_ADDRESS,
          postBalance: '9000000000000000000000000', // Second change: +1 NEAR
          preBalance: '8000000000000000000000000',
        },
      ],
      amount: '4000000000000000000000000',
      currency: 'NEAR',
      from: EXTERNAL_ADDRESS,
      id: 'multi_change_tx',
      providerName: 'nearblocks',
      status: 'success',
      timestamp: Date.now(),
      to: USER_ADDRESS,
    };

    const result = analyzeNearFundFlow(tx, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;

    // Should consolidate both changes: +3 NEAR + +1 NEAR = +4 NEAR total inflow
    expect(fundFlow.inflows).toHaveLength(1);
    expect(fundFlow.inflows[0]?.asset).toBe('NEAR');
    expect(fundFlow.inflows[0]?.amount).toBe('4');
    expect(fundFlow.outflows).toHaveLength(0);
  });

  test('handles transaction with no accountChanges (degraded mode)', () => {
    // Edge case: When enrichment data is unavailable, processor should not crash
    const tx: NearTransaction = {
      // No accountChanges or tokenTransfers
      actions: [
        {
          actionType: 'Transfer',
          deposit: '1000000000000000000000000',
        },
      ],
      amount: '1000000000000000000000000',
      currency: 'NEAR',
      from: USER_ADDRESS,
      id: 'degraded_tx',
      providerName: 'nearblocks',
      status: 'success',
      timestamp: Date.now(),
      to: EXTERNAL_ADDRESS,
    };

    const result = analyzeNearFundFlow(tx, { address: USER_ADDRESS });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const fundFlow = result.value;

    // Without accountChanges, processor cannot determine balance movements
    // This is expected in degraded mode when enrichment fails
    expect(fundFlow.inflows).toHaveLength(0);
    expect(fundFlow.outflows).toHaveLength(0);
    expect(fundFlow.primary.amount).toBe('0');
  });
});
