import { listBlockchainProviders, type BlockchainProviderDescriptor } from '@exitbook/blockchain-providers';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions, withCliCommandErrorHandling } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { buildDefinedFilters } from '../../shared/view-utils.js';
import { toBlockchainViewItem } from '../blockchain-view-projection.js';
import { BlockchainsViewApp, computeCategoryCounts, createBlockchainsViewState } from '../view/index.js';

import { BlockchainsViewCommandOptionsSchema } from './blockchains-option-schemas.js';
import type { BlockchainCategory } from './blockchains-view-utils.js';
import {
  buildBlockchainCatalogItem,
  filterByApiKeyRequirement,
  filterByCategory,
  sortBlockchains,
  validateCategory,
} from './blockchains-view-utils.js';

/**
 * Command options (validated at CLI boundary).
 */
type CommandOptions = z.infer<typeof BlockchainsViewCommandOptionsSchema>;

/**
 * Register the blockchains view subcommand.
 */
export function registerBlockchainsViewCommand(blockchainsCommand: Command, appRuntime: CliAppRuntime): void {
  blockchainsCommand
    .command('view')
    .description('View supported blockchains and provider configuration')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook blockchains view                        # View all blockchains
  $ exitbook blockchains view --category evm         # View EVM blockchains only
  $ exitbook blockchains view --requires-api-key     # View blockchains requiring API keys
  $ exitbook blockchains view --json                 # Output JSON

Common Usage:
  - Browse supported blockchains and their providers
  - Check API key configuration status
  - View provider capabilities and rate limits

Categories:
  evm, substrate, cosmos, utxo, solana
`
    )
    .option('--category <type>', 'Filter by category (evm, substrate, cosmos, utxo, solana)')
    .option('--requires-api-key', 'Show only blockchains that require API keys')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeBlockchainsViewCommand(rawOptions, appRuntime);
    });
}

/**
 * Execute the blockchains view command.
 */
async function executeBlockchainsViewCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const { format, options } = parseCliCommandOptions(
    'blockchains-view',
    rawOptions,
    BlockchainsViewCommandOptionsSchema
  );
  if (format === 'json') {
    await executeBlockchainsViewJSON(options, appRuntime);
  } else {
    await executeBlockchainsViewTUI(options, appRuntime);
  }
}

/**
 * Load and prepare blockchain data with filters applied.
 */
function loadBlockchainCatalogData(
  options: CommandOptions,
  appRuntime: CliAppRuntime,
  format: 'json' | 'text'
): {
  allProviders: BlockchainProviderDescriptor[];
  blockchains: ReturnType<typeof buildBlockchainCatalogItem>[];
  validatedCategory: BlockchainCategory | undefined;
} | null {
  let validatedCategory: BlockchainCategory | undefined;
  if (options.category) {
    const categoryResult = validateCategory(options.category);
    if (categoryResult.isErr()) {
      displayCliError('blockchains-view', categoryResult.error, ExitCodes.INVALID_ARGS, format);
    }
    validatedCategory = categoryResult.value;
  }

  const supportedBlockchains = appRuntime.adapterRegistry.getAllBlockchains();
  const allProviders = listBlockchainProviders();

  let blockchains = supportedBlockchains.map((blockchain: string) => {
    const providers = allProviders.filter((provider) => provider.blockchain === blockchain);
    return buildBlockchainCatalogItem(blockchain, providers);
  });

  if (validatedCategory) {
    blockchains = filterByCategory(blockchains, validatedCategory);
  }

  if (options.requiresApiKey !== undefined) {
    blockchains = filterByApiKeyRequirement(blockchains, options.requiresApiKey);
  }

  blockchains = sortBlockchains(blockchains);

  return { blockchains, allProviders, validatedCategory };
}

/**
 * Execute blockchains view in TUI mode
 */
async function executeBlockchainsViewTUI(options: CommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  await withCliCommandErrorHandling('blockchains-view', 'text', async () => {
    const data = loadBlockchainCatalogData(options, appRuntime, 'text');
    if (!data) return;

    const { blockchains, allProviders, validatedCategory } = data;
    const viewItems = blockchains.map((b) => toBlockchainViewItem(b));
    const categoryCounts = computeCategoryCounts(viewItems);

    const initialState = createBlockchainsViewState(
      viewItems,
      {
        categoryFilter: validatedCategory,
        requiresApiKeyFilter: options.requiresApiKey,
      },
      allProviders.length,
      categoryCounts
    );

    await renderApp((unmount) =>
      React.createElement(BlockchainsViewApp, {
        initialState,
        onQuit: unmount,
      })
    );
  });
}

/**
 * Execute blockchains view in JSON mode
 */
async function executeBlockchainsViewJSON(options: CommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  await withCliCommandErrorHandling('blockchains-view', 'json', async () => {
    const data = loadBlockchainCatalogData(options, appRuntime, 'json');
    if (!data) return;

    const { blockchains, allProviders, validatedCategory } = data;
    const categoryCounts: Record<string, number> = {};
    for (const blockchain of blockchains) {
      categoryCounts[blockchain.category] = (categoryCounts[blockchain.category] || 0) + 1;
    }

    outputSuccess('blockchains-view', {
      data: {
        blockchains: blockchains.map((blockchain) => ({
          name: blockchain.name,
          displayName: blockchain.displayName,
          category: blockchain.category,
          layer: blockchain.layer,
          providers: blockchain.providers.map((provider) => ({
            name: provider.name,
            displayName: provider.displayName,
            requiresApiKey: provider.requiresApiKey,
            capabilities: provider.capabilities,
            rateLimit: provider.rateLimit,
          })),
          providerCount: blockchain.providerCount,
          exampleAddress: blockchain.exampleAddress,
        })),
      },
      meta: {
        total: blockchains.length,
        byCategory: categoryCounts,
        totalProviders: allProviders.length,
        filters: buildDefinedFilters({
          category: validatedCategory,
          requiresApiKey: options.requiresApiKey ? true : undefined,
        }),
      },
    });
  });
}
