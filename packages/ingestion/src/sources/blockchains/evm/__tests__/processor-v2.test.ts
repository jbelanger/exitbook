import { getEvmChainConfig, type EvmTransaction } from '@exitbook/blockchain-providers/evm';
import { ok, sha256Hex, type Currency } from '@exitbook/foundation';
import { describe, expect, test } from 'vitest';

import { EvmProcessorV2, type EvmProcessorV2TokenMetadataResolver } from '../processor-v2.js';

const ACCOUNT_ID = 1;
const ACCOUNT_FINGERPRINT = sha256Hex(`default|wallet|ethereum|identifier-${ACCOUNT_ID}`);
const USER_ADDRESS = '0xuser00000000000000000000000000000000000000';
const EXTERNAL_ADDRESS = '0xexternal000000000000000000000000000000000';
const CONTRACT_ADDRESS = '0xcontract00000000000000000000000000000000';
const USDC_ADDRESS = '0xusdc000000000000000000000000000000000000';

function createProcessor(tokenMetadataResolver?: EvmProcessorV2TokenMetadataResolver) {
  const chainConfig = getEvmChainConfig('ethereum');
  if (!chainConfig) {
    throw new Error('Ethereum chain config not found');
  }

  return new EvmProcessorV2(chainConfig, { tokenMetadataResolver });
}

async function processTransactions(
  transactions: EvmTransaction[],
  tokenMetadataResolver?: EvmProcessorV2TokenMetadataResolver
) {
  const processor = createProcessor(tokenMetadataResolver);

  return processor.process(transactions, {
    account: {
      id: ACCOUNT_ID,
      fingerprint: ACCOUNT_FINGERPRINT,
    },
    primaryAddress: USER_ADDRESS,
    userAddresses: [USER_ADDRESS],
  });
}

function createTransaction(overrides: Partial<EvmTransaction> = {}): EvmTransaction {
  const id = overrides.id ?? '0xhash-default';
  const type = overrides.type ?? 'transfer';

  return {
    amount: '1000000000000000000',
    currency: 'ETH',
    eventId: `${id}:${type}:0`,
    feeAmount: '21000000000000',
    feeCurrency: 'ETH' as Currency,
    from: EXTERNAL_ADDRESS,
    id,
    providerName: 'alchemy',
    status: 'success',
    timestamp: 1_700_000_000_000,
    to: USER_ADDRESS,
    tokenType: 'native',
    type,
    ...overrides,
  };
}

describe('EvmProcessorV2', () => {
  test('builds a transfer journal for incoming native value without charging sender gas to the wallet', async () => {
    const result = await processTransactions([
      createTransaction({
        id: '0xincoming-native',
        eventId: '0xincoming-native:transfer:0',
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.sourceActivity.fromAddress).toBe(EXTERNAL_ADDRESS);
    expect(draft?.sourceActivity.toAddress).toBe(USER_ADDRESS);
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer']);
    expect(draft?.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['principal', '1'],
    ]);
    expect(draft?.journals[0]?.postings[0]?.sourceComponentRefs[0]?.component.componentId).toBe(
      '0xincoming-native:transfer:0'
    );
  });

  test('emits outgoing native value and network fee in one transfer journal', async () => {
    const result = await processTransactions([
      createTransaction({
        amount: '2000000000000000000',
        feeAmount: '100000000000000',
        from: USER_ADDRESS,
        id: '0xoutgoing-native',
        eventId: '0xoutgoing-native:transfer:0',
        to: EXTERNAL_ADDRESS,
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer']);
    expect(draft?.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['principal', '-2'],
      ['fee', '-0.0001'],
    ]);
  });

  test('models a swap as trade postings plus network fee', async () => {
    const result = await processTransactions([
      createTransaction({
        amount: '500000000000000000',
        feeAmount: '150000000000000',
        from: USER_ADDRESS,
        id: '0xswap',
        eventId: '0xswap:transfer:0',
        to: CONTRACT_ADDRESS,
      }),
      createTransaction({
        amount: '1000000000',
        currency: 'USDC',
        eventId: '0xswap:log:1',
        feeAmount: undefined,
        from: CONTRACT_ADDRESS,
        id: '0xswap',
        to: USER_ADDRESS,
        tokenAddress: USDC_ADDRESS,
        tokenDecimals: 6,
        tokenSymbol: 'USDC',
        tokenType: 'erc20',
        type: 'token_transfer',
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['trade']);
    expect(
      draft?.journals[0]?.postings.map((posting) => [posting.assetSymbol, posting.role, posting.quantity.toFixed()])
    ).toEqual([
      ['ETH', 'principal', '-0.5'],
      ['USDC', 'principal', '1000'],
      ['ETH', 'fee', '-0.00015'],
    ]);
  });

  test('keeps user-initiated token approvals as fee-only expenses with approval diagnostics', async () => {
    const result = await processTransactions([
      createTransaction({
        amount: '0',
        feeAmount: '150000000000000',
        from: USER_ADDRESS,
        functionName: 'approve',
        id: '0xapproval',
        eventId: '0xapproval:contract-call:0',
        methodId: '0x095ea7b3',
        to: CONTRACT_ADDRESS,
        type: 'contract_call',
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['expense_only']);
    expect(draft?.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['fee', '-0.00015'],
    ]);
    expect(draft?.journals[0]?.diagnostics?.[0]?.code).toBe('token_approval');
    expect(draft?.journals[0]?.diagnostics?.[0]?.metadata?.['detectionSource']).toBe('method_id');
  });

  test('preserves exact bridge function hints as ledger diagnostics', async () => {
    const result = await processTransactions([
      createTransaction({
        amount: '25000000',
        currency: 'USDC',
        eventId: '0xcctp:log:0',
        feeAmount: '150000000000000',
        from: USER_ADDRESS,
        functionName: 'depositForBurn(uint256,uint32,bytes32,address)',
        id: '0xcctp',
        methodId: '0x6fd3504e',
        to: CONTRACT_ADDRESS,
        tokenAddress: USDC_ADDRESS,
        tokenDecimals: 6,
        tokenSymbol: 'USDC',
        tokenType: 'erc20',
        type: 'token_transfer',
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer']);
    expect(draft?.journals[0]?.diagnostics?.[0]?.code).toBe('bridge_transfer');
    expect(draft?.journals[0]?.diagnostics?.[0]?.metadata?.['bridgeFamily']).toBe('cctp');
  });

  test('canonicalizes token metadata before event de-duplication and journal assembly', async () => {
    const tokenMetadataResolver: EvmProcessorV2TokenMetadataResolver = {
      async getTokenMetadata(_chainName, contractAddresses) {
        return ok(new Map(contractAddresses.map((contractAddress) => [contractAddress, { symbol: 'USDT' }])));
      },
    };
    const sharedEvent = createTransaction({
      amount: '25000000',
      currency: 'USD₮0',
      eventId: '0xusdt:log:0',
      feeAmount: '0',
      from: EXTERNAL_ADDRESS,
      id: '0xusdt',
      to: USER_ADDRESS,
      tokenAddress: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
      tokenDecimals: 6,
      tokenSymbol: 'USD₮0',
      tokenType: 'erc20',
      type: 'token_transfer',
    });

    const result = await processTransactions(
      [
        sharedEvent,
        {
          ...sharedEvent,
          currency: 'USDT',
          tokenSymbol: 'USDT',
        },
      ],
      tokenMetadataResolver
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals[0]?.postings.map((posting) => [posting.assetSymbol, posting.quantity.toFixed()])).toEqual([
      ['USDT', '25'],
    ]);
  });

  test('skips provider rows with no wallet ledger effect', async () => {
    const result = await processTransactions([
      createTransaction({
        amount: '0',
        feeAmount: '0',
        from: EXTERNAL_ADDRESS,
        id: '0xno-effect',
        eventId: '0xno-effect:transfer:0',
        to: CONTRACT_ADDRESS,
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual([]);
  });

  test('treats failed EVM transactions as gas-only ledger effects', async () => {
    const result = await processTransactions([
      createTransaction({
        amount: '2000000000000000000',
        feeAmount: '100000000000000',
        from: USER_ADDRESS,
        id: '0xfailed',
        eventId: '0xfailed:transfer:0',
        status: 'failed',
        to: EXTERNAL_ADDRESS,
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.sourceActivity.activityStatus).toBe('failed');
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['expense_only']);
    expect(draft?.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['fee', '-0.0001'],
    ]);
  });

  test('classifies partial beacon withdrawals as staking rewards', async () => {
    const result = await processTransactions([
      createTransaction({
        amount: '50000000000000000',
        eventId: '0xbeacon:withdrawal:42',
        feeAmount: '0',
        from: '0x0000000000000000000000000000000000000000',
        id: '0xbeacon',
        to: USER_ADDRESS,
        type: 'beacon_withdrawal',
        validatorIndex: '123',
        withdrawalIndex: '42',
      }),
    ]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [draft] = result.value;
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['staking_reward']);
    expect(draft?.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['staking_reward', '0.05'],
    ]);
    expect(draft?.journals[0]?.postings[0]?.sourceComponentRefs[0]?.component.componentKind).toBe('staking_reward');
    expect(draft?.journals[0]?.diagnostics?.[0]?.code).toBe('consensus_withdrawal');
  });

  test('deduplicates repeated normalized events and rejects conflicting duplicate event evidence', async () => {
    const sharedTransaction = createTransaction({
      id: '0xduplicate',
      eventId: '0xduplicate:transfer:0',
    });
    const duplicateResult = await processTransactions([sharedTransaction, sharedTransaction]);

    expect(duplicateResult.isOk()).toBe(true);
    if (duplicateResult.isErr()) return;
    expect(duplicateResult.value).toHaveLength(1);

    const conflictResult = await processTransactions([
      sharedTransaction,
      {
        ...sharedTransaction,
        amount: '2000000000000000000',
      },
    ]);

    expect(conflictResult.isErr()).toBe(true);
    if (conflictResult.isOk()) return;
    expect(conflictResult.error.message).toContain(
      'EVM v2 received conflicting normalized payloads for event 0xduplicate:transfer:0'
    );
  });
});
