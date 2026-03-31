import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import {
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliCommandBoundary,
  silentSuccess,
  toCliResult,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult, type CliOutputFormat } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp } from '../../../runtime/command-runtime.js';
import { buildDefinedFilters } from '../../shared/view-utils.js';
import { ProvidersViewApp, computeHealthCounts, createProvidersViewState } from '../view/index.js';

import { ProvidersViewCommandOptionsSchema } from './providers-option-schemas.js';
import { ProvidersViewHandler } from './providers-view-handler.js';

type ProvidersViewCommandOptions = z.infer<typeof ProvidersViewCommandOptionsSchema>;

interface ProvidersViewData {
  healthCounts: ReturnType<typeof computeHealthCounts>;
  viewItems: Awaited<ReturnType<ProvidersViewHandler['execute']>>;
}

interface ProvidersViewCommandResult {
  data: {
    providers: ReturnType<typeof serializeProvidersViewItem>[];
  };
  meta: {
    byHealth: ProvidersViewData['healthCounts'];
    filters?: Record<string, unknown> | undefined;
    requireApiKey: number;
    total: number;
  };
}

export function registerProvidersViewCommand(providersCommand: Command, appRuntime: CliAppRuntime): void {
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
    .action((rawOptions: unknown) => executeProvidersViewCommand(rawOptions, appRuntime));
}

async function executeProvidersViewCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliCommandBoundary({
    command: 'providers-view',
    format,
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, ProvidersViewCommandOptionsSchema);
        return yield* await executeProvidersViewCommandResult(options, format, appRuntime);
      }),
  });
}

async function executeProvidersViewCommandResult(
  options: ProvidersViewCommandOptions,
  format: CliOutputFormat,
  appRuntime: CliAppRuntime
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const data = yield* toCliResult(await fetchProviderViewData(options, appRuntime), ExitCodes.GENERAL_ERROR);

    if (format === 'json') {
      return buildProvidersViewJsonCompletion(options, data);
    }

    return yield* await buildProvidersViewTuiCompletion(options, data);
  });
}

async function fetchProviderViewData(
  options: ProvidersViewCommandOptions,
  appRuntime: CliAppRuntime
): Promise<Result<ProvidersViewData, Error>> {
  try {
    const handler = new ProvidersViewHandler(appRuntime.dataDir, appRuntime.blockchainExplorersConfig);
    const viewItems = await handler.execute({
      blockchain: options.blockchain,
      health: options.health,
      missingApiKey: options.missingApiKey,
    });

    return ok({
      viewItems,
      healthCounts: computeHealthCounts(viewItems),
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

function buildProvidersViewJsonCompletion(
  options: ProvidersViewCommandOptions,
  data: ProvidersViewData
): CliCompletion {
  const resultData: ProvidersViewCommandResult = {
    data: {
      providers: data.viewItems.map(serializeProvidersViewItem),
    },
    meta: {
      total: data.viewItems.length,
      byHealth: data.healthCounts,
      requireApiKey: data.viewItems.filter((provider) => provider.requiresApiKey).length,
      filters: buildDefinedFilters({
        blockchain: options.blockchain,
        health: options.health,
        missingApiKey: options.missingApiKey ? true : undefined,
      }),
    },
  };

  return jsonSuccess(resultData);
}

async function buildProvidersViewTuiCompletion(
  options: ProvidersViewCommandOptions,
  data: ProvidersViewData
): Promise<Result<CliCompletion, CliFailure>> {
  const initialState = createProvidersViewState(
    data.viewItems,
    {
      blockchainFilter: options.blockchain,
      healthFilter: options.health,
      missingApiKeyFilter: options.missingApiKey,
    },
    data.healthCounts
  );

  try {
    await renderApp((unmount) =>
      React.createElement(ProvidersViewApp, {
        initialState,
        onQuit: unmount,
      })
    );
  } catch (error) {
    return err(createCliFailure(error, ExitCodes.GENERAL_ERROR));
  }

  return ok(silentSuccess());
}

function serializeProvidersViewItem(provider: ProvidersViewData['viewItems'][number]) {
  return {
    name: provider.name,
    displayName: provider.displayName,
    requiresApiKey: provider.requiresApiKey,
    apiKeyConfigured: provider.apiKeyConfigured,
    blockchains: provider.blockchains.map((blockchain) => ({
      name: blockchain.name,
      capabilities: blockchain.capabilities,
      rateLimit: blockchain.rateLimit,
      configSource: blockchain.configSource,
    })),
    chainCount: provider.chainCount,
    stats: provider.stats
      ? {
          totalRequests: provider.stats.totalRequests,
          avgResponseTime: provider.stats.avgResponseTime,
          errorRate: provider.stats.errorRate,
          lastChecked: provider.stats.lastChecked,
          perBlockchain: Object.fromEntries(
            provider.blockchains
              .filter((blockchain) => blockchain.stats)
              .map((blockchain) => [
                blockchain.name,
                {
                  totalSuccesses: blockchain.stats!.totalSuccesses,
                  totalFailures: blockchain.stats!.totalFailures,
                  avgResponseTime: blockchain.stats!.avgResponseTime,
                  errorRate: blockchain.stats!.errorRate,
                },
              ])
          ),
        }
      : undefined,
    healthStatus: provider.healthStatus,
    lastError: provider.lastError ?? undefined,
  };
}
