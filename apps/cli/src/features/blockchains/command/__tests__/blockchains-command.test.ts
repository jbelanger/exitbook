import { type BlockchainProviderDescriptor } from '@exitbook/blockchain-providers';
import type { AdapterRegistry } from '@exitbook/ingestion/adapters';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const originalStdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const originalStdoutTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

const {
  mockComputeCategoryCounts,
  mockCreateBlockchainsViewState,
  mockExitCliFailure,
  mockListBlockchainProviders,
  mockOutputSuccess,
  mockRenderApp,
} = vi.hoisted(() => ({
  mockComputeCategoryCounts: vi.fn(),
  mockCreateBlockchainsViewState: vi.fn(),
  mockExitCliFailure: vi.fn(),
  mockListBlockchainProviders: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRenderApp: vi.fn(),
}));

vi.mock('@exitbook/blockchain-providers', () => ({
  listBlockchainProviders: mockListBlockchainProviders,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  renderApp: mockRenderApp,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../view/index.js', () => ({
  BlockchainsViewApp: 'BlockchainsViewApp',
  computeCategoryCounts: mockComputeCategoryCounts,
  createBlockchainsViewState: mockCreateBlockchainsViewState,
}));

import { registerBlockchainsExploreCommand } from '../blockchains-explore.js';
import { registerBlockchainsViewCommand } from '../blockchains-view.js';
import { registerBlockchainsCommand } from '../blockchains.js';

function createAppRuntime(blockchains: string[] = ['bitcoin', 'solana']): CliAppRuntime {
  return {
    adapterRegistry: createRegistry(blockchains),
    blockchainExplorersConfig: {},
    dataDir: '/tmp/exitbook-blockchains',
    databasePath: '/tmp/exitbook-blockchains/transactions.db',
    priceProviderConfig: {
      coingecko: {
        apiKey: undefined,
        useProApi: false,
      },
      cryptocompare: {
        apiKey: undefined,
      },
    },
  };
}

function createRegistry(blockchains: string[] = ['bitcoin', 'solana']): AdapterRegistry {
  return {
    getAllBlockchains: vi.fn().mockReturnValue(blockchains),
  } as unknown as AdapterRegistry;
}

function createBlockchainProviderDescriptor(
  overrides: Partial<BlockchainProviderDescriptor> &
    Pick<BlockchainProviderDescriptor, 'blockchain' | 'displayName' | 'name'>
): BlockchainProviderDescriptor {
  return {
    blockchain: overrides.blockchain,
    capabilities: overrides.capabilities ?? {
      supportedOperations: ['getAddressBalance', 'getAddressTransactions'],
    },
    defaultConfig: overrides.defaultConfig ?? {
      rateLimit: {
        requestsPerSecond: 5,
      },
      retries: 2,
      timeout: 1000,
    },
    description: overrides.description,
    displayName: overrides.displayName,
    name: overrides.name,
    requiresApiKey: overrides.requiresApiKey ?? false,
    apiKeyEnvName: overrides.apiKeyEnvName,
  };
}

function setTerminalInteractivity(isInteractive: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: isInteractive,
  });
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: isInteractive,
  });
  delete process.env['CI'];
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env['HELIUS_API_KEY'];
  delete process.env['ALCHEMY_API_KEY'];
  setTerminalInteractivity(false);
  mockRenderApp.mockResolvedValue(undefined);
  mockComputeCategoryCounts.mockImplementation((items: { category: string }[]) => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
    }
    return counts;
  });
  mockCreateBlockchainsViewState.mockImplementation(
    (
      blockchains: unknown[],
      filters: { categoryFilter?: string | undefined; requiresApiKeyFilter?: boolean | undefined },
      totalProviders: number,
      categoryCounts: Record<string, number> | undefined,
      selectedIndex: number | undefined
    ) =>
      ({
        blockchains,
        categoryFilter: filters.categoryFilter,
        categoryCounts: categoryCounts ?? {},
        requiresApiKeyFilter: filters.requiresApiKeyFilter,
        scrollOffset: selectedIndex ?? 0,
        selectedIndex: selectedIndex ?? 0,
        totalCount: blockchains.length,
        totalProviders,
      }) as {
        blockchains: unknown[];
        categoryCounts: Record<string, number>;
        categoryFilter?: string | undefined;
        requiresApiKeyFilter?: boolean | undefined;
        scrollOffset: number;
        selectedIndex: number;
        totalCount: number;
        totalProviders: number;
      }
  );
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

afterAll(() => {
  if (originalStdinTTYDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', originalStdinTTYDescriptor);
  }
  if (originalStdoutTTYDescriptor) {
    Object.defineProperty(process.stdout, 'isTTY', originalStdoutTTYDescriptor);
  }
});

describe('registerBlockchainsCommand', () => {
  it('registers the blockchains namespace with list, view, and explore subcommands', () => {
    const program = new Command();

    registerBlockchainsCommand(program, createAppRuntime());

    const blockchainsCommand = program.commands.find((command) => command.name() === 'blockchains');
    expect(blockchainsCommand).toBeDefined();
    expect(blockchainsCommand?.description()).toBe('Browse supported blockchains and provider configuration');
    expect(blockchainsCommand?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(['list', 'view', 'explore'])
    );
  });

  it('outputs summary-shaped JSON from the bare root command', async () => {
    const program = new Command();

    mockListBlockchainProviders.mockReturnValue([
      createBlockchainProviderDescriptor({
        blockchain: 'bitcoin',
        displayName: 'Mempool',
        name: 'mempool',
      }),
      createBlockchainProviderDescriptor({
        apiKeyEnvName: 'HELIUS_API_KEY',
        blockchain: 'solana',
        displayName: 'Helius',
        name: 'helius',
        requiresApiKey: true,
      }),
    ]);

    registerBlockchainsCommand(program, createAppRuntime(['bitcoin', 'solana']));

    await program.parseAsync(['blockchains', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'blockchains',
      {
        blockchains: [
          expect.objectContaining({
            name: 'bitcoin',
            displayName: 'Bitcoin',
            category: 'utxo',
            providerCount: 1,
          }),
          expect.objectContaining({
            name: 'solana',
            displayName: 'Solana',
            category: 'solana',
            providerCount: 1,
          }),
        ],
      },
      {
        total: 2,
        byCategory: { utxo: 1, solana: 1 },
        totalProviders: 2,
        filters: undefined,
      }
    );
  });

  it('outputs summary-shaped JSON from the explicit list alias', async () => {
    const program = new Command();

    mockListBlockchainProviders.mockReturnValue([
      createBlockchainProviderDescriptor({
        blockchain: 'bitcoin',
        displayName: 'Mempool',
        name: 'mempool',
      }),
    ]);

    registerBlockchainsCommand(program, createAppRuntime(['bitcoin']));

    await program.parseAsync(['blockchains', 'list', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'blockchains-list',
      {
        blockchains: [
          expect.objectContaining({
            name: 'bitcoin',
            displayName: 'Bitcoin',
            category: 'utxo',
            providerCount: 1,
          }),
        ],
      },
      {
        total: 1,
        byCategory: { utxo: 1 },
        totalProviders: 1,
        filters: undefined,
      }
    );
  });

  it('rejects bare selectors and points callers to view or explore', async () => {
    const program = new Command();

    registerBlockchainsCommand(program, createAppRuntime());

    await expect(program.parseAsync(['blockchains', 'ethereum', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:blockchains:json:Use "blockchains view ethereum" for static detail or "blockchains explore ethereum" for the explorer.:2'
    );
  });
});

describe('registerBlockchainsViewCommand', () => {
  it('outputs detail-shaped JSON for one blockchain', async () => {
    const program = new Command();

    mockListBlockchainProviders.mockReturnValue([
      createBlockchainProviderDescriptor({
        apiKeyEnvName: 'ALCHEMY_API_KEY',
        blockchain: 'ethereum',
        displayName: 'Alchemy',
        name: 'alchemy',
        requiresApiKey: true,
      }),
      createBlockchainProviderDescriptor({
        blockchain: 'ethereum',
        displayName: 'Etherscan',
        name: 'etherscan',
      }),
    ]);
    process.env['ALCHEMY_API_KEY'] = 'configured';

    registerBlockchainsViewCommand(program.command('blockchains'), createAppRuntime(['bitcoin', 'ethereum']));

    await program.parseAsync(['blockchains', 'view', 'ETHEREUM', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'blockchains-view',
      expect.objectContaining({
        name: 'ethereum',
        displayName: 'Ethereum',
        category: 'evm',
        providerCount: 2,
        keyStatus: 'all-configured',
        providers: [
          expect.objectContaining({
            name: 'alchemy',
            apiKeyConfigured: true,
          }),
          expect.objectContaining({
            name: 'etherscan',
            requiresApiKey: false,
          }),
        ],
      }),
      undefined
    );
  });

  it('stays static on an interactive terminal instead of mounting Ink', async () => {
    const program = new Command();
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    setTerminalInteractivity(true);
    mockListBlockchainProviders.mockReturnValue([
      createBlockchainProviderDescriptor({
        blockchain: 'bitcoin',
        displayName: 'Mempool',
        name: 'mempool',
      }),
    ]);

    registerBlockchainsViewCommand(program.command('blockchains'), createAppRuntime(['bitcoin']));

    await program.parseAsync(['blockchains', 'view', 'bitcoin'], { from: 'user' });

    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Bitcoin bitcoin utxo L1'));
    stdoutWrite.mockRestore();
  });

  it('rejects combining a selector with browse filters', async () => {
    const program = new Command();

    registerBlockchainsViewCommand(program.command('blockchains'), createAppRuntime());

    await expect(
      program.parseAsync(['blockchains', 'view', 'bitcoin', '--category', 'utxo'], { from: 'user' })
    ).rejects.toThrow(
      'CLI:blockchains-view:text:Blockchain selector cannot be combined with --category or --requires-api-key:2'
    );
  });

  it('fails with NOT_FOUND when a blockchain selector does not resolve', async () => {
    const program = new Command();

    mockListBlockchainProviders.mockReturnValue([]);
    registerBlockchainsViewCommand(program.command('blockchains'), createAppRuntime(['bitcoin']));

    await expect(program.parseAsync(['blockchains', 'view', 'ethereum', '--json'], { from: 'user' })).rejects.toThrow(
      "CLI:blockchains-view:json:Blockchain selector 'ethereum' not found:4"
    );
  });
});

describe('registerBlockchainsExploreCommand', () => {
  it('renders the TUI with a preselected blockchain on an interactive terminal', async () => {
    const program = new Command();

    setTerminalInteractivity(true);
    mockListBlockchainProviders.mockReturnValue([
      createBlockchainProviderDescriptor({
        blockchain: 'bitcoin',
        displayName: 'Mempool',
        name: 'mempool',
      }),
      createBlockchainProviderDescriptor({
        apiKeyEnvName: 'HELIUS_API_KEY',
        blockchain: 'solana',
        displayName: 'Helius',
        name: 'helius',
        requiresApiKey: true,
      }),
    ]);

    registerBlockchainsExploreCommand(program.command('blockchains'), createAppRuntime(['bitcoin', 'solana']));

    await program.parseAsync(['blockchains', 'explore', 'solana'], { from: 'user' });

    expect(mockCreateBlockchainsViewState).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'bitcoin' }), expect.objectContaining({ name: 'solana' })],
      {
        categoryFilter: undefined,
        requiresApiKeyFilter: undefined,
      },
      2,
      { utxo: 1, solana: 1 },
      1
    );

    const renderFactory = mockRenderApp.mock.calls[0]?.[0] as ((unmount: () => void) => ReactElement) | undefined;
    expect(renderFactory).toBeDefined();

    const onQuit = vi.fn();
    const element = renderFactory?.(onQuit);
    expect(element?.type).toBe('BlockchainsViewApp');
  });

  it('falls back to static detail off-TTY instead of mounting the explorer', async () => {
    const program = new Command();
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    mockListBlockchainProviders.mockReturnValue([
      createBlockchainProviderDescriptor({
        blockchain: 'bitcoin',
        displayName: 'Mempool',
        name: 'mempool',
      }),
    ]);

    registerBlockchainsExploreCommand(program.command('blockchains'), createAppRuntime(['bitcoin']));

    await program.parseAsync(['blockchains', 'explore', 'bitcoin'], { from: 'user' });

    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Bitcoin bitcoin utxo L1'));
    stdoutWrite.mockRestore();
  });

  it('routes invalid category errors through the JSON CLI error path', async () => {
    const program = new Command();

    registerBlockchainsExploreCommand(program.command('blockchains'), createAppRuntime());

    await expect(
      program.parseAsync(['blockchains', 'explore', '--category', 'invalid', '--json'], { from: 'user' })
    ).rejects.toThrow(
      'CLI:blockchains-explore:json:Invalid category: invalid. Supported: evm, substrate, cosmos, utxo, solana, other:2'
    );

    expect(mockListBlockchainProviders).not.toHaveBeenCalled();
  });
});
