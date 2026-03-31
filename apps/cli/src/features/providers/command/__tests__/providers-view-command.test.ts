import { Command } from 'commander';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

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

vi.mock('../../../shared/cli-error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../shared/json-output.js', () => ({
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

import { registerProvidersViewCommand } from '../providers-view.js';

function createProgram(): Command {
  const program = new Command();
  registerProvidersViewCommand(program.command('providers'), {
    dataDir: '/tmp/provider-data',
    blockchainExplorersConfig: {},
  } as CliAppRuntime);
  return program;
}

describe('providers view command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProvidersViewExecute.mockResolvedValue([
      {
        name: 'alchemy',
        displayName: 'Alchemy',
        requiresApiKey: true,
        apiKeyConfigured: true,
        blockchains: [
          {
            name: 'ethereum',
            capabilities: ['rpc'],
            rateLimit: '5/sec',
            configSource: 'default',
            stats: {
              totalSuccesses: 10,
              totalFailures: 0,
              avgResponseTime: 120,
              errorRate: 0,
            },
          },
        ],
        chainCount: 1,
        stats: {
          totalRequests: 10,
          avgResponseTime: 120,
          errorRate: 0,
          lastChecked: 1_700_000_000,
        },
        healthStatus: 'healthy',
        lastError: undefined,
      },
    ]);
    mockComputeHealthCounts.mockReturnValue({ healthy: 1, degraded: 0, unhealthy: 0, 'no-stats': 0 });
    mockCreateProvidersViewState.mockReturnValue({ tag: 'providers-view-state' });
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
  });

  it('outputs JSON through the shared boundary', async () => {
    const program = createProgram();

    await program.parseAsync(['providers', 'view', '--blockchain', 'ethereum', '--json'], { from: 'user' });

    expect(mockProvidersViewExecute).toHaveBeenCalledWith({
      blockchain: 'ethereum',
      health: undefined,
      missingApiKey: undefined,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'providers-view',
      {
        data: {
          providers: [
            expect.objectContaining({
              name: 'alchemy',
              displayName: 'Alchemy',
              chainCount: 1,
              healthStatus: 'healthy',
            }),
          ],
        },
        meta: {
          total: 1,
          byHealth: { healthy: 1, degraded: 0, unhealthy: 0, 'no-stats': 0 },
          requireApiKey: 1,
          filters: {
            blockchain: 'ethereum',
          },
        },
      },
      undefined
    );
  });

  it('renders the TUI in text mode', async () => {
    const program = createProgram();
    let renderedElement: ReactElement | undefined;

    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(['providers', 'view'], { from: 'user' });

    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('ProvidersViewApp');
    expect(mockOutputSuccess).not.toHaveBeenCalled();
  });

  it('rejects invalid health filters before loading providers', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['providers', 'view', '--health', 'broken', '--json'], { from: 'user' })
    ).rejects.toThrow(/CLI:providers-view:json:Invalid option/);

    expect(mockProvidersViewExecute).not.toHaveBeenCalled();
  });

  it('routes handler failures through the shared boundary', async () => {
    const program = createProgram();
    mockProvidersViewExecute.mockRejectedValue(new Error('Failed to load provider stats'));

    await expect(program.parseAsync(['providers', 'view', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:providers-view:json:Failed to load provider stats:1'
    );
  });
});
