import type { EvmTransaction } from '@exitbook/blockchain-providers/evm';
import { THETA_CHAINS } from '@exitbook/blockchain-providers/theta';
import { buildBlockchainNativeAssetId, buildBlockchainTokenAssetId, type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, test } from 'vitest';

import { ThetaProcessorV2 } from '../processor-v2.js';

const THETA_CONFIG = (() => {
  const config = THETA_CHAINS['theta'];
  if (!config) {
    throw new Error('Theta test config is missing');
  }
  return config;
})();
const ACCOUNT_ID = 1;
const ACCOUNT_FINGERPRINT = 'theta-account-fingerprint';
const USER_ADDRESS = '0xuser00000000000000000000000000000000000000';
const EXTERNAL_ADDRESS = '0xexternal000000000000000000000000000000000';

function createProcessor() {
  return new ThetaProcessorV2(THETA_CONFIG);
}

async function processTransactions(transactions: EvmTransaction[]) {
  const processor = createProcessor();

  return processor.process(transactions, {
    account: {
      fingerprint: ACCOUNT_FINGERPRINT,
      id: ACCOUNT_ID,
    },
    primaryAddress: USER_ADDRESS,
    userAddresses: [USER_ADDRESS],
  });
}

function createTransaction(overrides: Partial<EvmTransaction> = {}): EvmTransaction {
  const id = overrides.id ?? '0xtheta-default';
  const type = overrides.type ?? 'transfer';

  return {
    amount: '1000000000000000000',
    currency: 'TFUEL',
    eventId: `${id}:${type}:0`,
    feeAmount: '0',
    feeCurrency: 'TFUEL' as Currency,
    from: EXTERNAL_ADDRESS,
    id,
    providerName: 'thetascan',
    status: 'success',
    timestamp: 1_700_000_000_000,
    to: USER_ADDRESS,
    tokenSymbol: 'TFUEL',
    tokenType: 'native',
    type,
    ...overrides,
  };
}

describe('ThetaProcessorV2', () => {
  test('maps TFUEL movements to the native Theta asset id', async () => {
    const result = await processTransactions([createTransaction()]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    const posting = draft?.journals[0]?.postings[0];
    expect(posting?.assetId).toBe(assertOk(buildBlockchainNativeAssetId('theta')));
    expect(posting?.assetSymbol).toBe('TFUEL');
    expect(posting?.quantity.toFixed()).toBe('1');
    expect(posting?.sourceComponentRefs[0]?.quantity.toFixed()).toBe('1');
  });

  test('maps THETA movements to the symbol-backed Theta asset id without base-unit normalization', async () => {
    const result = await processTransactions([
      createTransaction({
        amount: '42.5',
        currency: 'THETA',
        eventId: '0xtheta-token:token_transfer:0',
        from: USER_ADDRESS,
        id: '0xtheta-token',
        to: EXTERNAL_ADDRESS,
        tokenSymbol: 'THETA',
        tokenType: 'native',
        type: 'token_transfer',
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    const posting = draft?.journals[0]?.postings[0];
    expect(posting?.assetId).toBe(assertOk(buildBlockchainTokenAssetId('theta', 'theta')));
    expect(posting?.assetSymbol).toBe('THETA');
    expect(posting?.quantity.toFixed()).toBe('-42.5');
    expect(posting?.sourceComponentRefs[0]?.quantity.toFixed()).toBe('42.5');
  });
});
