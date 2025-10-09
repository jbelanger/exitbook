import { describe, expect, test } from 'vitest';

import { ProcessorFactory } from '../processor-factory.ts';

describe('ProcessorFactory - KuCoin Processor Selection', () => {
  test('creates CSV processor when importMethod is csv', async () => {
    const factory = new ProcessorFactory();

    const metadata = { importMethod: 'csv' };
    const processor = await factory.create('kucoin', 'exchange', metadata);

    expect(processor).toBeDefined();
    // The CSV processor is named 'KucoinProcessor'
    expect(processor.constructor.name).toBe('KucoinProcessor');
  });

  test('creates API processor when importMethod is not csv', async () => {
    const factory = new ProcessorFactory();

    const metadata = { importMethod: 'api' };
    const processor = await factory.create('kucoin', 'exchange', metadata);

    expect(processor).toBeDefined();
    // The API processor is named 'KuCoinProcessor' (note the capital C)
    expect(processor.constructor.name).toBe('KuCoinProcessor');
  });

  test('creates API processor when no metadata provided', async () => {
    const factory = new ProcessorFactory();

    const processor = await factory.create('kucoin', 'exchange');

    expect(processor).toBeDefined();
    // Default to API processor
    expect(processor.constructor.name).toBe('KuCoinProcessor');
  });

  test('creates API processor when metadata is empty', async () => {
    const factory = new ProcessorFactory();

    const processor = await factory.create('kucoin', 'exchange', {});

    expect(processor).toBeDefined();
    // Default to API processor
    expect(processor.constructor.name).toBe('KuCoinProcessor');
  });
});

describe('ProcessorFactory - Exchange Support', () => {
  test('supports kucoin exchange', async () => {
    const factory = new ProcessorFactory();

    const isSupported = await factory.isSupported('kucoin', 'exchange');

    expect(isSupported).toBe(true);
  });

  test('supports kraken exchange', async () => {
    const factory = new ProcessorFactory();

    const isSupported = await factory.isSupported('kraken', 'exchange');

    expect(isSupported).toBe(true);
  });

  test('supports coinbase exchange', async () => {
    const factory = new ProcessorFactory();

    const isSupported = await factory.isSupported('coinbase', 'exchange');

    expect(isSupported).toBe(true);
  });

  test('does not support unknown exchange', async () => {
    const factory = new ProcessorFactory();

    const isSupported = await factory.isSupported('unknown-exchange', 'exchange');

    expect(isSupported).toBe(false);
  });

  test('returns supported exchange list', async () => {
    const factory = new ProcessorFactory();

    const supportedExchanges = await factory.getSupportedSources('exchange');

    expect(supportedExchanges).toContain('kucoin');
    expect(supportedExchanges).toContain('kraken');
    expect(supportedExchanges).toContain('coinbase');
  });
});

describe('ProcessorFactory - Error Handling', () => {
  test('throws error for unsupported exchange', async () => {
    const factory = new ProcessorFactory();

    await expect(factory.create('unsupported-exchange', 'exchange')).rejects.toThrow(
      'Unsupported exchange processor: unsupported-exchange'
    );
  });

  test('throws error for unsupported source type', async () => {
    const factory = new ProcessorFactory();

    await expect(factory.create('kucoin', 'invalid-type' as unknown as string)).rejects.toThrow(
      'Unsupported source type: invalid-type'
    );
  });
});
