import type { IBlockchainProviderRuntime, TokenMetadataRecord } from '@exitbook/blockchain-providers';
import {
  type NearBalanceChange,
  type NearReceipt,
  type NearStreamEvent,
  type NearTokenTransfer,
  type NearTransaction,
} from '@exitbook/blockchain-providers/near';
import { ok, sha256Hex, type Currency } from '@exitbook/foundation';
import { describe, expect, test, vi } from 'vitest';

import { NearProcessorV2 } from '../processor-v2.js';

const ACCOUNT_ID = 1;
const ACCOUNT_FINGERPRINT = sha256Hex(`default|wallet|near|identifier-${ACCOUNT_ID}`);
const USER_ADDRESS = 'alice.near';
const EXTERNAL_ADDRESS = 'bob.near';

interface ProviderRuntimeTestDouble {
  getTokenMetadata: ReturnType<typeof vi.fn>;
  runtime: IBlockchainProviderRuntime;
}

function createProviderRuntime(
  metadata = new Map<string, TokenMetadataRecord | undefined>()
): ProviderRuntimeTestDouble {
  const getTokenMetadata = vi.fn().mockResolvedValue(ok(metadata));

  return {
    getTokenMetadata,
    runtime: {
      getTokenMetadata,
    } as unknown as IBlockchainProviderRuntime,
  };
}

function createProcessor(providerRuntime = createProviderRuntime().runtime): NearProcessorV2 {
  return new NearProcessorV2(providerRuntime);
}

async function processEvents(events: NearStreamEvent[], providerRuntime?: IBlockchainProviderRuntime) {
  return createProcessor(providerRuntime).process(events, {
    account: {
      id: ACCOUNT_ID,
      fingerprint: ACCOUNT_FINGERPRINT,
    },
    primaryAddress: USER_ADDRESS,
    userAddresses: [USER_ADDRESS],
  });
}

function createTransactionEvent(overrides: Partial<NearTransaction> = {}): NearStreamEvent {
  const transactionHash = overrides.transactionHash ?? 'near-tx-1';

  return {
    id: transactionHash,
    eventId: `${transactionHash}:tx`,
    streamType: 'transactions',
    transactionHash,
    signerAccountId: EXTERNAL_ADDRESS,
    receiverAccountId: USER_ADDRESS,
    blockHash: 'near-block-1',
    blockHeight: 12345,
    timestamp: 1_700_000_000_000,
    status: true,
    ...overrides,
  };
}

function createReceiptEvent(overrides: Partial<NearReceipt> = {}): NearStreamEvent {
  const transactionHash = overrides.transactionHash ?? 'near-tx-1';
  const receiptId = overrides.receiptId ?? 'near-receipt-1';

  return {
    id: transactionHash,
    eventId: `${receiptId}:receipt`,
    streamType: 'receipts',
    receiptId,
    transactionHash,
    predecessorAccountId: EXTERNAL_ADDRESS,
    receiverAccountId: USER_ADDRESS,
    receiptKind: 'ACTION',
    blockHash: 'near-block-1',
    blockHeight: 12345,
    timestamp: 1_700_000_000_000,
    executorAccountId: USER_ADDRESS,
    gasBurnt: '0',
    tokensBurntYocto: '0',
    status: true,
    logs: [],
    actions: [],
    ...overrides,
  };
}

function createBalanceChangeEvent(overrides: Partial<NearBalanceChange> = {}): NearStreamEvent {
  const receiptId = overrides.receiptId ?? 'near-receipt-1';

  return {
    id: receiptId,
    eventId: `${receiptId}:bc:0`,
    streamType: 'balance-changes',
    receiptId,
    affectedAccountId: USER_ADDRESS,
    direction: 'INBOUND',
    cause: 'TRANSFER',
    deltaAmountYocto: '2000000000000000000000000',
    absoluteNonstakedAmount: '2000000000000000000000000',
    absoluteStakedAmount: '0',
    timestamp: 1_700_000_000_000,
    blockHeight: '12345',
    ...overrides,
  };
}

function createTokenTransferEvent(overrides: Partial<NearTokenTransfer> = {}): NearStreamEvent {
  const transactionHash = overrides.transactionHash ?? 'near-tx-1';
  const contractAddress = overrides.contractAddress ?? 'usdc.token.near';

  return {
    id: transactionHash,
    eventId: `${transactionHash}:tt:${contractAddress}:0`,
    streamType: 'token-transfers',
    transactionHash,
    affectedAccountId: USER_ADDRESS,
    involvedAccountId: EXTERNAL_ADDRESS,
    contractAddress,
    deltaAmountYocto: '1000000',
    decimals: 6,
    symbol: 'USDC',
    timestamp: 1_700_000_000_000,
    blockHeight: 12345,
    ...overrides,
  };
}

function expectOk<T>(result: { error?: Error; isOk(): boolean; value?: T }): T {
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) {
    throw new Error(result.error?.message ?? 'Expected NEAR v2 Result to be ok');
  }

  return result.value as T;
}

describe('NearProcessorV2', () => {
  test('builds a transfer journal for incoming native value', async () => {
    const drafts = expectOk(
      await processEvents([
        createTransactionEvent(),
        createReceiptEvent(),
        createBalanceChangeEvent({
          deltaAmountYocto: '2000000000000000000000000',
        }),
      ])
    );

    const [draft] = drafts;
    expect(draft?.sourceActivity.sourceActivityStableKey).toBe('near-tx-1');
    expect(draft?.sourceActivity.fromAddress).toBeUndefined();
    expect(draft?.sourceActivity.toAddress).toBe(USER_ADDRESS);
    expect(draft?.journals.map((journal) => journal.journalKind)).toEqual(['transfer']);
    expect(draft?.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['principal', '2'],
    ]);
    expect(draft?.journals[0]?.postings[0]?.sourceComponentRefs[0]?.component.componentId).toBe('near-receipt-1:bc:0');
  });

  test('models fee-only native outflow as an expense-only journal', async () => {
    const drafts = expectOk(
      await processEvents([
        createTransactionEvent({
          signerAccountId: USER_ADDRESS,
          receiverAccountId: EXTERNAL_ADDRESS,
        }),
        createReceiptEvent({
          predecessorAccountId: USER_ADDRESS,
          receiverAccountId: EXTERNAL_ADDRESS,
          tokensBurntYocto: '242800000000000000000',
        }),
        createBalanceChangeEvent({
          affectedAccountId: USER_ADDRESS,
          direction: 'OUTBOUND',
          deltaAmountYocto: '-1000000000000000000000000',
        }),
      ])
    );

    const postings = drafts[0]?.journals[0]?.postings ?? [];
    expect(drafts[0]?.journals.map((journal) => journal.journalKind)).toEqual(['expense_only']);
    expect(postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([['fee', '-1']]);
    expect(postings[0]?.sourceComponentRefs.map((ref) => ref.component.componentKind)).toEqual([
      'account_delta',
      'network_fee',
    ]);
  });

  test('keeps action-deposit native outflows as transfers with separate fees', async () => {
    const drafts = expectOk(
      await processEvents([
        createTransactionEvent({
          signerAccountId: USER_ADDRESS,
          receiverAccountId: EXTERNAL_ADDRESS,
        }),
        createReceiptEvent({
          predecessorAccountId: USER_ADDRESS,
          receiverAccountId: EXTERNAL_ADDRESS,
          tokensBurntYocto: '242800000000000000000',
          actions: [
            {
              actionType: 'transfer',
              deposit: '1000000000000000000000000',
            },
          ],
        }),
        createBalanceChangeEvent({
          affectedAccountId: USER_ADDRESS,
          direction: 'OUTBOUND',
          deltaAmountYocto: '-1000242800000000000000000',
        }),
      ])
    );

    const postings = drafts[0]?.journals[0]?.postings ?? [];
    expect(drafts[0]?.journals.map((journal) => journal.journalKind)).toEqual(['transfer']);
    expect(postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['principal', '-1'],
      ['fee', '-0.0002428'],
    ]);
  });

  test('models token swaps as trade postings and enriches token metadata', async () => {
    const providerRuntime = createProviderRuntime(
      new Map([
        [
          'usdc.token.near',
          {
            blockchain: 'near',
            contractAddress: 'usdc.token.near',
            decimals: 6,
            refreshedAt: new Date('2026-04-27T00:00:00.000Z'),
            source: 'test',
            symbol: 'USDC',
          },
        ],
        [
          'usdt.token.near',
          {
            blockchain: 'near',
            contractAddress: 'usdt.token.near',
            decimals: 6,
            refreshedAt: new Date('2026-04-27T00:00:00.000Z'),
            source: 'test',
            symbol: 'USDT',
          },
        ],
      ])
    );

    const drafts = expectOk(
      await processEvents(
        [
          createTransactionEvent(),
          createReceiptEvent(),
          createTokenTransferEvent({
            affectedAccountId: EXTERNAL_ADDRESS,
            contractAddress: 'usdc.token.near',
            deltaAmountYocto: '1000000',
            symbol: undefined,
          }),
          createTokenTransferEvent({
            affectedAccountId: USER_ADDRESS,
            contractAddress: 'usdt.token.near',
            deltaAmountYocto: '2000000',
            symbol: undefined,
          }),
        ],
        providerRuntime.runtime
      )
    );

    expect(providerRuntime.getTokenMetadata).toHaveBeenCalledWith('near', ['usdc.token.near', 'usdt.token.near']);
    expect(drafts[0]?.journals.map((journal) => journal.journalKind)).toEqual(['trade']);
    expect(
      drafts[0]?.journals[0]?.postings.map((posting) => [posting.assetSymbol, posting.quantity.toFixed()])
    ).toEqual([
      ['USDC' as Currency, '-1'],
      ['USDT' as Currency, '2'],
    ]);
  });

  test('models receipt-backed contract reward inflows as staking reward income', async () => {
    const drafts = expectOk(
      await processEvents([
        createTransactionEvent(),
        createReceiptEvent(),
        createBalanceChangeEvent({
          cause: 'CONTRACT_REWARD',
          deltaAmountYocto: '3000000000000000000000000',
        }),
      ])
    );

    expect(drafts[0]?.journals.map((journal) => journal.journalKind)).toEqual(['staking_reward']);
    expect(drafts[0]?.journals[0]?.postings.map((posting) => [posting.role, posting.quantity.toFixed()])).toEqual([
      ['staking_reward', '3'],
    ]);
  });
});
