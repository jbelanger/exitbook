// Command registration for view blockchains subcommand

import { ProviderRegistry } from '@exitbook/blockchain-providers';
import type { ProviderInfo } from '@exitbook/blockchain-providers';
import { getAllBlockchains } from '@exitbook/ingestion';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { BlockchainsViewCommandOptionsSchema } from '../shared/schemas.js';

import { BlockchainsViewApp, computeCategoryCounts, createBlockchainsViewState } from './components/index.js';
import type { BlockchainCategory } from './view-blockchains-utils.js';
import {
  buildBlockchainInfo,
  filterByApiKeyRequirement,
  filterByCategory,
  sortBlockchains,
  toBlockchainViewItem,
  validateCategory,
} from './view-blockchains-utils.js';

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof BlockchainsViewCommandOptionsSchema>;

/**
 * Register the blockchains view subcommand.
 */
export function registerBlockchainsViewCommand(blockchainsCommand: Command): void {
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
    .action((rawOptions: unknown) => {
      executeBlockchainsViewCommand(rawOptions);
    });
}

/**
 * Execute the blockchains view command.
 */
function executeBlockchainsViewCommand(rawOptions: unknown): void {
  // Validate options at CLI boundary
  const parseResult = BlockchainsViewCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'blockchains-view',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      'text'
    );
  }

  const options = parseResult.data;
  const isJsonMode = options.json ?? false;

  // Configure logger
  configureLogger({
    mode: isJsonMode ? 'json' : 'text',
    verbose: false,
    sinks: isJsonMode ? { ui: false, structured: 'file' } : { ui: false, structured: 'file' },
  });

  if (isJsonMode) {
    executeBlockchainsViewJSON(options);
  } else {
    executeBlockchainsViewTUI(options);
  }
  resetLoggerContext();
}

/**
 * Load and prepare blockchain data with filters applied.
 */
function loadBlockchainData(options: CommandOptions): {
  allProviders: ProviderInfo[];
  blockchains: ReturnType<typeof buildBlockchainInfo>[];
  validatedCategory: BlockchainCategory | undefined;
} | null {
  // Validate category filter if provided
  let validatedCategory: BlockchainCategory | undefined;
  if (options.category) {
    const categoryResult = validateCategory(options.category);
    if (categoryResult.isErr()) {
      displayCliError('blockchains-view', categoryResult.error, ExitCodes.INVALID_ARGS, options.json ? 'json' : 'text');
    }
    validatedCategory = categoryResult.value;
  }

  // Get supported blockchains from registry
  const supportedBlockchains = getAllBlockchains();
  const allProviders = ProviderRegistry.getAllProviders();

  // Build blockchain info
  let blockchains = supportedBlockchains.map((blockchain: string) => {
    const providers = ProviderRegistry.getAvailable(blockchain);
    return buildBlockchainInfo(blockchain, providers);
  });

  // Apply filters
  if (validatedCategory) {
    blockchains = filterByCategory(blockchains, validatedCategory);
  }

  if (options.requiresApiKey !== undefined) {
    blockchains = filterByApiKeyRequirement(blockchains, options.requiresApiKey);
  }

  // Sort
  blockchains = sortBlockchains(blockchains);

  return { blockchains, allProviders, validatedCategory };
}

/**
 * Execute blockchains view in TUI mode
 */
function executeBlockchainsViewTUI(options: CommandOptions): void {
  let inkInstance: { unmount: () => void; waitUntilExit: () => Promise<void> } | undefined;

  try {
    const data = loadBlockchainData(options);
    if (!data) return;

    const { blockchains, allProviders, validatedCategory } = data;

    // Transform to view items (checks env vars for API key status)
    const viewItems = blockchains.map((b) => toBlockchainViewItem(b));

    // Compute counts
    const categoryCounts = computeCategoryCounts(viewItems);
    const totalProviders = allProviders.length;

    // Create initial state
    const initialState = createBlockchainsViewState(
      viewItems,
      {
        categoryFilter: validatedCategory,
        requiresApiKeyFilter: options.requiresApiKey,
      },
      totalProviders,
      categoryCounts
    );

    // Render TUI
    inkInstance = render(
      React.createElement(BlockchainsViewApp, {
        initialState,
        onQuit: () => {
          if (inkInstance) {
            inkInstance.unmount();
          }
        },
      })
    );
  } catch (error) {
    console.error('\n⚠ Error:', error instanceof Error ? error.message : String(error));
    if (inkInstance) {
      try {
        inkInstance.unmount();
      } catch {
        /* ignore unmount errors */
      }
    }
    process.exit(ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Execute blockchains view in JSON mode
 */
function executeBlockchainsViewJSON(options: CommandOptions): void {
  try {
    const data = loadBlockchainData(options);
    if (!data) return;

    const { blockchains, allProviders, validatedCategory } = data;

    // Build category counts from filtered set
    const categoryCounts: Record<string, number> = {};
    for (const b of blockchains) {
      categoryCounts[b.category] = (categoryCounts[b.category] || 0) + 1;
    }

    // Build filters record
    const filters: Record<string, unknown> = {
      ...(validatedCategory && { category: validatedCategory }),
      ...(options.requiresApiKey && { requiresApiKey: true }),
    };

    // Build JSON-friendly blockchain data
    const jsonBlockchains = blockchains.map((b) => ({
      name: b.name,
      displayName: b.displayName,
      category: b.category,
      layer: b.layer,
      providers: b.providers.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        requiresApiKey: p.requiresApiKey,
        capabilities: p.capabilities,
        rateLimit: p.rateLimit,
      })),
      providerCount: b.providerCount,
      exampleAddress: b.exampleAddress,
    }));

    const resultData = {
      data: {
        blockchains: jsonBlockchains,
      },
      meta: {
        total: blockchains.length,
        byCategory: categoryCounts,
        totalProviders: allProviders.length,
        filters,
      },
    };

    outputSuccess('blockchains-view', resultData);
  } catch (error) {
    displayCliError(
      'blockchains-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}
