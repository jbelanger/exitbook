#!/usr/bin/env tsx

/**
 * Validate that all providers are properly registered and functional
 */

import { ProviderRegistry } from "../blockchains/shared/registry/index.ts";

// Import all providers to trigger registration
import "../blockchains/registry/register-providers.ts";

interface ValidationResult {
  provider: string;
  blockchain: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateProvider(
  blockchain: string,
  providerName: string,
): ValidationResult {
  const result: ValidationResult = {
    provider: providerName,
    blockchain,
    valid: true,
    errors: [],
    warnings: [],
  };

  try {
    // Check if provider is registered
    if (!ProviderRegistry.isRegistered(blockchain, providerName)) {
      result.valid = false;
      result.errors.push("Provider not found in registry");
      return result;
    }

    // Get metadata
    const metadata = ProviderRegistry.getMetadata(blockchain, providerName);
    if (!metadata) {
      result.valid = false;
      result.errors.push("No metadata found");
      return result;
    }

    // Validate metadata fields
    if (!metadata.name) {
      result.valid = false;
      result.errors.push("Missing name in metadata");
    }

    if (!metadata.displayName) {
      result.valid = false;
      result.errors.push("Missing displayName in metadata");
    }

    if (!metadata.networks?.mainnet?.baseUrl) {
      result.valid = false;
      result.errors.push("Missing mainnet baseUrl in metadata");
    }

    if (!metadata.defaultConfig?.rateLimit?.requestsPerSecond) {
      result.valid = false;
      result.errors.push("Missing rateLimit configuration");
    }

    if (!metadata.defaultConfig?.timeout) {
      result.valid = false;
      result.errors.push("Missing timeout configuration");
    }

    if (!metadata.capabilities) {
      result.valid = false;
      result.errors.push("Missing capabilities in metadata");
    } else {
      if (!metadata.capabilities.supportedOperations?.length) {
        result.warnings.push("No supported operations defined in capabilities");
      }
    }

    // Test provider instantiation
    try {
      const provider = ProviderRegistry.createProvider(
        blockchain,
        providerName,
        {},
      );

      // Check provider properties
      if (provider.name !== providerName) {
        result.valid = false;
        result.errors.push(
          `Provider name mismatch: expected '${providerName}', got '${provider.name}'`,
        );
      }

      if (provider.blockchain !== blockchain) {
        result.valid = false;
        result.errors.push(
          `Blockchain mismatch: expected '${blockchain}', got '${provider.blockchain}'`,
        );
      }

      if (!provider.capabilities) {
        result.valid = false;
        result.errors.push("Missing capabilities");
      } else {
        if (!provider.capabilities.supportedOperations?.length) {
          result.warnings.push("No supported operations defined");
        }
      }
    } catch (error) {
      result.valid = false;
      result.errors.push(
        `Provider instantiation failed: ${error instanceof Error ? error.message : error}`,
      );
    }

    // Warnings for best practices
    if (!metadata.description) {
      result.warnings.push(
        "Missing description - consider adding for better documentation",
      );
    }

    if (metadata.requiresApiKey && !metadata.networks?.testnet) {
      result.warnings.push(
        "API key required but no testnet configuration - consider adding for testing",
      );
    }
  } catch (error) {
    result.valid = false;
    result.errors.push(
      `Validation error: ${error instanceof Error ? error.message : error}`,
    );
  }

  return result;
}

function validateProviders(): void {
  console.log("🔍 Validating Provider Registrations\n");

  const allProviders = ProviderRegistry.getAllProviders();

  if (allProviders.length === 0) {
    console.log("❌ No providers found. Ensure provider files are imported.");
    process.exit(1);
  }

  const results: ValidationResult[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate each provider
  for (const provider of allProviders) {
    const result = validateProvider(provider.blockchain, provider.name);
    results.push(result);

    if (!result.valid) {
      errors.push(
        ...result.errors.map(
          (err) => `${provider.blockchain}:${provider.name} - ${err}`,
        ),
      );
    }

    warnings.push(
      ...result.warnings.map(
        (warn) => `${provider.blockchain}:${provider.name} - ${warn}`,
      ),
    );
  }

  // Show results
  console.log("📋 Validation Results");
  console.log("─".repeat(50));

  // Group by blockchain
  const providersByBlockchain = new Map<string, ValidationResult[]>();
  for (const result of results) {
    if (!providersByBlockchain.has(result.blockchain)) {
      providersByBlockchain.set(result.blockchain, []);
    }
    providersByBlockchain.get(result.blockchain)!.push(result);
  }

  for (const [blockchain, providerResults] of providersByBlockchain.entries()) {
    console.log(`\n${blockchain.toUpperCase()}:`);

    for (const result of providerResults) {
      const status = result.valid ? "✅" : "❌";
      console.log(`  ${status} ${result.provider}`);

      if (result.errors.length > 0) {
        result.errors.forEach((error) => {
          console.log(`      ❌ ${error}`);
        });
      }

      if (result.warnings.length > 0) {
        result.warnings.forEach((warning) => {
          console.log(`      ⚠️  ${warning}`);
        });
      }
    }
  }

  // Summary
  const validProviders = results.filter((r) => r.valid).length;
  const invalidProviders = results.filter((r) => !r.valid).length;

  console.log("\n📊 Summary");
  console.log("─".repeat(20));
  console.log(`Total Providers: ${results.length}`);
  console.log(`Valid: ${validProviders}`);
  console.log(`Invalid: ${invalidProviders}`);
  console.log(`Warnings: ${warnings.length}`);

  if (invalidProviders > 0) {
    console.log("\n🚨 Validation Failed!");
    console.log("Fix the errors above before proceeding.");
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log("\n⚠️  Validation Passed with Warnings");
    console.log(
      "Consider addressing the warnings above for better provider quality.",
    );
  } else {
    console.log("\n✅ All providers are valid!");
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    validateProviders();
  } catch (error) {
    console.error(
      "❌ Failed to validate providers:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

export { validateProviders };
