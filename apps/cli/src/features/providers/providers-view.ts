// Command registration for providers view subcommand

import type { AdapterRegistry } from '@exitbook/ingestion';
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
import { ProvidersViewHandler } from './providers-view-handler.js';
import { validateHealthFilter, type HealthFilter } from './providers-view-utils.js';

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof ProvidersViewCommandOptionsSchema>;

/**
 * Register the providers view subcommand.
 */
export function registerProvidersViewCommand(providersCommand: Command, registry: AdapterRegistry): void {
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
      await executeProvidersViewCommand(rawOptions, registry);
    });
}

/**
 * Execute the providers view command.
 */
async function executeProvidersViewCommand(rawOptions: unknown, registry: AdapterRegistry): Promise<void> {
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
    await executeProvidersViewJSON(options, validatedHealth, registry);
  } else {
    await executeProvidersViewTUI(options, validatedHealth, registry);
  }
}

/**
 * Load provider view items and health counts from the registry.
 */
async function fetchProviderViewData(
  options: CommandOptions,
  validatedHealth: HealthFilter | undefined,
  registry: AdapterRegistry
) {
  const handler = new ProvidersViewHandler(registry, getDataDir());
  const viewItems = await handler.execute({
    blockchain: options.blockchain,
    health: validatedHealth,
    missingApiKey: options.missingApiKey,
  });
  const healthCounts = computeHealthCounts(viewItems);
  return { viewItems, healthCounts };
}

/**
 * Execute providers view in TUI mode
 */
async function executeProvidersViewTUI(
  options: CommandOptions,
  validatedHealth: HealthFilter | undefined,
  registry: AdapterRegistry
): Promise<void> {
  try {
    const { viewItems, healthCounts } = await fetchProviderViewData(options, validatedHealth, registry);

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
  validatedHealth: HealthFilter | undefined,
  registry: AdapterRegistry
): Promise<void> {
  try {
    const { viewItems, healthCounts } = await fetchProviderViewData(options, validatedHealth, registry);

    // Build filters record
    const filters: Record<string, unknown> = {};
    if (options.blockchain) filters['blockchain'] = options.blockchain;
    if (validatedHealth) filters['health'] = validatedHealth;
    if (options.missingApiKey) filters['missingApiKey'] = true;

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
