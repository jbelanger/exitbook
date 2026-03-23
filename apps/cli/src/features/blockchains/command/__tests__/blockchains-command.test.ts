import { type BlockchainProviderDescriptor } from '@exitbook/blockchain-providers';
import type { AdapterRegistry } from '@exitbook/ingestion';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockComputeCategoryCounts,
  mockCreateBlockchainsViewState,
  mockDisplayCliError,
  mockListBlockchainProviders,
  mockOutputSuccess,
  mockRenderApp,
} = vi.hoisted(() => ({
  mockComputeCategoryCounts: vi.fn(),
  mockCreateBlockchainsViewState: vi.fn(),
  mockDisplayCliError: vi.fn(),
  mockListBlockchainProviders: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRenderApp: vi.fn(),
}));

vi.mock('@exitbook/blockchain-providers', () => ({
  listBlockchainProviders: mockListBlockchainProviders,
}));

vi.mock('../../../shared/cli-error.js', () => ({
  displayCliError: mockDisplayCliError,
}));

vi.mock('../../../../runtime/command-scope.js', () => ({
  renderApp: mockRenderApp,
}));

vi.mock('../../../shared/data-dir.js', () => ({
  getDataDir: () => '/tmp/exitbook-blockchains',
}));

vi.mock('../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../view/index.js', () => ({
  BlockchainsViewApp: 'BlockchainsViewApp',
  computeCategoryCounts: mockComputeCategoryCounts,
  createBlockchainsViewState: mockCreateBlockchainsViewState,
}));

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
    apiKeyEnvVar: overrides.apiKeyEnvVar,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env['HELIUS_API_KEY'];
  mockRenderApp.mockResolvedValue(undefined);
  mockComputeCategoryCounts.mockReturnValue({ solana: 1 });
  mockCreateBlockchainsViewState.mockReturnValue({ tag: 'state' });
  mockDisplayCliError.mockImplementation(
    (command: string, error: Error, _exitCode: number, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${error.message}`);
    }
  );
});

describe('registerBlockchainsCommand', () => {
  it('registers the blockchains namespace with the view subcommand', () => {
    const program = new Command();

    registerBlockchainsCommand(program, createAppRuntime());

    const blockchainsCommand = program.commands.find((command) => command.name() === 'blockchains');
    expect(blockchainsCommand).toBeDefined();
    expect(blockchainsCommand?.description()).toBe('Browse supported blockchains and provider configuration');
    expect(blockchainsCommand?.commands.map((command) => command.name())).toContain('view');
  });
});

describe('registerBlockchainsViewCommand', () => {
  it('outputs filtered blockchain catalog data in JSON mode', async () => {
    const program = new Command();

    mockListBlockchainProviders.mockReturnValue([
      createBlockchainProviderDescriptor({
        blockchain: 'bitcoin',
        displayName: 'Mempool',
        name: 'mempool',
      }),
      createBlockchainProviderDescriptor({
        apiKeyEnvVar: 'HELIUS_API_KEY',
        blockchain: 'solana',
        displayName: 'Helius',
        name: 'helius',
        requiresApiKey: true,
      }),
    ]);

    registerBlockchainsViewCommand(program.command('blockchains'), createAppRuntime());

    await program.parseAsync(['blockchains', 'view', '--category', 'utxo', '--json'], { from: 'user' });

    expect(mockListBlockchainProviders).toHaveBeenCalledWith();
    expect(mockOutputSuccess).toHaveBeenCalledWith('blockchains-view', {
      data: {
        blockchains: [
          expect.objectContaining({
            name: 'bitcoin',
            displayName: 'Bitcoin',
            category: 'utxo',
            providerCount: 1,
            exampleAddress: 'bc1q...',
            providers: [
              expect.objectContaining({
                name: 'mempool',
                displayName: 'Mempool',
                requiresApiKey: false,
                capabilities: ['balance', 'txs'],
                rateLimit: '5/sec',
              }),
            ],
          }),
        ],
      },
      meta: {
        total: 1,
        byCategory: { utxo: 1 },
        totalProviders: 2,
        filters: { category: 'utxo' },
      },
    });
  });

  it('renders the TUI with derived state in text mode', async () => {
    const program = new Command();
    const initialState = { selectedIndex: 0 };

    mockCreateBlockchainsViewState.mockReturnValue(initialState);
    mockListBlockchainProviders.mockReturnValue([
      createBlockchainProviderDescriptor({
        apiKeyEnvVar: 'HELIUS_API_KEY',
        blockchain: 'solana',
        displayName: 'Helius',
        name: 'helius',
        requiresApiKey: true,
      }),
    ]);

    registerBlockchainsViewCommand(program.command('blockchains'), createAppRuntime(['solana']));

    await program.parseAsync(['blockchains', 'view', '--requires-api-key'], { from: 'user' });

    expect(mockComputeCategoryCounts).toHaveBeenCalledWith([
      expect.objectContaining({
        category: 'solana',
        keyStatus: 'some-missing',
        missingKeyCount: 1,
        name: 'solana',
      }),
    ]);
    expect(mockCreateBlockchainsViewState).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          category: 'solana',
          displayName: 'Solana',
          keyStatus: 'some-missing',
          missingKeyCount: 1,
          name: 'solana',
          providerCount: 1,
        }),
      ],
      {
        categoryFilter: undefined,
        requiresApiKeyFilter: true,
      },
      1,
      { solana: 1 }
    );

    const renderFactory = mockRenderApp.mock.calls[0]?.[0] as ((unmount: () => void) => ReactElement) | undefined;
    expect(renderFactory).toBeDefined();

    const onQuit = vi.fn();
    const element = renderFactory?.(onQuit);
    expect(element?.type).toBe('BlockchainsViewApp');
    expect(element?.props).toEqual({
      initialState,
      onQuit,
    });
  });

  it('routes invalid category errors through the JSON CLI error path', async () => {
    const program = new Command();

    registerBlockchainsViewCommand(program.command('blockchains'), createAppRuntime());

    await expect(
      program.parseAsync(['blockchains', 'view', '--category', 'invalid', '--json'], { from: 'user' })
    ).rejects.toThrow(
      'CLI:blockchains-view:json:Invalid category: invalid. Supported: evm, substrate, cosmos, utxo, solana'
    );

    expect(mockListBlockchainProviders).not.toHaveBeenCalled();
  });
});
