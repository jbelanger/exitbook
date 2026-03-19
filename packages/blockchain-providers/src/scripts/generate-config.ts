#!/usr/bin/env tsx
/**
 * Generate blockchain explorer configuration template from registered providers
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getErrorMessage } from '@exitbook/core';

import { createProviderRegistry } from '../initialize.js';

const registry = createProviderRegistry();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateConfiguration(): void {
  console.log('🔧 Generating Blockchain Configuration Template\n');

  const allProviders = registry.getAllProviders();

  if (allProviders.length === 0) {
    console.log('❌ No providers found. Ensure provider files are imported.');
    process.exit(1);
  }

  // Group providers by blockchain
  const providersByBlockchain = new Map<string, typeof allProviders>();

  for (const provider of allProviders) {
    if (!providersByBlockchain.has(provider.blockchain)) {
      providersByBlockchain.set(provider.blockchain, []);
    }
    providersByBlockchain.get(provider.blockchain)!.push(provider);
  }

  // Generate configuration object using the BlockchainExplorersConfig format:
  // { defaultEnabled: string[], overrides: { [providerName]: { priority, rateLimit, ... } } }
  const config: Record<
    string,
    {
      defaultEnabled: string[];
      overrides: Record<
        string,
        {
          description?: string | undefined;
          enabled: boolean;
          priority: number;
          rateLimit?: Record<string, number | undefined> | undefined;
          retries?: number | undefined;
          timeout?: number | undefined;
        }
      >;
    }
  > = {};

  for (const [blockchain, providers] of providersByBlockchain.entries()) {
    const firstProvider = providers[0];
    const defaultEnabled = firstProvider ? [firstProvider.name] : [];
    const overrides: (typeof config)[string]['overrides'] = {};

    for (const [index, provider] of providers.entries()) {
      const metadata = registry.getMetadata(blockchain, provider.name);
      overrides[provider.name] = {
        priority: index + 1,
        enabled: index === 0, // Enable first provider by default
        ...(metadata?.description && { description: metadata.description }),
        ...(metadata?.defaultConfig.rateLimit && {
          rateLimit: {
            requestsPerSecond: metadata.defaultConfig.rateLimit.requestsPerSecond,
            ...(metadata.defaultConfig.rateLimit.requestsPerMinute && {
              requestsPerMinute: metadata.defaultConfig.rateLimit.requestsPerMinute,
            }),
            ...(metadata.defaultConfig.rateLimit.requestsPerHour && {
              requestsPerHour: metadata.defaultConfig.rateLimit.requestsPerHour,
            }),
            ...(metadata.defaultConfig.rateLimit.burstLimit && {
              burstLimit: metadata.defaultConfig.rateLimit.burstLimit,
            }),
          },
        }),
        ...(metadata?.defaultConfig.retries !== undefined && { retries: metadata.defaultConfig.retries }),
        ...(metadata?.defaultConfig.timeout !== undefined && { timeout: metadata.defaultConfig.timeout }),
      };
    }

    config[blockchain] = { defaultEnabled, overrides };
  }

  // Write configuration file
  const configPath = path.join(__dirname, '../../config/blockchain-explorers-template.json');
  const configJson = JSON.stringify(config, undefined, 2);

  try {
    // Ensure config directory exists
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, configJson);

    console.log('✅ Configuration template generated successfully!');
    console.log(`📄 File: ${configPath}`);
    console.log(`📊 Generated ${Object.keys(config).length} blockchains with ${allProviders.length} total providers\n`);

    // Show summary
    console.log('📋 Generated Configuration:');
    console.log('─'.repeat(50));

    for (const [blockchain, blockchainConfig] of Object.entries(config)) {
      const { defaultEnabled, overrides } = blockchainConfig;
      const totalProviders = Object.keys(overrides).length;

      console.log(`${blockchain.toUpperCase()}:`);
      console.log(`  Providers: ${totalProviders} (${defaultEnabled.length} enabled by default)`);
      console.log(`  Default: ${defaultEnabled.length > 0 ? defaultEnabled.join(', ') : 'none'}`);
      console.log('');
    }

    console.log('💡 Next steps:');
    console.log('  1. Review the generated template');
    console.log('  2. Copy to blockchain-explorers.json if needed');
    console.log('  3. Customize enabled providers and priorities');
    console.log('  4. Set up required API keys in environment variables:');

    // Show required environment variables
    const apiKeyProviders = allProviders.filter((p) => p.requiresApiKey);
    if (apiKeyProviders.length > 0) {
      for (const provider of apiKeyProviders) {
        const metadata = registry.getMetadata(provider.blockchain, provider.name);
        if (metadata?.apiKeyEnvVar) {
          console.log(`     export ${metadata.apiKeyEnvVar}="your_${provider.name}_api_key"`);
        }
      }
    }

    console.log('  5. Run `pnpm run config:validate` to verify');
  } catch (error) {
    console.error('❌ Failed to write configuration file:');
    console.error(getErrorMessage(error));
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    generateConfiguration();
  } catch (error) {
    console.error('❌ Failed to generate configuration:', getErrorMessage(error));
    process.exit(1);
  }
}

export { generateConfiguration };
