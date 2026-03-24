#!/usr/bin/env tsx
/**
 * Validate blockchain explorer configuration against registered providers
 * Enhanced with automatic fixes and detailed suggestions
 */

import path from 'node:path';

import { getErrorMessage } from '@exitbook/foundation';

import { loadExplorerConfig } from '../catalog/load-explorer-config.js';
import { createProviderRegistry } from '../initialize.js';

const registry = createProviderRegistry();

interface ConfigValidationOptions {
  fix?: boolean | undefined;
  verbose?: boolean | undefined;
}

function resolveExplorerConfigPath(): string {
  const configuredPath = process.env['BLOCKCHAIN_EXPLORERS_CONFIG'];
  if (configuredPath) {
    return path.resolve(process.cwd(), configuredPath);
  }

  return path.join(process.cwd(), 'config/blockchain-explorers.json');
}

function validateConfiguration(options: ConfigValidationOptions = {}): void {
  const { fix = false } = options;
  console.log('🔍 Validating Blockchain Configuration\n');

  try {
    // Load the configuration
    const config = loadExplorerConfig(resolveExplorerConfigPath());

    if (!config) {
      console.log('✅ No configuration file found - using registry-based auto-discovery!\n');
      console.log('📋 Available Providers from Registry');
      console.log('─'.repeat(40));

      const allProviders = registry.getAllProviders();
      const providersByBlockchain = new Map<string, typeof allProviders>();

      for (const provider of allProviders) {
        if (!providersByBlockchain.has(provider.blockchain)) {
          providersByBlockchain.set(provider.blockchain, []);
        }
        providersByBlockchain.get(provider.blockchain)!.push(provider);
      }

      for (const [blockchain, providers] of providersByBlockchain.entries()) {
        console.log(`${blockchain.toUpperCase()}:`);
        console.log(`  Available providers: ${providers.length}`);
        console.log(`  Providers: ${providers.map((p) => p.name).join(', ')}`);
        console.log('');
      }

      console.log('💡 All registered providers will be available automatically.');
      console.log('   Create a config file to customize provider priorities and settings.');

      if (fix) {
        console.log('\n🔧 Auto-fix not needed - using registry auto-discovery');
      }
      return;
    }

    // Validate against registry
    const validation = registry.validateConfig(config);

    if (validation.valid) {
      console.log('✅ Configuration is valid!\n');

      // Show configuration summary
      console.log('📋 Configuration Summary');
      console.log('─'.repeat(40));

      for (const [blockchain, blockchainConfig] of Object.entries(config)) {
        if (!blockchainConfig) continue;

        const defaultEnabled = blockchainConfig.defaultEnabled ?? [];
        const overrides = blockchainConfig.overrides ?? {};
        const allProviderNames = registry
          .getAllProviders()
          .filter((p) => p.blockchain === blockchain)
          .map((p) => p.name);

        console.log(`${blockchain.toUpperCase()}:`);
        console.log(`  Total providers: ${allProviderNames.length}`);
        console.log(
          `  Default enabled: ${defaultEnabled.length > 0 ? defaultEnabled.join(', ') : '(none — all available)'}`
        );

        if (Object.keys(overrides).length > 0) {
          console.log('  Overrides:');
          const sortedOverrides = Object.entries(overrides).sort(
            ([, a], [, b]) => (a.priority ?? 0) - (b.priority ?? 0)
          );
          for (const [providerName, override] of sortedOverrides) {
            const metadata = registry.getMetadata(blockchain, providerName);
            const apiKeyInfo = metadata?.requiresApiKey
              ? metadata.apiKeyEnvVar
                ? ` (${metadata.apiKeyEnvVar})`
                : ' (API key required)'
              : '';
            const enabledStr = override.enabled === false ? 'disabled' : 'enabled';
            console.log(`    ${override.priority ?? '?'}. ${providerName} [${enabledStr}]${apiKeyInfo}`);
          }
        }

        console.log('');
      }
    } else {
      console.log('❌ Configuration validation failed!\n');

      console.log('🚨 Errors found:');
      for (const [index, error] of validation.errors.entries()) {
        console.log(`  ${index + 1}. ${error}`);
      }

      console.log('\n💡 Suggestions:');
      console.log('  • Run `pnpm run providers:list` to see available providers');
      console.log('  • Run `pnpm run providers:sync --fix` to auto-fix missing providers');
      console.log('  • Check for typos in provider names');
      console.log('  • Ensure all referenced providers are registered');
      console.log('  • Verify required API keys are properly configured');

      if (fix) {
        console.log('\n🔧 Auto-fix suggestions:');
        console.log('  • Invalid providers will be removed from config');
        console.log('  • Missing providers will be added via sync command');
        console.log('  • Run `pnpm run providers:sync --fix` after fixing validation errors');
      }

      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Failed to load or validate configuration:');
    console.error(getErrorMessage(error));
    console.log('\n💡 Suggestions:');
    console.log('  • Ensure config/blockchain-explorers.json exists');
    console.log('  • Check JSON syntax is valid');
    console.log('  • Run `pnpm run config:generate` to create a template');
    console.log('  • Run `pnpm run providers:sync --fix` to create config from registry');

    if (fix) {
      console.log('\n🔧 To auto-fix configuration issues:');
      console.log('  1. Fix JSON syntax errors manually first');
      console.log('  2. Run `pnpm run providers:sync --fix` to sync with registry');
      console.log('  3. Re-run validation to verify fixes');
    }

    process.exit(1);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix') || args.includes('-f');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
🔍 Configuration Validation Tool

Usage:
  pnpm run config:validate                 # Basic validation
  pnpm run config:validate --fix          # Show auto-fix suggestions
  pnpm run config:validate --verbose      # Detailed output
  pnpm run config:validate --help         # Show this help

Description:
  Validates blockchain-explorers.json configuration against registered providers.
  Detects missing providers, invalid configurations, and provides fix suggestions.

Examples:
  pnpm run config:validate                 # Check config validity
  pnpm run config:validate --fix          # Get auto-fix suggestions
  pnpm run providers:sync --fix           # Auto-fix missing providers
`);
    return;
  }

  try {
    validateConfiguration({ fix, verbose });
  } catch (error) {
    console.error('❌ Validation failed:', getErrorMessage(error));
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { validateConfiguration };
