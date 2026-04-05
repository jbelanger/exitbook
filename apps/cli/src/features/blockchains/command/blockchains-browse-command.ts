import { listBlockchainProviders } from '@exitbook/blockchain-providers';
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
import { toBlockchainViewItem } from '../blockchain-view-projection.js';
import type { BlockchainViewItem } from '../blockchains-view-model.js';
import { outputBlockchainStaticDetail, outputBlockchainsStaticList } from '../view/blockchains-static-renderer.js';
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

interface ExecuteBlockchainsBrowseCommandInput {
  appRuntime: CliAppRuntime;
  blockchainSelector?: string | undefined;
  commandId: string;
  rawOptions: unknown;
  surfaceSpec: BrowseSurfaceSpec;
}

export interface PreparedBlockchainsBrowseCommand {
  params: BlockchainsBrowseParams;
  presentation: ResolvedBrowsePresentation;
}

interface BlockchainsBrowseParams {
  blockchainSelector?: string | undefined;
  category?: string | undefined;
  requiresApiKey?: boolean | undefined;
  preselectInExplorer?: boolean | undefined;
}

interface BlockchainsBrowsePresentation {
  detailJsonResult?: Record<string, unknown> | undefined;
  initialState: ReturnType<typeof createBlockchainsViewState>;
  listJsonResult: {
    blockchains: ReturnType<typeof serializeBlockchainListItem>[];
  };
  selectedBlockchain?: BlockchainViewItem | undefined;
}

interface BlockchainsBrowseOptionDefinition {
  description: string;
  flags: string;
}

const BLOCKCHAINS_BROWSE_OPTION_DEFINITIONS: BlockchainsBrowseOptionDefinition[] = [
  {
    flags: '--category <name>',
    description: 'Filter by blockchain category (evm, substrate, cosmos, utxo, solana, other)',
  },
  {
    flags: '--requires-api-key',
    description: 'Show only blockchains whose provider set requires API-key configuration',
  },
  {
    flags: '--json',
    description: 'Output JSON format',
  },
];

export function registerBlockchainsBrowseOptions(command: Command): Command {
  for (const option of BLOCKCHAINS_BROWSE_OPTION_DEFINITIONS) {
    command.option(option.flags, option.description);
  }

  return command;
}

export function buildBlockchainsBrowseOptionsHelpText(): string {
  const flagsColumnWidth =
    BLOCKCHAINS_BROWSE_OPTION_DEFINITIONS.reduce((maxWidth, option) => Math.max(maxWidth, option.flags.length), 0) + 2;

  return BLOCKCHAINS_BROWSE_OPTION_DEFINITIONS.map((option) => {
    return `  ${option.flags.padEnd(flagsColumnWidth)}${option.description}`;
  }).join('\n');
}

export function prepareBlockchainsBrowseCommand({
  blockchainSelector,
  rawOptions,
  surfaceSpec,
}: ExecuteBlockchainsBrowseCommandInput): Result<PreparedBlockchainsBrowseCommand, CliFailure> {
  const parsedOptionsResult = parseCliBrowseOptionsResult(rawOptions, BlockchainsViewCommandOptionsSchema, surfaceSpec);
  if (parsedOptionsResult.isErr()) {
    return err(parsedOptionsResult.error);
  }

  const { options, presentation } = parsedOptionsResult.value;
  if (blockchainSelector && (options.category || options.requiresApiKey)) {
    return err(
      createCliFailure(
        new Error('Blockchain selector cannot be combined with --category or --requires-api-key'),
        ExitCodes.INVALID_ARGS
      )
    );
  }

  return ok({
    params: {
      blockchainSelector,
      category: options.category,
      requiresApiKey: options.requiresApiKey,
      preselectInExplorer: blockchainSelector !== undefined && presentation.mode === 'tui' ? true : undefined,
    },
    presentation,
  });
}

export async function executePreparedBlockchainsBrowseCommand(
  prepared: PreparedBlockchainsBrowseCommand,
  appRuntime: CliAppRuntime
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const browsePresentation = yield* buildBlockchainsBrowsePresentation(appRuntime, prepared.params);
    const finalPresentation = collapseEmptyExplorerToStatic(prepared.presentation, {
      hasNavigableItems: browsePresentation.initialState.blockchains.length > 0,
      shouldCollapseEmptyExplorer: shouldCollapseBlockchainsExplorerWhenEmpty(prepared.params),
    });

    return yield* buildBlockchainsBrowseCompletion(
      browsePresentation,
      finalPresentation.staticKind,
      finalPresentation.mode
    );
  });
}

export async function runBlockchainsBrowseCommand(input: ExecuteBlockchainsBrowseCommandInput): Promise<void> {
  await runCliCommandBoundary({
    command: input.commandId,
    format: detectCliOutputFormat(input.rawOptions),
    action: async () =>
      resultDoAsync(async function* () {
        const prepared = yield* prepareBlockchainsBrowseCommand(input);
        return yield* await executePreparedBlockchainsBrowseCommand(prepared, input.appRuntime);
      }),
  });
}

function buildBlockchainsBrowsePresentation(
  appRuntime: CliAppRuntime,
  params: BlockchainsBrowseParams
): Result<BlockchainsBrowsePresentation, CliFailure> {
  const validatedCategoryResult = validateOptionalCategory(params.category);
  if (validatedCategoryResult.isErr()) {
    return err(validatedCategoryResult.error);
  }

  const supportedBlockchains = appRuntime.adapterRegistry.getAllBlockchains();
  const allProviders = listBlockchainProviders();

  let catalogItems = supportedBlockchains.map((blockchain) => {
    const providers = allProviders.filter((provider) => provider.blockchain === blockchain);
    return buildBlockchainCatalogItem(blockchain, providers);
  });

  if (validatedCategoryResult.value) {
    catalogItems = filterByCategory(catalogItems, validatedCategoryResult.value);
  }

  if (params.requiresApiKey !== undefined) {
    catalogItems = filterByApiKeyRequirement(catalogItems, params.requiresApiKey);
  }

  const sortedItems = sortBlockchains(catalogItems);
  const viewItems = sortedItems.map((blockchain) => toBlockchainViewItem(blockchain));
  const selectedIndex = resolveBlockchainSelectorIndex(viewItems, params.blockchainSelector);
  if (selectedIndex.isErr()) {
    return err(selectedIndex.error);
  }

  const totalProviders = sortedItems.reduce((sum, blockchain) => sum + blockchain.providerCount, 0);
  const categoryCounts = computeCategoryCounts(viewItems);
  const initialState = createBlockchainsViewState(
    viewItems,
    {
      categoryFilter: validatedCategoryResult.value,
      requiresApiKeyFilter: params.requiresApiKey,
    },
    totalProviders,
    categoryCounts,
    params.preselectInExplorer ? selectedIndex.value : undefined
  );
  const selectedBlockchain = selectedIndex.value >= 0 ? viewItems[selectedIndex.value] : undefined;

  return ok({
    initialState,
    selectedBlockchain,
    listJsonResult: {
      blockchains: viewItems.map(serializeBlockchainListItem),
    },
    detailJsonResult: selectedBlockchain ? serializeBlockchainDetailItem(selectedBlockchain) : undefined,
  });
}

function validateOptionalCategory(category: string | undefined): Result<BlockchainCategory | undefined, CliFailure> {
  if (category === undefined) {
    return ok(undefined);
  }

  const validated = validateCategory(category);
  if (validated.isErr()) {
    return err(createCliFailure(validated.error, ExitCodes.INVALID_ARGS));
  }

  return ok(validated.value === 'all' ? undefined : validated.value);
}

function buildBlockchainsBrowseCompletion(
  browsePresentation: BlockchainsBrowsePresentation,
  staticKind: 'list' | 'detail',
  mode: 'json' | 'static' | 'tui'
): Result<CliCompletion, CliFailure> {
  switch (mode) {
    case 'json':
      if (staticKind === 'detail') {
        if (!browsePresentation.detailJsonResult) {
          return err(createCliFailure(new Error('Expected a blockchain detail result'), ExitCodes.GENERAL_ERROR));
        }
        return ok(jsonSuccess(browsePresentation.detailJsonResult));
      }

      return ok(
        jsonSuccess(browsePresentation.listJsonResult, {
          byCategory: browsePresentation.initialState.categoryCounts,
          filters: buildDefinedFilters({
            category: browsePresentation.initialState.categoryFilter,
            requiresApiKey: browsePresentation.initialState.requiresApiKeyFilter ? true : undefined,
          }),
          total: browsePresentation.initialState.totalCount,
          totalProviders: browsePresentation.initialState.totalProviders,
        })
      );
    case 'static':
      if (staticKind === 'detail') {
        if (!browsePresentation.selectedBlockchain) {
          return err(createCliFailure(new Error('Expected a selected blockchain'), ExitCodes.GENERAL_ERROR));
        }

        return ok(
          textSuccess(() => {
            outputBlockchainStaticDetail(browsePresentation.selectedBlockchain!);
          })
        );
      }

      return ok(
        textSuccess(() => {
          outputBlockchainsStaticList(browsePresentation.initialState);
        })
      );
    case 'tui':
      return ok(
        textSuccess(async () =>
          renderApp((unmount) =>
            React.createElement(BlockchainsViewApp, {
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

function shouldCollapseBlockchainsExplorerWhenEmpty(params: BlockchainsBrowseParams): boolean {
  return (
    params.blockchainSelector === undefined && params.category === undefined && params.requiresApiKey === undefined
  );
}

function serializeBlockchainListItem(item: BlockchainViewItem) {
  return {
    name: item.name,
    displayName: item.displayName,
    category: item.category,
    layer: item.layer,
    providerCount: item.providerCount,
    keyStatus: item.keyStatus,
    missingKeyCount: item.missingKeyCount,
    exampleAddress: item.exampleAddress,
  };
}

function serializeBlockchainDetailItem(item: BlockchainViewItem) {
  return {
    ...serializeBlockchainListItem(item),
    providers: item.providers.map((provider) => ({
      name: provider.name,
      displayName: provider.displayName,
      requiresApiKey: provider.requiresApiKey,
      apiKeyEnvName: provider.apiKeyEnvName,
      apiKeyConfigured: provider.apiKeyConfigured,
      capabilities: provider.capabilities,
      rateLimit: provider.rateLimit,
    })),
  };
}

function resolveBlockchainSelectorIndex(
  items: BlockchainViewItem[],
  selector: string | undefined
): Result<number, CliFailure> {
  if (selector === undefined) {
    return ok(-1);
  }

  const normalizedSelector = selector.toLowerCase();
  const selectedIndex = items.findIndex((item) => item.name.toLowerCase() === normalizedSelector);

  if (selectedIndex < 0) {
    return err(createCliFailure(new Error(`Blockchain selector '${selector}' not found`), ExitCodes.NOT_FOUND));
  }

  return ok(selectedIndex);
}
