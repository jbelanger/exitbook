#!/usr/bin/env tsx
/**
 * Generate blockchain explorer configuration template from registered providers
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Import all providers to trigger registration
import '../blockchains/registry/register-providers.ts';
import { ProviderRegistry } from '../blockchains/shared/registry/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateConfiguration(): void {
  console.log('🔧 Generating Blockchain Configuration Template\n');

  const allProviders = ProviderRegistry.getAllProviders();

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

  // Generate configuration object
  const config: Record<
    string,
    {
      explorers: {
        enabled: boolean;
        name: string;
        networks?: Record<string, unknown>;
        priority?: number;
      }[];
    }
  > = {};

  for (const [blockchain, providers] of providersByBlockchain.entries()) {
    config[blockchain] = {
      explorers: providers.map((provider, index) => {
        const metadata = ProviderRegistry.getMetadata(blockchain, provider.name);

        const explorerConfig: {
          [key: string]: unknown;
          capabilities?: Record<string, unknown>;
          enabled: boolean;
          name: string;
          networks?: Record<string, unknown>;
          priority?: number;
        } = {
          displayName: provider.displayName,
          enabled: index === 0, // Enable first provider by default
          name: provider.name,
          priority: index + 1,
          type: provider.type,
          ...(metadata?.requiresApiKey && {
            requiresApiKey: true,
            ...(metadata.apiKeyEnvVar && {
              apiKeyEnvVar: metadata.apiKeyEnvVar,
            }),
          }),
          ...(metadata?.description && {
            description: metadata.description,
          }),
          capabilities: {
            maxBatchSize: provider.capabilities.maxBatchSize,
            supportedOperations: provider.capabilities.supportedOperations,
            supportsHistoricalData: provider.capabilities.supportsHistoricalData,
            supportsPagination: provider.capabilities.supportsPagination,
            supportsRealTimeData: provider.capabilities.supportsRealTimeData,
            supportsTokenData: provider.capabilities.supportsTokenData,
          },
          defaultConfig: {
            rateLimit: {
              requestsPerSecond: metadata?.defaultConfig.rateLimit.requestsPerSecond,
              ...(metadata?.defaultConfig.rateLimit.requestsPerMinute && {
                requestsPerMinute: metadata.defaultConfig.rateLimit.requestsPerMinute,
              }),
              ...(metadata?.defaultConfig.rateLimit.requestsPerHour && {
                requestsPerHour: metadata.defaultConfig.rateLimit.requestsPerHour,
              }),
              ...(metadata?.defaultConfig.rateLimit.burstLimit && {
                burstLimit: metadata.defaultConfig.rateLimit.burstLimit,
              }),
            },
            retries: metadata?.defaultConfig.retries,
            timeout: metadata?.defaultConfig.timeout,
          },
          networks: {
            ...(metadata?.networks.mainnet && {
              mainnet: {
                baseUrl: metadata.networks.mainnet.baseUrl,
              },
            }),
            ...(metadata?.networks.testnet && {
              testnet: {
                baseUrl: metadata.networks.testnet.baseUrl,
              },
            }),
            ...(metadata?.networks.devnet && {
              devnet: {
                baseUrl: metadata.networks.devnet.baseUrl,
              },
            }),
          },
        };

        return explorerConfig;
      }),
    };
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
      const { explorers } = blockchainConfig;
      const enabled = explorers.filter((e) => e.enabled);

      console.log(`${blockchain.toUpperCase()}:`);
      console.log(`  Providers: ${explorers.length} (${enabled.length} enabled)`);
      console.log(`  Default: ${enabled.length > 0 ? enabled[0].name : 'none'}`);
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
        const metadata = ProviderRegistry.getMetadata(provider.blockchain, provider.name);
        if (metadata?.apiKeyEnvVar) {
          console.log(`     export ${metadata.apiKeyEnvVar}="your_${provider.name}_api_key"`);
        }
      }
    }

    console.log('  5. Run `pnpm run config:validate` to verify');
  } catch (error) {
    console.error('❌ Failed to write configuration file:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    generateConfiguration();
  } catch (error) {
    console.error('❌ Failed to generate configuration:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export { generateConfiguration };
