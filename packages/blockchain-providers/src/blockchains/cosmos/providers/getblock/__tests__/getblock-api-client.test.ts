import { ok, type Result } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderConfig, StreamingBatchResult } from '../../../../../contracts/index.js';
import {
  createMockHttpClient,
  expectOk,
  injectMockHttpClient,
  type MockHttpClient,
  resetMockHttpClient,
} from '../../../../../test-support/provider-test-utils.js';
import { cosmosProviderFactories } from '../../../register-apis.js';
import type { CosmosTransaction } from '../../../types.js';
import { GetBlockCosmosApiClient, getBlockCosmosMetadata } from '../getblock.api-client.js';
import {
  GetBlockTxSearchResponseSchema,
  type GetBlockBlockResponse,
  type GetBlockTxSearchResponse,
  type GetBlockTxSearchTx,
} from '../getblock.schemas.js';

const mockHttp = createMockHttpClient();

function buildDisabledGetBlockCosmosConfig(apiKey: string): ProviderConfig {
  return {
    apiKey,
    baseUrl: getBlockCosmosMetadata.baseUrl,
    blockchain: 'cosmoshub',
    displayName: getBlockCosmosMetadata.displayName,
    enabled: true,
    metadata: getBlockCosmosMetadata,
    name: getBlockCosmosMetadata.name,
    priority: 1,
    rateLimit: getBlockCosmosMetadata.defaultConfig.rateLimit,
    requiresApiKey: getBlockCosmosMetadata.requiresApiKey,
    retries: getBlockCosmosMetadata.defaultConfig.retries,
    timeout: getBlockCosmosMetadata.defaultConfig.timeout,
  };
}

vi.mock('@exitbook/logger', () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.mock('../../../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils.js')>();
  return {
    ...actual,
    validateBech32Address: vi.fn(() => true),
  };
});

const TEST_API_KEY = 'test-getblock-key';
const TEST_ADDRESS = 'cosmos1490khd3htq9e808qj7s48rvqtw2psu52rx4j02';
const OTHER_ADDRESS = 'cosmos1otheraccount0000000000000000000000000';
const TX_HASH = 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';

function buildSearchResponse(txs: GetBlockTxSearchTx[], totalCount = txs.length): GetBlockTxSearchResponse {
  return {
    id: 1,
    jsonrpc: '2.0',
    result: {
      total_count: totalCount.toString(),
      txs,
    },
  };
}

function buildBlockResponse(timestamp = '2026-04-20T12:00:00Z'): GetBlockBlockResponse {
  return {
    id: 1,
    jsonrpc: '2.0',
    result: {
      block: {
        header: {
          height: '30000000',
          time: timestamp,
        },
      },
    },
  };
}

function buildTransferTx(): GetBlockTxSearchTx {
  return {
    hash: TX_HASH,
    height: '30000000',
    tx_result: {
      code: 0,
      events: [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: '/cosmos.bank.v1beta1.MsgSend' },
            { key: 'sender', value: OTHER_ADDRESS },
            { key: 'msg_index', value: '0' },
          ],
        },
        {
          type: 'transfer',
          attributes: [
            { key: 'sender', value: OTHER_ADDRESS },
            { key: 'recipient', value: TEST_ADDRESS },
            { key: 'amount', value: '2000000uatom' },
            { key: 'msg_index', value: '0' },
          ],
        },
      ],
      gas_used: '110000',
      gas_wanted: '200000',
    },
  };
}

function mockAccountSearchesWithTransfer(mockGet: MockHttpClient['get']): void {
  for (let i = 0; i < 9; i += 1) {
    const txs = i === 4 ? [buildTransferTx()] : [];
    mockGet.mockResolvedValueOnce(ok(buildSearchResponse(txs)));
  }
  mockGet.mockResolvedValueOnce(ok(buildBlockResponse()));
}

describe('GetBlockCosmosApiClient', () => {
  let client: GetBlockCosmosApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    const config = buildDisabledGetBlockCosmosConfig(TEST_API_KEY);
    client = new GetBlockCosmosApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  it('keeps GetBlock metadata available but not registered while Cosmos Hub is disabled', () => {
    const factory = cosmosProviderFactories.find((candidate) => candidate.metadata.name === 'getblock-cosmos');
    expect(factory).toBeUndefined();
    expect(getBlockCosmosMetadata).toMatchObject({
      apiKeyEnvName: 'GETBLOCK_COSMOS_API_KEY',
      blockchain: 'cosmoshub',
      requiresApiKey: true,
    });
    expect(getBlockCosmosMetadata.capabilities.supportedOperations).toEqual(['getAddressTransactions']);
  });

  it('uses Tendermint status as the health check', async () => {
    mockGet.mockResolvedValueOnce(
      ok({
        id: 1,
        jsonrpc: '2.0',
        result: {
          node_info: { network: 'cosmoshub-4', other: { tx_index: 'on' } },
          sync_info: {
            catching_up: false,
            latest_block_height: '30000000',
          },
        },
      })
    );

    const healthy = expectOk(await client.isHealthy());

    expect(healthy).toBe(true);
    expect(mockGet).toHaveBeenCalledWith(`/${TEST_API_KEY}/status`);
  });

  it('streams tx_search event matches and hydrates block timestamps', async () => {
    mockAccountSearchesWithTransfer(mockGet);

    const iterator = client.executeStreaming<CosmosTransaction>({
      address: TEST_ADDRESS,
      type: 'getAddressTransactions',
    });
    const next = await iterator.next();
    expect(next.done).toBe(false);
    const batch = expectOk(next.value as Result<StreamingBatchResult<CosmosTransaction>, Error>);

    expect(batch.isComplete).toBe(true);
    expect(batch.data).toHaveLength(1);
    expect(batch.data[0]?.normalized).toMatchObject({
      amount: '2',
      blockHeight: 30000000,
      currency: 'ATOM',
      from: OTHER_ADDRESS,
      id: TX_HASH,
      providerName: 'getblock-cosmos',
      to: TEST_ADDRESS,
    });
    expect(mockGet.mock.calls[0]?.[0]).toContain(`/${TEST_API_KEY}/tx_search?`);
    expect(mockGet.mock.calls[9]?.[0]).toBe(`/${TEST_API_KEY}/block?height=30000000`);
  });

  it('accepts tx_search responses with null tx_result data', () => {
    const providerNull = JSON.parse('null') as string | null;
    const response = buildSearchResponse([
      {
        ...buildTransferTx(),
        tx_result: {
          ...buildTransferTx().tx_result,
          data: providerNull,
        },
      },
    ]);

    const parsed = GetBlockTxSearchResponseSchema.safeParse(response);

    expect(parsed.success).toBe(true);
  });
});
