import { getLogger } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { ListBlockchainsCommandOptionsSchema } from '../shared/schemas.js';

import { ListBlockchainsHandler } from './list-blockchains-handler.js';
import type { BlockchainInfo, BlockchainListSummary } from './list-blockchains-utils.js';

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
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (rawOptions: unknown) => {
      await executeListBlockchainsCommand(rawOptions);
    });
}

/**
 * Execute the list-blockchains command.
 */
async function executeListBlockchainsCommand(rawOptions: unknown): Promise<void> {
  // Validate options at CLI boundary
  const parseResult = ListBlockchainsCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager('text');
    output.error(
      'list-blockchains',
      new Error(parseResult.error.issues[0]?.message || 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Create handler and execute
    const handler = new ListBlockchainsHandler();

    const result = await handler.execute(options);

    if (result.isErr()) {
      handler.destroy();
      output.error('list-blockchains', result.error, ExitCodes.INVALID_ARGS);
      return;
    }

    const { blockchains, summary } = result.value;

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
    output.success('list-blockchains', resultData);

    handler.destroy();
    process.exit(0);
  } catch (error) {
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

      // Show which providers need API keys
      const needsApiKey = blockchain.providers.filter((p) => p.requiresApiKey);
      if (needsApiKey.length > 0) {
        logger.info(`   ⚠️  Requires API keys: ${needsApiKey.map((p) => p.name).join(', ')}`);
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
  logger.info('Usage examples:');
  logger.info('  pnpm run dev import --blockchain bitcoin --address bc1q...');
  logger.info('  pnpm run dev import --blockchain ethereum --address 0x742d35Cc...');
  logger.info('');
  logger.info('For detailed provider information, run:');
  logger.info('  pnpm blockchain-providers:list');
}
