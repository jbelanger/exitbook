import { describe, expect, it, vi } from 'vitest';

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

const { mockCreateSpinner, mockFailSpinner, mockStopSpinner } = vi.hoisted(() => ({
  mockCreateSpinner: vi.fn(),
  mockFailSpinner: vi.fn(),
  mockStopSpinner: vi.fn(),
}));

vi.mock('../../../shared/spinner.js', () => ({
  createSpinner: mockCreateSpinner,
  failSpinner: mockFailSpinner,
  stopSpinner: mockStopSpinner,
}));

import { ProvidersBenchmarkTextProgress } from '../providers-benchmark-text-progress.js';

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '');
}

describe('ProvidersBenchmarkTextProgress', () => {
  it('renders a durable non-interactive workflow log and final summary', () => {
    const lines: string[] = [];
    const reporter = new ProvidersBenchmarkTextProgress({
      currentRateLimit: { requestsPerSecond: 5 },
      interactive: false,
      log: (message = '') => {
        lines.push(stripAnsi(message));
      },
      params: {
        blockchain: 'ethereum',
        provider: 'alchemy',
        maxRate: 5,
        numRequests: 10,
        skipBurst: false,
      },
      providerName: 'alchemy',
    });

    reporter.begin();
    reporter.onProgress({ type: 'sustained-start', rate: 0.25 });
    reporter.onProgress({ type: 'sustained-complete', rate: 0.25, success: true, responseTimeMs: 76 });
    reporter.onProgress({ type: 'cooldown-start', reason: 'next-rate', seconds: 60 });
    reporter.onProgress({ type: 'cooldown-heartbeat', reason: 'next-rate', secondsRemaining: 30 });
    reporter.onProgress({ type: 'cooldown-complete', reason: 'next-rate' });
    reporter.onProgress({ type: 'burst-start', limit: 10 });
    reporter.onProgress({ type: 'burst-complete', limit: 10, success: true });
    reporter.complete({
      maxSafeRate: 5,
      recommended: {
        burstLimit: 8,
        requestsPerHour: 12_960,
        requestsPerMinute: 48,
        requestsPerSecond: 4,
      },
      testResults: [{ rate: 0.25, success: true, responseTimeMs: 76 }],
      burstLimits: [{ limit: 10, success: true }],
    });

    expect(lines).toContain('Benchmark alchemy · ethereum · running');
    expect(lines).toContain('Provider Info');
    expect(lines).toContain('  Current rate limit: {"requestsPerSecond":5}');
    expect(lines).toContain('Sustained Rate Tests');
    expect(lines.some((line) => line.includes('0.25 req/sec'))).toBe(true);
    expect(lines.some((line) => line.includes('avg 76ms'))).toBe(true);
    expect(lines).toContain('  · waiting 60s before next rate test');
    expect(lines.some((line) => line.includes('remaining'))).toBe(false);
    expect(lines).toContain('Burst Limit Tests');
    expect(lines.some((line) => line.includes('10 req/min'))).toBe(true);
    expect(lines).toContain('✓ Benchmark complete');
    expect(lines).toContain('Max safe rate: 5 req/sec');
    expect(lines).toContain('Recommended configuration (80% safety margin):');
    expect(lines).toContain('Example override for alchemy:');
  });

  it('uses spinners for active steps on interactive terminals', () => {
    const lines: string[] = [];
    const spinner = { ora: { text: '' } };
    mockCreateSpinner.mockReturnValue(spinner);

    const reporter = new ProvidersBenchmarkTextProgress({
      currentRateLimit: { requestsPerSecond: 5 },
      interactive: true,
      log: (message = '') => {
        lines.push(stripAnsi(message));
      },
      params: {
        blockchain: 'ethereum',
        provider: 'alchemy',
        maxRate: 5,
        numRequests: 10,
        skipBurst: false,
      },
      providerName: 'alchemy',
    });

    reporter.begin();
    reporter.onProgress({ type: 'sustained-start', rate: 0.25 });
    reporter.onProgress({ type: 'sustained-complete', rate: 0.25, success: true, responseTimeMs: 76 });
    reporter.onProgress({ type: 'cooldown-start', reason: 'next-rate', seconds: 60 });
    reporter.onProgress({ type: 'cooldown-heartbeat', reason: 'next-rate', secondsRemaining: 45 });
    reporter.onProgress({ type: 'cooldown-complete', reason: 'next-rate' });
    reporter.onProgress({ type: 'burst-start', limit: 10 });
    reporter.onProgress({ type: 'burst-complete', limit: 10, success: false });

    expect(mockCreateSpinner).toHaveBeenCalledWith(expect.stringContaining('0.25 req/sec'), false);
    expect(mockStopSpinner).toHaveBeenCalledWith(spinner, expect.stringContaining('0.25 req/sec'));
    expect(mockCreateSpinner).toHaveBeenCalledWith(expect.stringContaining('waiting 60s'), false);
    expect(spinner.ora.text).toContain('45s remaining');
    expect(mockCreateSpinner).toHaveBeenCalledWith(expect.stringContaining('10 req/min'), false);
    expect(mockFailSpinner).toHaveBeenCalledWith(spinner, expect.stringContaining('10 req/min'));
    expect(lines).toContain('Sustained Rate Tests');
    expect(lines).toContain('Burst Limit Tests');
    expect(lines.some((line) => line.includes('waiting'))).toBe(false);
    expect(lines.some((line) => line.includes('remaining'))).toBe(false);
  });
});
