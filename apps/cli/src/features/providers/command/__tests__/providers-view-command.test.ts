import { Command } from 'commander';
import type { ReactElement } from 'react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureTerminalInteractivity,
  restoreTerminalInteractivity,
  setTerminalInteractivity,
} from '../../../../runtime/__tests__/terminal-test-utils.js';
import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const originalTerminalInteractivity = captureTerminalInteractivity();

const {
  mockComputeHealthCounts,
  mockCreateProvidersViewState,
  mockExitCliFailure,
  mockOutputSuccess,
  mockProvidersViewExecute,
  mockRenderApp,
} = vi.hoisted(() => ({
  mockComputeHealthCounts: vi.fn(),
  mockCreateProvidersViewState: vi.fn(),
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockProvidersViewExecute: vi.fn(),
  mockRenderApp: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  renderApp: mockRenderApp,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../providers-view-handler.js', () => ({
  ProvidersViewHandler: class {
    execute = mockProvidersViewExecute;
  },
}));

vi.mock('../../view/index.js', () => ({
  ProvidersViewApp: 'ProvidersViewApp',
  computeHealthCounts: mockComputeHealthCounts,
  createProvidersViewState: mockCreateProvidersViewState,
}));

import { registerProvidersExploreCommand } from '../providers-explore.js';
import { registerProvidersViewCommand } from '../providers-view.js';
import { registerProvidersCommand } from '../providers.js';

function createAppRuntime(): CliAppRuntime {
  return {
    dataDir: '/tmp/provider-data',
    blockchainExplorersConfig: {},
  } as CliAppRuntime;
}

beforeEach(() => {
  vi.clearAllMocks();
  setTerminalInteractivity(false);
  mockRenderApp.mockResolvedValue(undefined);
  mockProvidersViewExecute.mockResolvedValue([
    {
      name: 'blockstream.info',
      displayName: 'Blockstream.info',
      requiresApiKey: false,
      apiKeyConfigured: undefined,
      blockchains: [
        {
          name: 'bitcoin',
          capabilities: ['txs', 'balance'],
          rateLimit: '5/sec',
          configSource: 'default',
        },
      ],
      chainCount: 1,
      stats: undefined,
      healthStatus: 'no-stats',
      rateLimit: '5/sec',
      configSource: 'default',
      lastError: undefined,
      lastErrorTime: undefined,
    },
    {
      name: 'alchemy',
      displayName: 'Alchemy',
      requiresApiKey: true,
      apiKeyEnvName: 'ALCHEMY_API_KEY',
      apiKeyConfigured: true,
      blockchains: [
        {
          name: 'ethereum',
          capabilities: ['txs', 'balance', 'tokens'],
          rateLimit: '5/sec',
          configSource: 'default',
          stats: {
            totalSuccesses: 100,
            totalFailures: 0,
            avgResponseTime: 120,
            errorRate: 0,
            isHealthy: true,
          },
        },
      ],
      chainCount: 1,
      stats: {
        totalRequests: 100,
        avgResponseTime: 120,
        errorRate: 0,
        lastChecked: 1_700_000_000,
      },
      healthStatus: 'healthy',
      rateLimit: '5/sec',
      configSource: 'default',
      lastError: undefined,
      lastErrorTime: undefined,
    },
  ]);
  mockComputeHealthCounts.mockReturnValue({ degraded: 0, healthy: 1, noStats: 1, unhealthy: 0 });
  mockCreateProvidersViewState.mockImplementation(
    (
      providers: unknown[],
      filters: {
        blockchainFilter?: string | undefined;
        healthFilter?: string | undefined;
        missingApiKeyFilter?: boolean | undefined;
      },
      healthCounts: { degraded: number; healthy: number; noStats: number; unhealthy: number } | undefined,
      selectedIndex: number | undefined
    ) =>
      ({
        blockchainFilter: filters.blockchainFilter,
        healthCounts: healthCounts ?? { degraded: 0, healthy: 0, noStats: 0, unhealthy: 0 },
        healthFilter: filters.healthFilter,
        missingApiKeyFilter: filters.missingApiKeyFilter,
        providers,
        scrollOffset: selectedIndex ?? 0,
        selectedIndex: selectedIndex ?? 0,
        apiKeyRequiredCount: 1,
        totalCount: providers.length,
      }) as {
        apiKeyRequiredCount: number;
        blockchainFilter?: string | undefined;
        healthCounts: { degraded: number; healthy: number; noStats: number; unhealthy: number };
        healthFilter?: string | undefined;
        missingApiKeyFilter?: boolean | undefined;
        providers: unknown[];
        scrollOffset: number;
        selectedIndex: number;
        totalCount: number;
      }
  );
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

afterAll(() => {
  restoreTerminalInteractivity(originalTerminalInteractivity);
});

describe('registerProvidersCommand', () => {
  it('registers the providers namespace with list, view, explore, and benchmark subcommands', () => {
    const program = new Command();

    registerProvidersCommand(program, createAppRuntime());

    const providersCommand = program.commands.find((command) => command.name() === 'providers');
    expect(providersCommand).toBeDefined();
    expect(providersCommand?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(['list', 'view', 'explore', 'benchmark'])
    );
  });

  it('outputs summary-shaped JSON from the bare root command', async () => {
    const program = new Command();

    registerProvidersCommand(program, createAppRuntime());

    await program.parseAsync(['providers', '--json'], { from: 'user' });

    expect(mockProvidersViewExecute).toHaveBeenCalledWith({
      blockchain: undefined,
      health: undefined,
      missingApiKey: undefined,
    });

    const payload = mockOutputSuccess.mock.calls[0]?.[1] as { providers: Record<string, unknown>[] };
    expect(payload.providers).toHaveLength(2);
    expect(payload.providers[0]).not.toHaveProperty('blockchains');
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'providers',
      {
        providers: [
          expect.objectContaining({
            name: 'blockstream.info',
            chainCount: 1,
            healthStatus: 'no-stats',
          }),
          expect.objectContaining({
            name: 'alchemy',
            chainCount: 1,
            healthStatus: 'healthy',
          }),
        ],
      },
      {
        total: 2,
        byHealth: { degraded: 0, healthy: 1, noStats: 1, unhealthy: 0 },
        requireApiKey: 1,
        filters: undefined,
      }
    );
  });

  it('outputs summary-shaped JSON from the explicit list alias', async () => {
    const program = new Command();

    registerProvidersCommand(program, createAppRuntime());

    await program.parseAsync(['providers', 'list', '--json'], { from: 'user' });

    expect(mockProvidersViewExecute).toHaveBeenCalledWith({
      blockchain: undefined,
      health: undefined,
      missingApiKey: undefined,
    });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'providers-list',
      {
        providers: [
          expect.objectContaining({
            name: 'blockstream.info',
            chainCount: 1,
            healthStatus: 'no-stats',
          }),
          expect.objectContaining({
            name: 'alchemy',
            chainCount: 1,
            healthStatus: 'healthy',
          }),
        ],
      },
      {
        total: 2,
        byHealth: { degraded: 0, healthy: 1, noStats: 1, unhealthy: 0 },
        requireApiKey: 1,
        filters: undefined,
      }
    );
  });

  it('rejects bare selectors and points callers to view or explore', async () => {
    const program = new Command();

    registerProvidersCommand(program, createAppRuntime());

    await expect(program.parseAsync(['providers', 'alchemy', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:providers:json:Use "providers view alchemy" for static detail or "providers explore alchemy" for the explorer.:2'
    );
  });
});

describe('registerProvidersViewCommand', () => {
  it('outputs detail-shaped JSON for one provider', async () => {
    const program = new Command();

    registerProvidersViewCommand(program.command('providers'), createAppRuntime());

    await program.parseAsync(['providers', 'view', 'ALCHEMY', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'providers-view',
      expect.objectContaining({
        name: 'alchemy',
        displayName: 'Alchemy',
        apiKeyEnvName: 'ALCHEMY_API_KEY',
        blockchains: [expect.objectContaining({ name: 'ethereum' })],
      }),
      undefined
    );
  });

  it('stays static on an interactive terminal instead of mounting Ink', async () => {
    const program = new Command();
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    setTerminalInteractivity(true);
    registerProvidersViewCommand(program.command('providers'), createAppRuntime());

    await program.parseAsync(['providers', 'view', 'alchemy'], { from: 'user' });

    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Alchemy healthy'));
    stdoutWrite.mockRestore();
  });

  it('rejects combining a selector with browse filters', async () => {
    const program = new Command();

    registerProvidersViewCommand(program.command('providers'), createAppRuntime());

    await expect(
      program.parseAsync(['providers', 'view', 'alchemy', '--health', 'healthy'], { from: 'user' })
    ).rejects.toThrow(
      'CLI:providers-view:text:Provider selector cannot be combined with --blockchain, --health, or --missing-api-key:2'
    );
  });

  it('fails with NOT_FOUND when a provider selector does not resolve', async () => {
    const program = new Command();

    registerProvidersViewCommand(program.command('providers'), createAppRuntime());

    await expect(
      program.parseAsync(['providers', 'view', 'missing-provider', '--json'], { from: 'user' })
    ).rejects.toThrow("CLI:providers-view:json:Provider selector 'missing-provider' not found:4");
  });
});

describe('registerProvidersExploreCommand', () => {
  it('renders the TUI with a preselected provider on an interactive terminal', async () => {
    const program = new Command();

    setTerminalInteractivity(true);
    registerProvidersExploreCommand(program.command('providers'), createAppRuntime());

    await program.parseAsync(['providers', 'explore', 'alchemy'], { from: 'user' });

    expect(mockCreateProvidersViewState).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'blockstream.info' }), expect.objectContaining({ name: 'alchemy' })],
      {
        blockchainFilter: undefined,
        healthFilter: undefined,
        missingApiKeyFilter: undefined,
      },
      { degraded: 0, healthy: 1, noStats: 1, unhealthy: 0 },
      1
    );

    const renderFactory = mockRenderApp.mock.calls[0]?.[0] as ((unmount: () => void) => ReactElement) | undefined;
    expect(renderFactory).toBeDefined();

    const onQuit = vi.fn();
    const element = renderFactory?.(onQuit);
    expect(element?.type).toBe('ProvidersViewApp');
  });

  it('falls back to static detail off-TTY instead of mounting the explorer', async () => {
    const program = new Command();
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    registerProvidersExploreCommand(program.command('providers'), createAppRuntime());

    await program.parseAsync(['providers', 'explore', 'alchemy'], { from: 'user' });

    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Alchemy healthy'));
    stdoutWrite.mockRestore();
  });

  it('routes invalid health errors through the JSON CLI error path', async () => {
    const program = new Command();

    registerProvidersExploreCommand(program.command('providers'), createAppRuntime());

    await expect(
      program.parseAsync(['providers', 'explore', '--health', 'broken', '--json'], { from: 'user' })
    ).rejects.toThrow(/CLI:providers-explore:json:Invalid option/);

    expect(mockProvidersViewExecute).not.toHaveBeenCalled();
  });
});
