#!/usr/bin/env tsx
import { getErrorMessage } from '@exitbook/core';
/**
 * Validate that all providers are properly registered and functional
 */
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { ProviderRegistry } from '../core/index.js';
import { initializeProviders } from '../initialize.js';

// Initialize all providers
initializeProviders();

interface ValidationError {
  message: string;
  type: 'error' | 'warning';
}

type ValidationResult = Result<string[], ValidationError[]>;

function validateProvider(blockchain: string, providerName: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  const addError = (message: string) => errors.push({ message, type: 'error' });
  const addWarning = (message: string) => errors.push({ message, type: 'warning' });

  try {
    // Check if provider is registered
    if (!ProviderRegistry.isRegistered(blockchain, providerName)) {
      addError('Provider not found in registry');
      return err(errors);
    }

    // Get metadata
    const metadata = ProviderRegistry.getMetadata(blockchain, providerName);
    if (!metadata) {
      addError('No metadata found');
      return err(errors);
    }

    // Validate metadata fields
    if (!metadata.name) {
      addError('Missing name in metadata');
    }

    if (!metadata.displayName) {
      addError('Missing displayName in metadata');
    }

    if (!metadata.baseUrl) {
      addError('Missing baseUrl in metadata');
    }

    if (!metadata.defaultConfig?.rateLimit?.requestsPerSecond) {
      addError('Missing rateLimit configuration');
    }

    if (!metadata.defaultConfig?.timeout) {
      addError('Missing timeout configuration');
    }

    if (!metadata.capabilities) {
      addError('Missing capabilities in metadata');
    } else {
      if (!metadata.capabilities.supportedOperations?.length) {
        addWarning('No supported operations defined in capabilities');
      }
    }

    // Test provider instantiation
    try {
      // Build proper ProviderConfig from metadata
      const config = {
        ...metadata.defaultConfig,
        baseUrl: metadata.baseUrl,
        blockchain,
        displayName: metadata.displayName,
        name: metadata.name,
        requiresApiKey: metadata.requiresApiKey,
      };

      const provider = ProviderRegistry.createProvider(blockchain, providerName, config);

      // Check provider properties
      if (provider.name !== providerName) {
        addError(`Provider name mismatch: expected '${providerName}', got '${provider.name}'`);
      }

      if (provider.blockchain !== blockchain) {
        addError(`Blockchain mismatch: expected '${blockchain}', got '${provider.blockchain}'`);
      }

      if (!provider.capabilities) {
        addError('Missing capabilities');
      } else {
        if (!provider.capabilities.supportedOperations?.length) {
          addWarning('No supported operations defined');
        }
      }
    } catch (error) {
      addError(`Provider instantiation failed: ${getErrorMessage(error)}`);
    }

    // Warnings for best practices
    if (!metadata.description) {
      addWarning('Missing description - consider adding for better documentation');
    }
  } catch (error) {
    addError(`Validation error: ${getErrorMessage(error)}`);
  }

  const errorMessages = errors.filter((e) => e.type === 'error');
  if (errorMessages.length > 0) {
    return err(errors);
  }

  return ok(warnings);
}

function validateProviders(): void {
  console.log('🔍 Validating Provider Registrations\n');

  const allProviders = ProviderRegistry.getAllProviders();

  if (allProviders.length === 0) {
    console.log('❌ No providers found. Ensure provider files are imported.');
    process.exit(1);
  }

  const results: {
    blockchain: string;
    providerName: string;
    result: ValidationResult;
  }[] = [];
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  // Validate each provider
  for (const provider of allProviders) {
    const result = validateProvider(provider.blockchain, provider.name);
    results.push({
      blockchain: provider.blockchain,
      providerName: provider.name,
      result,
    });

    if (result.isErr()) {
      const errors = result.error.filter((e) => e.type === 'error');
      const warnings = result.error.filter((e) => e.type === 'warning');

      allErrors.push(...errors.map((err) => `${provider.blockchain}:${provider.name} - ${err.message}`));
      allWarnings.push(...warnings.map((warn) => `${provider.blockchain}:${provider.name} - ${warn.message}`));
    } else {
      allWarnings.push(...result.value.map((warn) => `${provider.blockchain}:${provider.name} - ${warn}`));
    }
  }

  // Show results
  console.log('📋 Validation Results');
  console.log('─'.repeat(50));

  // Group by blockchain
  const providersByBlockchain = new Map<string, typeof results>();
  for (const item of results) {
    if (!providersByBlockchain.has(item.blockchain)) {
      providersByBlockchain.set(item.blockchain, []);
    }
    providersByBlockchain.get(item.blockchain)!.push(item);
  }

  for (const [blockchain, providerResults] of providersByBlockchain.entries()) {
    console.log(`\n${blockchain.toUpperCase()}:`);

    for (const { providerName, result } of providerResults) {
      const status = result.isOk() ? '✅' : '❌';
      console.log(`  ${status} ${providerName}`);

      if (result.isErr()) {
        const errors = result.error.filter((e) => e.type === 'error');
        const warnings = result.error.filter((e) => e.type === 'warning');

        for (const error of errors) {
          console.log(`      ❌ ${error.message}`);
        }

        for (const warning of warnings) {
          console.log(`      ⚠️  ${warning.message}`);
        }
      } else {
        for (const warning of result.value) {
          console.log(`      ⚠️  ${warning}`);
        }
      }
    }
  }

  // Summary
  const validProviders = results.filter((r) => r.result.isOk()).length;
  const invalidProviders = results.filter((r) => r.result.isErr()).length;

  console.log('\n📊 Summary');
  console.log('─'.repeat(20));
  console.log(`Total Providers: ${results.length}`);
  console.log(`Valid: ${validProviders}`);
  console.log(`Invalid: ${invalidProviders}`);
  console.log(`Warnings: ${allWarnings.length}`);

  if (invalidProviders > 0) {
    console.log('\n🚨 Validation Failed!');
    console.log('Fix the errors above before proceeding.');
    process.exit(1);
  } else if (allWarnings.length > 0) {
    console.log('\n⚠️  Validation Passed with Warnings');
    console.log('Consider addressing the warnings above for better provider quality.');
  } else {
    console.log('\n✅ All providers are valid!');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    validateProviders();
  } catch (error) {
    console.error('❌ Failed to validate providers:', getErrorMessage(error));
    process.exit(1);
  }
}

export { validateProviders };
