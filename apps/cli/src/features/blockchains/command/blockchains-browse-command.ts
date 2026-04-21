import { listBlockchainProviders } from '@exitbook/blockchain-providers';
import { err, ok, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import {
  executePreparedBrowseCommand,
  prepareBrowseCommand,
  runPreparedBrowseCommandBoundary,
  type PreparedBrowseCommand,
} from '../../../cli/browse-command-scaffold.js';
import { buildBrowseJsonOrStaticCompletion } from '../../../cli/browse-output.js';
import {
  createCliFailure,
  ExitCodes,
  textSuccess,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../cli/command.js';
import {
  buildCliOptionsHelpText,
  parseCliBrowseOptionsResult,
  registerCliOptionDefinitions,
  type CliOptionDefinition,
} from '../../../cli/options.js';
import { type BrowseSurfaceSpec } from '../../../cli/presentation.js';
import { buildDefinedFilters } from '../../../cli/view-utils.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp } from '../../../runtime/command-runtime.js';
import { toBlockchainViewItem } from '../blockchain-view-projection.js';
import type { BlockchainViewItem } from '../blockchains-view-model.js';
import { outputBlockchainStaticDetail, outputBlockchainsStaticList } from '../view/blockchains-static-renderer.js';
import { BlockchainsViewApp, computeCategoryCounts, createBlockchainsViewState } from '../view/index.js';

import type { BlockchainCategory } from './blockchains-catalog-utils.js';
import {
  buildBlockchainCatalogItem,
  filterByApiKeyRequirement,
  filterByCategory,
  sortBlockchains,
  validateCategory,
} from './blockchains-catalog-utils.js';
import { BlockchainsBrowseCommandOptionsSchema } from './blockchains-option-schemas.js';

interface ExecuteBlockchainsBrowseCommandInput {
  appRuntime: CliAppRuntime;
  blockchainSelector?: string | undefined;
  commandId: string;
  rawOptions: unknown;
  surfaceSpec: BrowseSurfaceSpec;
}

export type PreparedBlockchainsBrowseCommand = PreparedBrowseCommand<BlockchainsBrowseParams>;

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

const BLOCKCHAINS_BROWSE_OPTION_DEFINITIONS: CliOptionDefinition[] = [
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
  return registerCliOptionDefinitions(command, BLOCKCHAINS_BROWSE_OPTION_DEFINITIONS);
}

export function buildBlockchainsBrowseOptionsHelpText(): string {
  return buildCliOptionsHelpText(BLOCKCHAINS_BROWSE_OPTION_DEFINITIONS);
}

export function prepareBlockchainsBrowseCommand({
  blockchainSelector,
  rawOptions,
  surfaceSpec,
}: ExecuteBlockchainsBrowseCommandInput): Result<PreparedBlockchainsBrowseCommand, CliFailure> {
  const parsedOptionsResult = parseCliBrowseOptionsResult(
    rawOptions,
    BlockchainsBrowseCommandOptionsSchema,
    surfaceSpec
  );
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

  return ok(
    prepareBrowseCommand(
      {
        blockchainSelector,
        category: options.category,
        requiresApiKey: options.requiresApiKey,
        preselectInExplorer: blockchainSelector !== undefined && presentation.mode === 'tui' ? true : undefined,
      },
      presentation
    )
  );
}

export async function executePreparedBlockchainsBrowseCommand(
  prepared: PreparedBlockchainsBrowseCommand,
  appRuntime: CliAppRuntime
): Promise<CliCommandResult> {
  return executePreparedBrowseCommand({
    prepared,
    loadBrowsePresentation: (params) => buildBlockchainsBrowsePresentation(appRuntime, params),
    resolveNavigability: (params, browsePresentation) => ({
      hasNavigableItems: browsePresentation.initialState.blockchains.length > 0,
      shouldCollapseEmptyExplorer: shouldCollapseBlockchainsExplorerWhenEmpty(params),
    }),
    buildCompletion: ({ browsePresentation, finalPresentation }) =>
      buildBlockchainsBrowseCompletion(browsePresentation, finalPresentation.staticKind, finalPresentation.mode),
  });
}

export async function runBlockchainsBrowseCommand(input: ExecuteBlockchainsBrowseCommandInput): Promise<void> {
  await runPreparedBrowseCommandBoundary({
    command: input.commandId,
    rawOptions: input.rawOptions,
    prepare: () => prepareBlockchainsBrowseCommand(input),
    action: async (prepared) => executePreparedBlockchainsBrowseCommand(prepared, input.appRuntime),
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
  if (mode === 'tui') {
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

  return buildBrowseJsonOrStaticCompletion({
    createMissingDetailJsonError: () =>
      createCliFailure(new Error('Expected a blockchain detail result'), ExitCodes.GENERAL_ERROR),
    createMissingSelectedItemError: () =>
      createCliFailure(new Error('Expected a selected blockchain'), ExitCodes.GENERAL_ERROR),
    detailJsonResult: browsePresentation.detailJsonResult,
    listJsonResult: browsePresentation.listJsonResult,
    metadata: {
      byCategory: browsePresentation.initialState.categoryCounts,
      filters: buildDefinedFilters({
        category: browsePresentation.initialState.categoryFilter,
        requiresApiKey: browsePresentation.initialState.requiresApiKeyFilter ? true : undefined,
      }),
      total: browsePresentation.initialState.totalCount,
      totalProviders: browsePresentation.initialState.totalProviders,
    },
    mode,
    renderStaticDetail: (selectedBlockchain) => {
      outputBlockchainStaticDetail(selectedBlockchain);
    },
    renderStaticList: () => {
      outputBlockchainsStaticList(browsePresentation.initialState);
    },
    selectedItem: browsePresentation.selectedBlockchain,
    staticKind,
  });
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
