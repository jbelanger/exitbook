import { type EvmTransaction } from '@exitbook/blockchain-providers/evm';
import type { Currency } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { determineThetaOperationFromFundFlow } from '../processor-utils.js';
import type { ThetaFundFlow } from '../types.js';

describe('theta/processor-utils', () => {
  it('does not apply Ethereum beacon-withdrawal classification rules', () => {
    const fundFlow: ThetaFundFlow = {
      inflows: [{ asset: 'THETA' as Currency, amount: '40' }],
      outflows: [],
      primary: { asset: 'THETA' as Currency, amount: '40' },
      feeAmount: '0',
      feeCurrency: 'TFUEL' as Currency,
      fromAddress: '0xexternal000000000000000000000000000000000',
      toAddress: '0xuser00000000000000000000000000000000000000',
      transactionCount: 1,
      hasContractInteraction: false,
      hasInternalTransactions: false,
      hasTokenTransfers: true,
    };

    const impossibleThetaBeaconTx: EvmTransaction = {
      amount: '40000000000000000000',
      currency: 'THETA',
      eventId: 'event1',
      from: '0xexternal000000000000000000000000000000000',
      id: '0xhash1',
      providerName: 'theta-explorer',
      status: 'success',
      timestamp: Date.now(),
      to: '0xuser00000000000000000000000000000000000000',
      type: 'beacon_withdrawal',
    };

    const result = determineThetaOperationFromFundFlow(fundFlow, [impossibleThetaBeaconTx]);

    expect(result.operation.category).toBe('transfer');
    expect(result.operation.type).toBe('deposit');
    expect(result.notes).toBeUndefined();
  });
});
