// Imperative shell for list-blockchains command
// Manages resources and orchestrates business logic

import { getAllBlockchains } from '@exitbook/ingestion';
import type { ProviderInfo } from '@exitbook/providers';
import { ProviderRegistry } from '@exitbook/providers';
import type { Result } from 'neverthrow';
import { err, okAsync } from 'neverthrow';

import type {
  BlockchainCategory,
  BlockchainInfo,
  BlockchainListSummary,
  ListBlockchainsCommandOptions,
} from './list-blockchains-utils.ts';
import {
  buildBlockchainInfo,
  buildSummary,
  filterByApiKeyRequirement,
  filterByCategory,
  sortBlockchains,
  validateCategory,
} from './list-blockchains-utils.ts';

/**
 * Result data for list-blockchains command.
 */
export interface ListBlockchainsResult {
  blockchains: BlockchainInfo[];
  summary: BlockchainListSummary;
}

/**
 * Handler for list-blockchains command.
 * Manages resource fetching and orchestrates pure business logic.
 */
export class ListBlockchainsHandler {
  /**
   * Execute list-blockchains command.
   */
  async execute(options: ListBlockchainsCommandOptions): Promise<Result<ListBlockchainsResult, Error>> {
    // Validate and store category filter if provided
    let validatedCategory: BlockchainCategory | undefined = undefined;
    if (options.category) {
      const categoryResult = validateCategory(options.category);
      if (categoryResult.isErr()) {
        return err(categoryResult.error);
      }
      validatedCategory = categoryResult.value;
    }

    // Get supported blockchains from blockchain config registry
    const supportedBlockchains = getAllBlockchains();

    // Get all providers from ProviderRegistry (for summary stats)
    const allProviders: ProviderInfo[] = ProviderRegistry.getAllProviders();

    // Build blockchain info for each supported blockchain
    // Use getAvailable() instead of grouping to properly handle multi-chain providers
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

    return okAsync({
      blockchains,
      summary,
    });
  }

  /**
   * Cleanup resources (if any).
   */
  destroy(): void {
    // No resources to clean up for this handler
  }
}
