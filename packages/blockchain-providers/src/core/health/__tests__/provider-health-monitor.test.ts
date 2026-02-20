/**
 * Tests for ProviderHealthMonitor — timer lifecycle, result callbacks,
 * and multi-blockchain coverage.
 */

import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { IBlockchainProvider } from '../../types/index.js';
import { ProviderHealthMonitor } from '../provider-health-monitor.js';

function makeProvider(name: string, blockchain: string, healthy = true): IBlockchainProvider {
  return {
    name,
    blockchain,
    isHealthy: vi.fn().mockResolvedValue(healthy ? ok(true) : err(new Error('unhealthy'))),
  } as unknown as IBlockchainProvider;
}

describe('ProviderHealthMonitor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('does not start a timer in the constructor', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const monitor = new ProviderHealthMonitor(() => new Map(), vi.fn());

    try {
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(monitor.isRunning()).toBe(false);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  test('start() creates a timer and isRunning() returns true', () => {
    vi.useFakeTimers();
    const monitor = new ProviderHealthMonitor(() => new Map(), vi.fn(), 100);

    monitor.start();
    expect(monitor.isRunning()).toBe(true);
    monitor.stop();
  });

  test('start() is idempotent — only one timer created', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const monitor = new ProviderHealthMonitor(() => new Map(), vi.fn(), 100);

    try {
      monitor.start();
      monitor.start();
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    } finally {
      monitor.stop();
      setIntervalSpy.mockRestore();
    }
  });

  test('stop() clears the timer and isRunning() returns false', () => {
    vi.useFakeTimers();
    const monitor = new ProviderHealthMonitor(() => new Map(), vi.fn(), 100);

    monitor.start();
    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  test('invokes onResult with success=true for a healthy provider', async () => {
    vi.useFakeTimers();
    const onResult = vi.fn();
    const provider = makeProvider('moralis', 'ethereum', true);
    const monitor = new ProviderHealthMonitor(() => new Map([['ethereum', [provider]]]), onResult, 100);

    monitor.start();
    await vi.advanceTimersByTimeAsync(150);
    monitor.stop();

    expect(onResult).toHaveBeenCalledOnce();
    const [blockchain, name, success, responseTime] = onResult.mock.calls[0] as [string, string, boolean, number];
    expect(blockchain).toBe('ethereum');
    expect(name).toBe('moralis');
    expect(success).toBe(true);
    expect(responseTime).toBeGreaterThanOrEqual(0);
  });

  test('invokes onResult with success=false and error message for an unhealthy provider', async () => {
    vi.useFakeTimers();
    const onResult = vi.fn();
    const provider = makeProvider('bad-provider', 'ethereum', false);
    const monitor = new ProviderHealthMonitor(() => new Map([['ethereum', [provider]]]), onResult, 100);

    monitor.start();
    await vi.advanceTimersByTimeAsync(150);
    monitor.stop();

    expect(onResult).toHaveBeenCalledOnce();
    const [blockchain, name, success, , errorMsg] = onResult.mock.calls[0] as [string, string, boolean, number, string];
    expect(blockchain).toBe('ethereum');
    expect(name).toBe('bad-provider');
    expect(success).toBe(false);
    expect(errorMsg).toBe('unhealthy');
  });

  test('checks providers across multiple blockchains per tick', async () => {
    vi.useFakeTimers();
    const onResult = vi.fn();
    const ethProvider = makeProvider('moralis', 'ethereum');
    const btcProvider = makeProvider('blockstream', 'bitcoin');

    const monitor = new ProviderHealthMonitor(
      () =>
        new Map([
          ['ethereum', [ethProvider]],
          ['bitcoin', [btcProvider]],
        ]),
      onResult,
      100
    );

    monitor.start();
    await vi.advanceTimersByTimeAsync(150);
    monitor.stop();

    expect(onResult).toHaveBeenCalledTimes(2);
    const blockchains = onResult.mock.calls.map(([bc]) => bc as string);
    expect(blockchains).toContain('ethereum');
    expect(blockchains).toContain('bitcoin');
  });
});
