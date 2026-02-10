// Command registration for view providers subcommand

import path from 'node:path';

import {
  closeProviderStatsDatabase,
  createProviderStatsDatabase,
  initializeProviderStatsDatabase,
  loadExplorerConfig,
  ProviderRegistry,
  ProviderStatsRepository,
  type ProviderStatsRow,
} from '@exitbook/blockchain-providers';
import { getAllBlockchains } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { renderApp } from '../shared/command-runtime.js';
import { getDataDir } from '../shared/data-dir.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { ProvidersViewCommandOptionsSchema } from '../shared/schemas.js';

import { ProvidersViewApp, computeHealthCounts, createProvidersViewState } from './components/index.js';
import type { ProviderViewItem } from './components/index.js';
import {
  buildProviderMap,
  filterProviders,
  mergeProviderData,
  sortProviders,
  validateHealthFilter,
  type HealthFilter,
} from './view-providers-utils.js';

const logger = getLogger('providers-view');

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof ProvidersViewCommandOptionsSchema>;

/**
 * Register the providers view subcommand.
 */
export function registerProvidersViewCommand(providersCommand: Command): void {
  providersCommand
    .command('view')
    .description('View blockchain API providers, their health, and configuration')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook providers view                        # View all providers
  $ exitbook providers view --blockchain ethereum   # Providers serving Ethereum
  $ exitbook providers view --health degraded       # Degraded providers only
  $ exitbook providers view --missing-api-key       # Providers with missing API keys
  $ exitbook providers view --json                  # Output JSON

Common Usage:
  - Check provider health and performance across blockchains
  - Identify missing API key configuration
  - Review per-provider error rates and response times
`
    )
    .option('--blockchain <name>', 'Filter by blockchain (providers serving this chain)')
    .option('--health <status>', 'Filter by health (healthy, degraded, unhealthy)')
    .option('--missing-api-key', 'Show only providers with missing API keys')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeProvidersViewCommand(rawOptions);
    });
}

/**
 * Execute the providers view command.
 */
async function executeProvidersViewCommand(rawOptions: unknown): Promise<void> {
  // Validate options at CLI boundary
  const parseResult = ProvidersViewCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'providers-view',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      'text'
    );
  }

  const options = parseResult.data;
  const isJsonMode = options.json ?? false;

  // Validate health filter if provided
  let validatedHealth: HealthFilter | undefined;
  if (options.health) {
    const healthResult = validateHealthFilter(options.health);
    if (healthResult.isErr()) {
      displayCliError('providers-view', healthResult.error, ExitCodes.INVALID_ARGS, isJsonMode ? 'json' : 'text');
    }
    validatedHealth = healthResult.value;
  }

  if (isJsonMode) {
    await executeProvidersViewJSON(options, validatedHealth);
  } else {
    await executeProvidersViewTUI(options, validatedHealth);
  }
}

/**
 * Load provider data from registry + stats DB.
 * Returns sorted and filtered ProviderViewItem[].
 */
async function loadProviderData(
  options: CommandOptions,
  validatedHealth: HealthFilter | undefined
): Promise<ProviderViewItem[]> {
  // Get all blockchains and build provider map
  const allBlockchains = getAllBlockchains();
  const providerMap = buildProviderMap(allBlockchains, (blockchain) => ProviderRegistry.getAvailable(blockchain));

  // Load explorer config (graceful if missing)
  const explorerConfig = loadExplorerConfig();

  // Load stats from providers.db (graceful degradation)
  let allStatsRows: ProviderStatsRow[] = [];
  const dataDir = getDataDir();
  const dbResult = createProviderStatsDatabase(path.join(dataDir, 'providers.db'));

  if (dbResult.isOk()) {
    const db = dbResult.value;
    const migrationResult = await initializeProviderStatsDatabase(db);

    if (migrationResult.isOk()) {
      const repo = new ProviderStatsRepository(db);
      const statsResult = await repo.getAll();
      if (statsResult.isOk()) {
        allStatsRows = statsResult.value;
      } else {
        logger.warn(`Failed to load provider stats: ${statsResult.error.message}`);
      }
    } else {
      logger.warn(`Provider stats migration failed: ${migrationResult.error.message}. Showing without stats.`);
    }

    const closeResult = await closeProviderStatsDatabase(db);
    if (closeResult.isErr()) {
      logger.warn(`Failed to close provider stats database: ${closeResult.error.message}`);
    }
  } else {
    logger.warn(`Failed to open provider stats database: ${dbResult.error.message}. Showing without stats.`);
  }

  // Merge all data
  let items = mergeProviderData(providerMap, allStatsRows, explorerConfig);

  // Apply filters
  items = filterProviders(items, {
    blockchain: options.blockchain,
    health: validatedHealth,
    missingApiKey: options.missingApiKey,
  });

  // Sort
  items = sortProviders(items);

  return items;
}

/**
 * Execute providers view in TUI mode
 */
async function executeProvidersViewTUI(
  options: CommandOptions,
  validatedHealth: HealthFilter | undefined
): Promise<void> {
  try {
    const viewItems = await loadProviderData(options, validatedHealth);

    const healthCounts = computeHealthCounts(viewItems);

    const initialState = createProvidersViewState(
      viewItems,
      {
        blockchainFilter: options.blockchain,
        healthFilter: validatedHealth,
        missingApiKeyFilter: options.missingApiKey,
      },
      healthCounts
    );

    await renderApp((unmount) =>
      React.createElement(ProvidersViewApp, {
        initialState,
        onQuit: unmount,
      })
    );
  } catch (error) {
    displayCliError(
      'providers-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

/**
 * Execute providers view in JSON mode
 */
async function executeProvidersViewJSON(
  options: CommandOptions,
  validatedHealth: HealthFilter | undefined
): Promise<void> {
  try {
    const viewItems = await loadProviderData(options, validatedHealth);
    const healthCounts = computeHealthCounts(viewItems);

    // Build filters record
    const filters: Record<string, unknown> = {
      ...(options.blockchain && { blockchain: options.blockchain }),
      ...(validatedHealth && { health: validatedHealth }),
      ...(options.missingApiKey && { missingApiKey: true }),
    };

    // Build JSON-friendly provider data
    const jsonProviders = viewItems.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      requiresApiKey: p.requiresApiKey,
      apiKeyEnvVar: p.apiKeyEnvVar,
      apiKeyConfigured: p.apiKeyConfigured,
      blockchains: p.blockchains.map((b) => ({
        name: b.name,
        capabilities: b.capabilities,
        rateLimit: b.rateLimit,
        configSource: b.configSource,
      })),
      chainCount: p.chainCount,
      stats: p.stats
        ? {
            totalRequests: p.stats.totalRequests,
            avgResponseTime: p.stats.avgResponseTime,
            errorRate: p.stats.errorRate,
            lastChecked: p.stats.lastChecked,
            perBlockchain: Object.fromEntries(
              p.blockchains
                .filter((b) => b.stats)
                .map((b) => [
                  b.name,
                  {
                    totalSuccesses: b.stats!.totalSuccesses,
                    totalFailures: b.stats!.totalFailures,
                    avgResponseTime: b.stats!.avgResponseTime,
                    errorRate: b.stats!.errorRate,
                  },
                ])
            ),
          }
        : undefined,
      healthStatus: p.healthStatus,
      lastError: p.lastError ?? undefined,
    }));

    const resultData = {
      data: {
        providers: jsonProviders,
      },
      meta: {
        total: viewItems.length,
        byHealth: healthCounts,
        requireApiKey: viewItems.filter((p) => p.requiresApiKey).length,
        filters,
      },
    };

    outputSuccess('providers-view', resultData);
  } catch (error) {
    displayCliError(
      'providers-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}
