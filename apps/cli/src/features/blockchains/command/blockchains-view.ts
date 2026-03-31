import { listBlockchainProviders, type BlockchainProviderDescriptor } from '@exitbook/blockchain-providers';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp } from '../../../runtime/command-runtime.js';
import { runCliCommandBoundary } from '../../shared/cli-boundary.js';
import {
  createCliFailure,
  jsonSuccess,
  silentSuccess,
  toCliResult,
  type CliCompletion,
  type CliFailure,
} from '../../shared/cli-contract.js';
import { detectCliOutputFormat } from '../../shared/cli-output-format.js';
import { parseCliCommandOptionsResult } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { buildDefinedFilters } from '../../shared/view-utils.js';
import { toBlockchainViewItem } from '../blockchain-view-projection.js';
import { BlockchainsViewApp, computeCategoryCounts, createBlockchainsViewState } from '../view/index.js';

import { BlockchainsViewCommandOptionsSchema } from './blockchains-option-schemas.js';
import type { BlockchainCatalogItem, BlockchainCategory } from './blockchains-view-utils.js';
import {
  buildBlockchainCatalogItem,
  filterByApiKeyRequirement,
  filterByCategory,
  sortBlockchains,
  validateCategory,
} from './blockchains-view-utils.js';

type BlockchainsViewCommandOptions = z.infer<typeof BlockchainsViewCommandOptionsSchema>;

interface BlockchainsViewData {
  allProviders: BlockchainProviderDescriptor[];
  blockchains: BlockchainCatalogItem[];
  validatedCategory?: BlockchainCategory | undefined;
}

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
  evm, substrate, cosmos, utxo, solana, other
`
    )
    .option('--category <type>', 'Filter by category (evm, substrate, cosmos, utxo, solana, other)')
    .option('--requires-api-key', 'Show only blockchains that require API keys')
    .option('--json', 'Output results in JSON format')
    .action((rawOptions: unknown) => executeBlockchainsViewCommand(rawOptions, appRuntime));
}

async function executeBlockchainsViewCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliCommandBoundary({
    command: 'blockchains-view',
    format,
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, BlockchainsViewCommandOptionsSchema);
        const data = yield* toCliResult(loadBlockchainCatalogData(options, appRuntime), ExitCodes.INVALID_ARGS);

        if (format === 'json') {
          return buildBlockchainsViewJsonCompletion(options, data);
        }

        return yield* await buildBlockchainsViewTuiCompletion(options, data);
      }),
  });
}

function loadBlockchainCatalogData(
  options: BlockchainsViewCommandOptions,
  appRuntime: CliAppRuntime
): Result<BlockchainsViewData, Error> {
  let validatedCategory: BlockchainCategory | undefined;
  if (options.category) {
    const categoryResult = validateCategory(options.category);
    if (categoryResult.isErr()) {
      return err(categoryResult.error);
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

  return ok({
    allProviders,
    blockchains,
    validatedCategory,
  });
}

function buildBlockchainsViewJsonCompletion(
  options: BlockchainsViewCommandOptions,
  data: BlockchainsViewData
): CliCompletion {
  const categoryCounts: Record<string, number> = {};
  for (const blockchain of data.blockchains) {
    categoryCounts[blockchain.category] = (categoryCounts[blockchain.category] || 0) + 1;
  }

  return jsonSuccess({
    data: {
      blockchains: data.blockchains.map((blockchain) => ({
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
      total: data.blockchains.length,
      byCategory: categoryCounts,
      totalProviders: data.allProviders.length,
      filters: buildDefinedFilters({
        category: data.validatedCategory,
        requiresApiKey: options.requiresApiKey ? true : undefined,
      }),
    },
  });
}

async function buildBlockchainsViewTuiCompletion(
  options: BlockchainsViewCommandOptions,
  data: BlockchainsViewData
): Promise<Result<CliCompletion, CliFailure>> {
  const viewItems = data.blockchains.map((blockchain) => toBlockchainViewItem(blockchain));
  const categoryCounts = computeCategoryCounts(viewItems);
  const initialState = createBlockchainsViewState(
    viewItems,
    {
      categoryFilter: data.validatedCategory,
      requiresApiKeyFilter: options.requiresApiKey,
    },
    data.allProviders.length,
    categoryCounts
  );

  try {
    await renderApp((unmount) =>
      React.createElement(BlockchainsViewApp, {
        initialState,
        onQuit: unmount,
      })
    );
  } catch (error) {
    return err(createCliFailure(error, ExitCodes.GENERAL_ERROR));
  }

  return ok(silentSuccess());
}
