// Unified providers command for viewing blockchain API provider configuration and health

import type { AdapterRegistry } from '@exitbook/ingestion';
import type { Command } from 'commander';

import { registerProvidersBenchmarkCommand } from './benchmark-providers.js';
import { registerProvidersViewCommand } from './view-providers.js';

/**
 * Register the unified providers command with all subcommands.
 *
 * Structure:
 *   providers view               - View providers with filters
 *   providers benchmark          - Benchmark rate limits
 */
export function registerProvidersCommand(program: Command, registry: AdapterRegistry): void {
  const providers = program.command('providers').description('View and manage blockchain API providers');

  registerProvidersViewCommand(providers, registry);
  registerProvidersBenchmarkCommand(providers);
}
