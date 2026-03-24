import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerProvidersBenchmarkCommand } from './providers-benchmark.js';
import { registerProvidersViewCommand } from './providers-view.js';

/**
 * Register the unified providers command with all subcommands.
 *
 * Structure:
 *   providers view               - View providers with filters
 *   providers benchmark          - Benchmark rate limits
 */
export function registerProvidersCommand(program: Command, appRuntime: CliAppRuntime): void {
  const providers = program.command('providers').description('View and manage blockchain API providers');

  registerProvidersViewCommand(providers, appRuntime);
  registerProvidersBenchmarkCommand(providers, appRuntime);
}
