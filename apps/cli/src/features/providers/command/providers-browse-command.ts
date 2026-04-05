import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import {
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliCommandBoundary,
  textSuccess,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliBrowseOptionsResult } from '../../../cli/options.js';
import {
  collapseEmptyExplorerToStatic,
  type BrowseSurfaceSpec,
  type ResolvedBrowsePresentation,
} from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp } from '../../../runtime/command-runtime.js';
import { buildDefinedFilters } from '../../shared/view-utils.js';
import type { ProviderViewItem } from '../providers-view-model.js';
import { ProvidersViewApp, computeHealthCounts, createProvidersViewState } from '../view/index.js';
import { outputProviderStaticDetail, outputProvidersStaticList } from '../view/providers-static-renderer.js';

import { ProvidersBrowseCommandOptionsSchema } from './providers-option-schemas.js';
import { ProvidersViewHandler } from './providers-view-handler.js';
import { validateHealthFilter, type HealthFilter } from './providers-view-utils.js';

interface ExecuteProvidersBrowseCommandInput {
  appRuntime: CliAppRuntime;
  commandId: string;
  providerSelector?: string | undefined;
  rawOptions: unknown;
  surfaceSpec: BrowseSurfaceSpec;
}

export interface PreparedProvidersBrowseCommand {
  params: ProvidersBrowseParams;
  presentation: ResolvedBrowsePresentation;
}

interface ProvidersBrowseParams {
  blockchain?: string | undefined;
  health?: string | undefined;
  missingApiKey?: boolean | undefined;
  preselectInExplorer?: boolean | undefined;
  providerSelector?: string | undefined;
}

interface ProvidersBrowsePresentation {
  detailJsonResult?: Record<string, unknown> | undefined;
  initialState: ReturnType<typeof createProvidersViewState>;
  listJsonResult: {
    providers: ReturnType<typeof serializeProviderListItem>[];
  };
  selectedProvider?: ProviderViewItem | undefined;
}

interface ProvidersBrowseOptionDefinition {
  description: string;
  flags: string;
}

const PROVIDERS_BROWSE_OPTION_DEFINITIONS: ProvidersBrowseOptionDefinition[] = [
  {
    flags: '--blockchain <name>',
    description: 'Filter by blockchain served by the provider',
  },
  {
    flags: '--health <status>',
    description: 'Filter by provider health (healthy, degraded, unhealthy)',
  },
  {
    flags: '--missing-api-key',
    description: 'Show only providers with missing API-key configuration',
  },
  {
    flags: '--json',
    description: 'Output JSON format',
  },
];

export function registerProvidersBrowseOptions(command: Command): Command {
  for (const option of PROVIDERS_BROWSE_OPTION_DEFINITIONS) {
    command.option(option.flags, option.description);
  }

  return command;
}

export function buildProvidersBrowseOptionsHelpText(): string {
  const flagsColumnWidth =
    PROVIDERS_BROWSE_OPTION_DEFINITIONS.reduce((maxWidth, option) => Math.max(maxWidth, option.flags.length), 0) + 2;

  return PROVIDERS_BROWSE_OPTION_DEFINITIONS.map((option) => {
    return `  ${option.flags.padEnd(flagsColumnWidth)}${option.description}`;
  }).join('\n');
}

export function prepareProvidersBrowseCommand({
  providerSelector,
  rawOptions,
  surfaceSpec,
}: ExecuteProvidersBrowseCommandInput): Result<PreparedProvidersBrowseCommand, CliFailure> {
  const parsedOptionsResult = parseCliBrowseOptionsResult(rawOptions, ProvidersBrowseCommandOptionsSchema, surfaceSpec);
  if (parsedOptionsResult.isErr()) {
    return err(parsedOptionsResult.error);
  }

  const { options, presentation } = parsedOptionsResult.value;

  if (providerSelector && (options.blockchain || options.health || options.missingApiKey)) {
    return err(
      createCliFailure(
        new Error('Provider selector cannot be combined with --blockchain, --health, or --missing-api-key'),
        ExitCodes.INVALID_ARGS
      )
    );
  }

  return ok({
    params: {
      providerSelector,
      blockchain: options.blockchain,
      health: options.health,
      missingApiKey: options.missingApiKey,
      preselectInExplorer: providerSelector !== undefined && presentation.mode === 'tui' ? true : undefined,
    },
    presentation,
  });
}

export async function executePreparedProvidersBrowseCommand(
  prepared: PreparedProvidersBrowseCommand,
  appRuntime: CliAppRuntime
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const browsePresentation = yield* await buildProvidersBrowsePresentation(appRuntime, prepared.params);
    const finalPresentation = collapseEmptyExplorerToStatic(prepared.presentation, {
      hasNavigableItems: browsePresentation.initialState.providers.length > 0,
      shouldCollapseEmptyExplorer: shouldCollapseProvidersExplorerWhenEmpty(prepared.params),
    });

    return yield* buildProvidersBrowseCompletion(
      browsePresentation,
      finalPresentation.staticKind,
      finalPresentation.mode
    );
  });
}

export async function runProvidersBrowseCommand(input: ExecuteProvidersBrowseCommandInput): Promise<void> {
  await runCliCommandBoundary({
    command: input.commandId,
    format: detectCliOutputFormat(input.rawOptions),
    action: async () =>
      resultDoAsync(async function* () {
        const prepared = yield* prepareProvidersBrowseCommand(input);
        return yield* await executePreparedProvidersBrowseCommand(prepared, input.appRuntime);
      }),
  });
}

async function buildProvidersBrowsePresentation(
  appRuntime: CliAppRuntime,
  params: ProvidersBrowseParams
): Promise<Result<ProvidersBrowsePresentation, CliFailure>> {
  const validatedHealthResult = validateOptionalHealth(params.health);
  if (validatedHealthResult.isErr()) {
    return err(validatedHealthResult.error);
  }

  try {
    const handler = new ProvidersViewHandler(appRuntime.dataDir, appRuntime.blockchainExplorersConfig);
    const viewItems = await handler.execute({
      blockchain: params.blockchain,
      health: validatedHealthResult.value,
      missingApiKey: params.missingApiKey,
    });

    const selectedIndex = resolveProviderSelectorIndex(viewItems, params.providerSelector);
    if (selectedIndex.isErr()) {
      return err(selectedIndex.error);
    }

    const healthCounts = computeHealthCounts(viewItems);
    const initialState = createProvidersViewState(
      viewItems,
      {
        blockchainFilter: params.blockchain,
        healthFilter: validatedHealthResult.value,
        missingApiKeyFilter: params.missingApiKey,
      },
      healthCounts,
      params.preselectInExplorer ? selectedIndex.value : undefined
    );
    const selectedProvider = selectedIndex.value >= 0 ? viewItems[selectedIndex.value] : undefined;

    return ok({
      initialState,
      selectedProvider,
      listJsonResult: {
        providers: viewItems.map(serializeProviderListItem),
      },
      detailJsonResult: selectedProvider ? serializeProviderDetailItem(selectedProvider) : undefined,
    });
  } catch (error) {
    return err(createCliFailure(error, ExitCodes.GENERAL_ERROR));
  }
}

function validateOptionalHealth(health: string | undefined): Result<HealthFilter | undefined, CliFailure> {
  if (health === undefined) {
    return ok(undefined);
  }

  const validated = validateHealthFilter(health);
  if (validated.isErr()) {
    return err(createCliFailure(validated.error, ExitCodes.INVALID_ARGS));
  }

  return ok(validated.value);
}

function buildProvidersBrowseCompletion(
  browsePresentation: ProvidersBrowsePresentation,
  staticKind: 'detail' | 'list',
  mode: 'json' | 'static' | 'tui'
): Result<CliCompletion, CliFailure> {
  switch (mode) {
    case 'json':
      if (staticKind === 'detail') {
        if (!browsePresentation.detailJsonResult) {
          return err(createCliFailure(new Error('Expected a provider detail result'), ExitCodes.GENERAL_ERROR));
        }

        return ok(jsonSuccess(browsePresentation.detailJsonResult));
      }

      return ok(
        jsonSuccess(browsePresentation.listJsonResult, {
          total: browsePresentation.initialState.totalCount,
          byHealth: browsePresentation.initialState.healthCounts,
          requireApiKey: browsePresentation.initialState.apiKeyRequiredCount,
          filters: buildDefinedFilters({
            blockchain: browsePresentation.initialState.blockchainFilter,
            health: browsePresentation.initialState.healthFilter,
            missingApiKey: browsePresentation.initialState.missingApiKeyFilter ? true : undefined,
          }),
        })
      );
    case 'static':
      if (staticKind === 'detail') {
        if (!browsePresentation.selectedProvider) {
          return err(createCliFailure(new Error('Expected a selected provider'), ExitCodes.GENERAL_ERROR));
        }

        return ok(
          textSuccess(() => {
            outputProviderStaticDetail(browsePresentation.selectedProvider!);
          })
        );
      }

      return ok(
        textSuccess(() => {
          outputProvidersStaticList(browsePresentation.initialState);
        })
      );
    case 'tui':
      return ok(
        textSuccess(async () =>
          renderApp((unmount) =>
            React.createElement(ProvidersViewApp, {
              initialState: browsePresentation.initialState,
              onQuit: unmount,
            })
          )
        )
      );
  }

  const exhaustiveCheck: never = mode;
  return exhaustiveCheck;
}

function shouldCollapseProvidersExplorerWhenEmpty(params: ProvidersBrowseParams): boolean {
  return (
    params.providerSelector === undefined &&
    params.blockchain === undefined &&
    params.health === undefined &&
    params.missingApiKey === undefined
  );
}

function resolveProviderSelectorIndex(
  items: ProviderViewItem[],
  selector: string | undefined
): Result<number, CliFailure> {
  if (selector === undefined) {
    return ok(-1);
  }

  const normalizedSelector = selector.toLowerCase();
  const selectedIndex = items.findIndex((item) => item.name.toLowerCase() === normalizedSelector);

  if (selectedIndex < 0) {
    return err(createCliFailure(new Error(`Provider selector '${selector}' not found`), ExitCodes.NOT_FOUND));
  }

  return ok(selectedIndex);
}

function serializeProviderListItem(provider: ProviderViewItem) {
  return {
    name: provider.name,
    displayName: provider.displayName,
    requiresApiKey: provider.requiresApiKey,
    apiKeyConfigured: provider.apiKeyConfigured,
    chainCount: provider.chainCount,
    healthStatus: provider.healthStatus,
    stats: provider.stats
      ? {
          totalRequests: provider.stats.totalRequests,
          avgResponseTime: provider.stats.avgResponseTime,
          errorRate: provider.stats.errorRate,
          lastChecked: provider.stats.lastChecked,
        }
      : undefined,
    rateLimit: provider.rateLimit,
    configSource: provider.configSource,
  };
}

function serializeProviderDetailItem(provider: ProviderViewItem) {
  return {
    ...serializeProviderListItem(provider),
    apiKeyEnvName: provider.apiKeyEnvName,
    blockchains: provider.blockchains.map((blockchain) => ({
      name: blockchain.name,
      capabilities: blockchain.capabilities,
      rateLimit: blockchain.rateLimit,
      configSource: blockchain.configSource,
      stats: blockchain.stats
        ? {
            totalSuccesses: blockchain.stats.totalSuccesses,
            totalFailures: blockchain.stats.totalFailures,
            avgResponseTime: blockchain.stats.avgResponseTime,
            errorRate: blockchain.stats.errorRate,
            isHealthy: blockchain.stats.isHealthy,
          }
        : undefined,
    })),
    lastError: provider.lastError,
    lastErrorTime: provider.lastErrorTime,
  };
}
