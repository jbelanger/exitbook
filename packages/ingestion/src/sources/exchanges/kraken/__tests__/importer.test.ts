import type { RawTransactionInput } from '@exitbook/core';
import type { CursorState } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@exitbook/exchange-providers', () => ({
  createExchangeClient: vi.fn(),
}));

import { createExchangeClient } from '@exitbook/exchange-providers';

import { consumeImportStream } from '../../../../shared/test-utils/importer-test-utils.js';
import type { StreamingImportParams } from '../../../../shared/types/importers.js';
import { KrakenApiImporter } from '../importer.js';

const mockCreateExchangeClient = vi.mocked(createExchangeClient);

function makeParams(overrides: Partial<StreamingImportParams> = {}): StreamingImportParams {
  return {
    platformKey: 'kraken',
    platformKind: 'exchange-api',
    credentials: {
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    },
    ...overrides,
  };
}

function makeCursor(overrides: Partial<CursorState> = {}): CursorState {
  return {
    primary: {
      type: 'pageToken',
      value: 'cursor-1',
      providerName: 'kraken',
    },
    lastTransactionId: 'LEDGER-1',
    totalFetched: 1,
    metadata: {
      providerName: 'kraken',
      updatedAt: 1704067200000,
      isComplete: false,
    },
    ...overrides,
  };
}

function makeRawTransaction(eventId: string): RawTransactionInput {
  return {
    eventId,
    providerName: 'kraken',
    providerData: { ledgerId: eventId },
    timestamp: 1704067200000,
  };
}

describe('KrakenApiImporter', () => {
  beforeEach(() => {
    mockCreateExchangeClient.mockReset();
  });

  test('returns an error when credentials are missing', async () => {
    const importer = new KrakenApiImporter();

    const result = await consumeImportStream(importer, makeParams({ credentials: undefined }));

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      return;
    }

    expect(result.error.message).toContain('API credentials are required');
    expect(mockCreateExchangeClient).not.toHaveBeenCalled();
  });

  test('returns a client creation error unchanged', async () => {
    mockCreateExchangeClient.mockReturnValue(err(new Error('bad kraken credentials')));

    const importer = new KrakenApiImporter();
    const result = await consumeImportStream(importer, makeParams());

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      return;
    }

    expect(result.error.message).toBe('bad kraken credentials');
  });

  test('returns an error when the client does not support streaming', async () => {
    mockCreateExchangeClient.mockReturnValue(
      ok({
        exchangeId: 'kraken',
        fetchBalance: vi.fn(),
      } as never)
    );

    const importer = new KrakenApiImporter();
    const result = await consumeImportStream(importer, makeParams());

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      return;
    }

    expect(result.error.message).toContain('does not support streaming');
  });

  test('maps client batches to importer batches and forwards cursor state', async () => {
    const clientCursor = makeCursor({ totalFetched: 25 });
    const importCursor = { ledger: makeCursor({ totalFetched: 10 }) };
    const fetchTransactionDataStreaming = vi.fn(async function* (params: { cursor?: Record<string, CursorState> }) {
      expect(params).toEqual({ cursor: importCursor });
      yield ok({
        transactions: [makeRawTransaction('LEDGER-25')],
        operationType: 'ledger',
        cursor: clientCursor,
        isComplete: true,
      });
    });

    mockCreateExchangeClient.mockReturnValue(
      ok({
        exchangeId: 'kraken',
        fetchBalance: vi.fn(),
        fetchTransactionDataStreaming,
      } as never)
    );

    const importer = new KrakenApiImporter();
    const result = await consumeImportStream(importer, makeParams({ cursor: importCursor }));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    expect(mockCreateExchangeClient).toHaveBeenCalledWith('kraken', {
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });
    expect(fetchTransactionDataStreaming).toHaveBeenCalledOnce();
    expect(result.value.rawTransactions).toEqual([makeRawTransaction('LEDGER-25')]);
    expect(result.value.cursorUpdates).toEqual({ ledger: clientCursor });
  });

  test('returns an error when the client stream yields an error batch', async () => {
    const fetchTransactionDataStreaming = vi.fn(async function* () {
      yield err(new Error('kraken transport failed'));
    });

    mockCreateExchangeClient.mockReturnValue(
      ok({
        exchangeId: 'kraken',
        fetchBalance: vi.fn(),
        fetchTransactionDataStreaming,
      } as never)
    );

    const importer = new KrakenApiImporter();
    const result = await consumeImportStream(importer, makeParams());

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      return;
    }

    expect(result.error.message).toBe('kraken transport failed');
  });
});
