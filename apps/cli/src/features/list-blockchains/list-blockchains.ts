import { ProviderRegistry } from '@exitbook/blockchain-providers';
import type { ProviderInfo } from '@exitbook/blockchain-providers';
import { getAllBlockchains } from '@exitbook/ingestion';
import { configureLogger, getLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { ListBlockchainsCommandOptionsSchema } from '../shared/schemas.js';

import type { BlockchainCategory, BlockchainInfo, BlockchainListSummary } from './list-blockchains-utils.js';
import {
  buildBlockchainInfo,
  buildSummary,
  filterByApiKeyRequirement,
  filterByCategory,
  sortBlockchains,
  validateCategory,
} from './list-blockchains-utils.js';

const logger = getLogger('ListBlockchainsCommand');

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof ListBlockchainsCommandOptionsSchema>;

/**
 * Result data for list-blockchains command (JSON mode).
 */
interface ListBlockchainsCommandResult {
  blockchains: BlockchainInfo[];
  summary: {
    byCategory: Record<string, number>;
    noApiKey: number;
    requireApiKey: number;
    totalBlockchains: number;
    totalProviders: number;
  };
}

/**
 * Register the list-blockchains command.
 */
export function registerListBlockchainsCommand(program: Command): void {
  program
    .command('list-blockchains')
    .description('List all available blockchains with provider information')
    .option('--category <type>', 'Filter by category (evm, substrate, cosmos, utxo, solana)')
    .option('--detailed', 'Show detailed provider information including rate limits')
    .option('--requires-api-key', 'Show only blockchains that require API key')
    .option('--json', 'Output results in JSON format')
    .action((rawOptions: unknown) => {
      executeListBlockchainsCommand(rawOptions);
    });
}

/**
 * Execute the list-blockchains command.
 */
function executeListBlockchainsCommand(rawOptions: unknown): void {
  // Check for --json flag early (even before validation) to determine output format
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  // Validate options at CLI boundary
  const parseResult = ListBlockchainsCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager(isJsonMode ? 'json' : 'text');
    output.error(
      'list-blockchains',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Configure logger for JSON mode
    if (options.json) {
      configureLogger({
        mode: 'json',
        verbose: false,
        sinks: { ui: false, structured: 'file' },
      });
    }

    // Validate and store category filter if provided
    let validatedCategory: BlockchainCategory | undefined = undefined;
    if (options.category) {
      const categoryResult = validateCategory(options.category);
      if (categoryResult.isErr()) {
        resetLoggerContext();
        output.error('list-blockchains', categoryResult.error, ExitCodes.INVALID_ARGS);
        return;
      }
      validatedCategory = categoryResult.value;
    }

    // Get supported blockchains from blockchain config registry
    const supportedBlockchains = getAllBlockchains();

    // Get all providers from ProviderRegistry (for summary stats)
    const allProviders: ProviderInfo[] = ProviderRegistry.getAllProviders();

    // Build blockchain info for each supported blockchain
    let blockchains: BlockchainInfo[] = supportedBlockchains.map((blockchain: string) => {
      const providers = ProviderRegistry.getAvailable(blockchain);
      return buildBlockchainInfo(blockchain, providers, options.detailed || false);
    });

    // Apply filters
    if (validatedCategory) {
      blockchains = filterByCategory(blockchains, validatedCategory);
    }

    if (options.requiresApiKey !== undefined) {
      blockchains = filterByApiKeyRequirement(blockchains, options.requiresApiKey);
    }

    // Sort blockchains
    blockchains = sortBlockchains(blockchains);

    // Build summary
    const summary = buildSummary(blockchains, allProviders);

    // Display in text mode
    if (output.isTextMode()) {
      displayTextOutput(blockchains, summary, options.detailed || false);
    }

    // Prepare result data for JSON mode
    const resultData: ListBlockchainsCommandResult = {
      blockchains,
      summary,
    };

    // Output success
    output.json('list-blockchains', resultData);

    resetLoggerContext();
  } catch (error) {
    resetLoggerContext();
    output.error(
      'list-blockchains',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR
    );
  }
}

/**
 * Display output in text mode.
 */
function displayTextOutput(blockchains: BlockchainInfo[], summary: BlockchainListSummary, detailed: boolean): void {
  logger.info('');
  logger.info('Available Blockchains:');
  logger.info('=============================');
  logger.info('');

  for (const blockchain of blockchains) {
    const categoryLabel = blockchain.layer
      ? `${blockchain.category.toUpperCase()} • Layer ${blockchain.layer}`
      : blockchain.category.toUpperCase();

    logger.info(`⛓️  ${blockchain.displayName} (${blockchain.name})`);
    logger.info(`   Category: ${categoryLabel}`);
    logger.info(`   Example address: ${blockchain.exampleAddress}`);

    if (blockchain.providers.length > 0) {
      const providerNames = blockchain.providers.map((p) => {
        const apiKeyFlag = p.requiresApiKey ? ' ⚠️' : ' ✓';
        if (detailed && p.rateLimit) {
          return `${p.name}${apiKeyFlag} (${p.rateLimit})`;
        }
        return `${p.name}${apiKeyFlag}`;
      });
      logger.info(`   Providers: ${providerNames.join(', ')}`);

      // Show provider operations in detailed mode
      if (detailed) {
        for (const provider of blockchain.providers) {
          logger.info(`     ${provider.name}: ${provider.capabilities.join(', ')}`);
        }
      }

      // Show which providers need API keys with health check
      const needsApiKey = blockchain.providers.filter((p) => p.requiresApiKey);
      if (needsApiKey.length > 0) {
        const apiKeyDetails = needsApiKey.map((p) => {
          if (p.apiKeyEnvVar) {
            const isConfigured = !!process.env[p.apiKeyEnvVar];
            const status = isConfigured ? '✓' : '✗';
            return `${p.name} (${p.apiKeyEnvVar} ${status})`;
          }
          return p.name;
        });
        logger.info(`   ⚠️  Requires API keys: ${apiKeyDetails.join(', ')}`);
      }
    } else {
      logger.info('   Providers: (none registered)');
    }

    logger.info('');
  }

  logger.info('=============================');
  logger.info(`Total blockchains: ${summary.totalBlockchains}`);
  logger.info(`Total providers: ${summary.totalProviders}`);
  logger.info('');
  logger.info('By category:');
  for (const [category, count] of Object.entries(summary.byCategory)) {
    logger.info(`  ${category.toUpperCase()}: ${count}`);
  }
  logger.info('');
  logger.info('API Key Requirements:');
  logger.info(`  ✓ No API key needed: ${summary.noApiKey} providers`);
  logger.info(`  ⚠️  API key required: ${summary.requireApiKey} providers`);
  logger.info('');

  // API key health check summary
  const missingKeys: string[] = [];
  const configuredKeys: string[] = [];

  for (const blockchain of blockchains) {
    for (const provider of blockchain.providers) {
      if (provider.requiresApiKey && provider.apiKeyEnvVar) {
        const isConfigured = !!process.env[provider.apiKeyEnvVar];
        if (isConfigured) {
          if (!configuredKeys.includes(provider.apiKeyEnvVar)) {
            configuredKeys.push(provider.apiKeyEnvVar);
          }
        } else {
          if (!missingKeys.includes(provider.apiKeyEnvVar)) {
            missingKeys.push(provider.apiKeyEnvVar);
          }
        }
      }
    }
  }

  if (missingKeys.length > 0 || configuredKeys.length > 0) {
    logger.info('API Key Health:');
    if (configuredKeys.length > 0) {
      logger.info(`  ✓ Configured: ${configuredKeys.join(', ')}`);
    }
    if (missingKeys.length > 0) {
      logger.info(`  ✗ Missing: ${missingKeys.join(', ')}`);
    }
    logger.info('');
  }

  logger.info('Usage examples:');
  logger.info('  pnpm run dev import --blockchain bitcoin --address bc1q...');
  logger.info('  pnpm run dev import --blockchain ethereum --address 0x742d35Cc...');
  logger.info('');
  logger.info('For detailed provider information, run:');
  logger.info('  pnpm blockchain-providers:list');
}
