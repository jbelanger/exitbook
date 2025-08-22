#!/usr/bin/env tsx

/**
 * Validate blockchain explorer configuration against registered providers
 */

import { loadExplorerConfig } from '../blockchains/shared/explorer-config.ts';
import { ProviderRegistry } from '../blockchains/shared/registry/index.ts';

// Import all providers to trigger registration
import '../blockchains/registry/register-providers.ts';

function validateConfiguration(): void {
  console.log('🔍 Validating Blockchain Configuration\n');

  try {
    // Load the configuration
    const config = loadExplorerConfig();

    // Validate against registry
    const validation = ProviderRegistry.validateConfig(config);

    if (validation.valid) {
      console.log('✅ Configuration is valid!\n');

      // Show configuration summary
      console.log('📋 Configuration Summary');
      console.log('─'.repeat(40));

      for (const [blockchain, blockchainConfig] of Object.entries(config)) {
        if (!blockchainConfig || typeof blockchainConfig !== 'object') continue;

        const { explorers = [] } = blockchainConfig as { explorers: Array<{ name: string; enabled: boolean; priority: number }> };
        const enabled = explorers.filter(e => e.enabled);

        console.log(`${blockchain.toUpperCase()}:`);
        console.log(`  Total providers: ${explorers.length}`);
        console.log(`  Enabled: ${enabled.length}`);
        console.log(`  Disabled: ${explorers.length - enabled.length}`);

        if (enabled.length > 0) {
          console.log('  Enabled providers:');
          enabled
            .sort((a, b) => a.priority - b.priority)
            .forEach(provider => {
              const metadata = ProviderRegistry.getMetadata(blockchain, provider.name);
              const apiKeyInfo = metadata?.requiresApiKey ?
                (metadata.apiKeyEnvVar ? ` (${metadata.apiKeyEnvVar})` : ' (API key required)') : '';
              console.log(`    ${provider.priority}. ${provider.name}${apiKeyInfo}`);
            });
        }

        console.log('');
      }

    } else {
      console.log('❌ Configuration validation failed!\n');

      console.log('🚨 Errors found:');
      validation.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });

      console.log('\n💡 Suggestions:');
      console.log('  • Run `pnpm run providers:list` to see available providers');
      console.log('  • Check for typos in provider names');
      console.log('  • Ensure all referenced providers are registered');
      console.log('  • Verify required API keys are properly configured');

      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Failed to load or validate configuration:');
    console.error(error instanceof Error ? error.message : error);
    console.log('\n💡 Suggestions:');
    console.log('  • Ensure config/blockchain-explorers.json exists');
    console.log('  • Check JSON syntax is valid');
    console.log('  • Run `pnpm run config:generate` to create a template');
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateConfiguration();
}

export { validateConfiguration };
