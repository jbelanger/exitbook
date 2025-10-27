import type { SourceType } from '@exitbook/core';
import { ok } from 'neverthrow';
import { describe, expect, test, vi } from 'vitest';

import type { ITokenMetadataService } from '../../../../services/token-metadata/token-metadata-service.interface.ts';
import { ProcessorFactory } from '../processor-factory.ts';

function createProcessorFactory() {
  // Create minimal mock for token metadata service
  const mockTokenMetadataService = {
    enrichBatch: vi.fn().mockResolvedValue(ok()),
    // eslint-disable-next-line unicorn/no-useless-undefined -- explicit undefined for type safety in tests
    getOrFetch: vi.fn().mockResolvedValue(ok(undefined)),
  } as unknown as ITokenMetadataService;

  return new ProcessorFactory(mockTokenMetadataService);
}

describe('ProcessorFactory - KuCoin Processor Selection', () => {
  test('creates CSV processor when importMethod is csv', async () => {
    const factory = createProcessorFactory();

    const metadata = { importMethod: 'csv' };
    const processor = await factory.create('kucoin', 'exchange', metadata);

    expect(processor).toBeDefined();
    // The CSV processor is named 'KucoinProcessor'
    expect(processor.constructor.name).toBe('KucoinProcessor');
  });

  test('creates API processor when importMethod is not csv', async () => {
    const factory = createProcessorFactory();

    const metadata = { importMethod: 'api' };
    const processor = await factory.create('kucoin', 'exchange', metadata);

    expect(processor).toBeDefined();
    // KuCoin API uses DefaultExchangeProcessor (ledger entry model)
    expect(processor.constructor.name).toBe('DefaultExchangeProcessor');
  });

  test('creates API processor when no metadata provided', async () => {
    const factory = createProcessorFactory();

    const processor = await factory.create('kucoin', 'exchange');

    expect(processor).toBeDefined();
    // Default to API processor (DefaultExchangeProcessor)
    expect(processor.constructor.name).toBe('DefaultExchangeProcessor');
  });

  test('creates API processor when metadata is empty', async () => {
    const factory = createProcessorFactory();

    const processor = await factory.create('kucoin', 'exchange', {});

    expect(processor).toBeDefined();
    // Default to API processor (DefaultExchangeProcessor)
    expect(processor.constructor.name).toBe('DefaultExchangeProcessor');
  });
});

describe('ProcessorFactory - Exchange Support', () => {
  test('supports kucoin exchange', async () => {
    const isSupported = await ProcessorFactory.isSupported('kucoin', 'exchange');

    expect(isSupported).toBe(true);
  });

  test('supports kraken exchange', async () => {
    const isSupported = await ProcessorFactory.isSupported('kraken', 'exchange');

    expect(isSupported).toBe(true);
  });

  test('supports coinbase exchange', async () => {
    const isSupported = await ProcessorFactory.isSupported('coinbase', 'exchange');

    expect(isSupported).toBe(true);
  });

  test('does not support unknown exchange', async () => {
    const isSupported = await ProcessorFactory.isSupported('unknown-exchange', 'exchange');

    expect(isSupported).toBe(false);
  });

  test('returns supported exchange list', async () => {
    const supportedExchanges = await ProcessorFactory.getSupportedSources('exchange');

    expect(supportedExchanges).toContain('kucoin');
    expect(supportedExchanges).toContain('kraken');
    expect(supportedExchanges).toContain('coinbase');
  });
});

describe('ProcessorFactory - Error Handling', () => {
  test('throws error for unsupported exchange', async () => {
    const factory = createProcessorFactory();

    await expect(factory.create('unsupported-exchange', 'exchange')).rejects.toThrow(
      'Unsupported exchange processor: unsupported-exchange'
    );
  });

  test('throws error for unsupported source type', async () => {
    const factory = createProcessorFactory();

    await expect(factory.create('kucoin', 'invalid-type' as unknown as SourceType)).rejects.toThrow(
      'Unsupported source type: invalid-type'
    );
  });
});
