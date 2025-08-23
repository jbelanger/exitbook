#!/usr/bin/env tsx

/**
 * Generate blockchain explorer configuration template from registered providers
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ProviderRegistry } from "../blockchains/shared/registry/index.ts";

// Import all providers to trigger registration
import "../blockchains/registry/register-providers.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateConfiguration(): void {
  console.log("🔧 Generating Blockchain Configuration Template\n");

  const allProviders = ProviderRegistry.getAllProviders();

  if (allProviders.length === 0) {
    console.log("❌ No providers found. Ensure provider files are imported.");
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
      explorers: Array<{
        name: string;
        enabled: boolean;
        priority?: number;
        networks?: Record<string, unknown>;
      }>;
    }
  > = {};

  for (const [blockchain, providers] of providersByBlockchain.entries()) {
    config[blockchain] = {
      explorers: providers.map((provider, index) => {
        const metadata = ProviderRegistry.getMetadata(
          blockchain,
          provider.name,
        );

        const explorerConfig: {
          name: string;
          enabled: boolean;
          priority?: number;
          networks?: Record<string, unknown>;
          capabilities?: Record<string, unknown>;
          [key: string]: unknown;
        } = {
          name: provider.name,
          displayName: provider.displayName,
          enabled: index === 0, // Enable first provider by default
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
            supportedOperations: provider.capabilities.supportedOperations,
            maxBatchSize: provider.capabilities.maxBatchSize,
            supportsHistoricalData:
              provider.capabilities.supportsHistoricalData,
            supportsRealTimeData: provider.capabilities.supportsRealTimeData,
            supportsTokenData: provider.capabilities.supportsTokenData,
            supportsPagination: provider.capabilities.supportsPagination,
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
          defaultConfig: {
            timeout: metadata?.defaultConfig.timeout,
            retries: metadata?.defaultConfig.retries,
            rateLimit: {
              requestsPerSecond:
                metadata?.defaultConfig.rateLimit.requestsPerSecond,
              ...(metadata?.defaultConfig.rateLimit.requestsPerMinute && {
                requestsPerMinute:
                  metadata.defaultConfig.rateLimit.requestsPerMinute,
              }),
              ...(metadata?.defaultConfig.rateLimit.requestsPerHour && {
                requestsPerHour:
                  metadata.defaultConfig.rateLimit.requestsPerHour,
              }),
              ...(metadata?.defaultConfig.rateLimit.burstLimit && {
                burstLimit: metadata.defaultConfig.rateLimit.burstLimit,
              }),
            },
          },
        };

        return explorerConfig;
      }),
    };
  }

  // Write configuration file
  const configPath = path.join(
    __dirname,
    "../../config/blockchain-explorers-template.json",
  );
  const configJson = JSON.stringify(config, null, 2);

  try {
    // Ensure config directory exists
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, configJson);

    console.log("✅ Configuration template generated successfully!");
    console.log(`📄 File: ${configPath}`);
    console.log(
      `📊 Generated ${Object.keys(config).length} blockchains with ${allProviders.length} total providers\n`,
    );

    // Show summary
    console.log("📋 Generated Configuration:");
    console.log("─".repeat(50));

    for (const [blockchain, blockchainConfig] of Object.entries(config)) {
      const { explorers } = blockchainConfig;
      const enabled = explorers.filter((e) => e.enabled);

      console.log(`${blockchain.toUpperCase()}:`);
      console.log(
        `  Providers: ${explorers.length} (${enabled.length} enabled)`,
      );
      console.log(
        `  Default: ${enabled.length > 0 ? enabled[0].name : "none"}`,
      );
      console.log("");
    }

    console.log("💡 Next steps:");
    console.log("  1. Review the generated template");
    console.log("  2. Copy to blockchain-explorers.json if needed");
    console.log("  3. Customize enabled providers and priorities");
    console.log("  4. Set up required API keys in environment variables:");

    // Show required environment variables
    const apiKeyProviders = allProviders.filter((p) => p.requiresApiKey);
    if (apiKeyProviders.length > 0) {
      apiKeyProviders.forEach((provider) => {
        const metadata = ProviderRegistry.getMetadata(
          provider.blockchain,
          provider.name,
        );
        if (metadata?.apiKeyEnvVar) {
          console.log(
            `     export ${metadata.apiKeyEnvVar}="your_${provider.name}_api_key"`,
          );
        }
      });
    }

    console.log("  5. Run `pnpm run config:validate` to verify");
  } catch (error) {
    console.error("❌ Failed to write configuration file:");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    generateConfiguration();
  } catch (error) {
    console.error(
      "❌ Failed to generate configuration:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

export { generateConfiguration };
