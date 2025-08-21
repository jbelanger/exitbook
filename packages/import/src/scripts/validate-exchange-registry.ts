#!/usr/bin/env node

/**
 * Validate exchange adapter registry and check for common issues
 */

import { ExchangeAdapterRegistry } from '../exchanges/registry/index.ts';
// Import to trigger registration
import '../exchanges/registry/register-adapters.ts';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateExchangeRegistry(): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: []
  };

  console.log('🔍 Validating Exchange Adapter Registry\n');

  try {
    const allAdapters = ExchangeAdapterRegistry.getAllAdapters();

    if (allAdapters.length === 0) {
      result.valid = false;
      result.errors.push('No exchange adapters registered');
      return result;
    }

    console.log(`📊 Found ${allAdapters.length} registered adapters\n`);

    // Group by exchange for validation
    const byExchange = allAdapters.reduce((acc, adapter) => {
      if (!acc[adapter.exchangeId]) {
        acc[adapter.exchangeId] = [];
      }
      acc[adapter.exchangeId].push(adapter);
      return acc;
    }, {} as Record<string, typeof allAdapters>);

    // Validate each exchange
    for (const [exchangeId, adapters] of Object.entries(byExchange)) {
      console.log(`🏛️  Validating ${exchangeId.toUpperCase()}`);
      console.log('─'.repeat(40));

      // Check for required adapter types
      const adapterTypes = new Set(adapters.map(a => a.adapterType));
      
      if (!adapterTypes.has('ccxt') && !adapterTypes.has('native')) {
        result.warnings.push(`${exchangeId}: No CCXT or native adapter found - only universal adapter available`);
      }

      // Validate each adapter
      for (const adapter of adapters) {
        console.log(`\n📋 ${adapter.displayName} (${adapter.adapterType})`);

        // Validate metadata completeness
        if (!adapter.exchangeId || adapter.exchangeId.trim() === '') {
          result.errors.push(`${exchangeId}/${adapter.adapterType}: Missing or empty exchangeId`);
          result.valid = false;
        }

        if (!adapter.displayName || adapter.displayName.trim() === '') {
          result.errors.push(`${exchangeId}/${adapter.adapterType}: Missing or empty displayName`);
          result.valid = false;
        }

        if (!adapter.adapterType || !['ccxt', 'native', 'universal'].includes(adapter.adapterType)) {
          result.errors.push(`${exchangeId}/${adapter.adapterType}: Invalid adapter type`);
          result.valid = false;
        }

        // Validate capabilities
        if (!adapter.capabilities) {
          result.errors.push(`${exchangeId}/${adapter.adapterType}: Missing capabilities`);
          result.valid = false;
        } else {
          const requiredCapabilities = [
            'requiresApiKey',
            'supportsCsv',
            'supportsCcxt',
            'supportsNative',
            'supportsPagination',
            'supportsBalanceVerification',
            'supportsHistoricalData'
          ];

          for (const capability of requiredCapabilities) {
            if (!(capability in adapter.capabilities)) {
              result.warnings.push(`${exchangeId}/${adapter.adapterType}: Missing capability: ${capability}`);
            }
          }

          // Logical validation
          if (adapter.adapterType === 'ccxt' && !adapter.capabilities.supportsCcxt) {
            result.errors.push(`${exchangeId}/${adapter.adapterType}: CCXT adapter must support CCXT`);
            result.valid = false;
          }

          if (adapter.adapterType === 'native' && !adapter.capabilities.supportsNative) {
            result.errors.push(`${exchangeId}/${adapter.adapterType}: Native adapter must support native API`);
            result.valid = false;
          }
        }

        // Validate configuration requirements
        if (adapter.configValidation) {
          if (adapter.configValidation.requiredCredentials) {
            for (const credential of adapter.configValidation.requiredCredentials) {
              if (!credential || credential.trim() === '') {
                result.errors.push(`${exchangeId}/${adapter.adapterType}: Empty required credential`);
                result.valid = false;
              }
            }
          }

          if (adapter.configValidation.requiredOptions) {
            for (const option of adapter.configValidation.requiredOptions) {
              if (!option || option.trim() === '') {
                result.errors.push(`${exchangeId}/${adapter.adapterType}: Empty required option`);
                result.valid = false;
              }
            }
          }
        }

        // Check for description
        if (!adapter.description || adapter.description.trim() === '') {
          result.warnings.push(`${exchangeId}/${adapter.adapterType}: Missing description`);
        }

        console.log('   ✅ Metadata structure valid');

        // Show capabilities summary
        const enabledCapabilities = Object.entries(adapter.capabilities)
          .filter(([_, value]) => value === true)
          .map(([key]) => key.replace(/^supports?/, '').replace(/^requires?/, ''))
          .join(', ');

        if (enabledCapabilities) {
          console.log(`   ⚡ Capabilities: ${enabledCapabilities}`);
        }

        if (adapter.configValidation?.requiredCredentials?.length) {
          console.log(`   🔑 Required credentials: ${adapter.configValidation.requiredCredentials.join(', ')}`);
        }
      }

      console.log();
    }

    // Check for duplicate exchanges with same adapter type
    const duplicateCheck = new Map<string, string[]>();
    for (const adapter of allAdapters) {
      const key = `${adapter.exchangeId}:${adapter.adapterType}`;
      if (!duplicateCheck.has(key)) {
        duplicateCheck.set(key, []);
      }
      duplicateCheck.get(key)!.push(adapter.displayName);
    }

    for (const [key, names] of duplicateCheck.entries()) {
      if (names.length > 1) {
        result.errors.push(`Duplicate adapter registration: ${key} (${names.join(', ')})`);
        result.valid = false;
      }
    }

  } catch (error) {
    result.valid = false;
    result.errors.push(`Registry validation failed: ${error instanceof Error ? error.message : error}`);
  }

  return result;
}

function main() {
  const result = validateExchangeRegistry();

  console.log('\n📈 Validation Summary');
  console.log('─'.repeat(50));

  if (result.errors.length > 0) {
    console.log(`❌ Errors: ${result.errors.length}`);
    for (const error of result.errors) {
      console.log(`   🚫 ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log(`⚠️  Warnings: ${result.warnings.length}`);
    for (const warning of result.warnings) {
      console.log(`   ⚠️  ${warning}`);
    }
  }

  if (result.valid && result.warnings.length === 0) {
    console.log('🎉 Registry validation passed with no issues!');
  } else if (result.valid) {
    console.log('✅ Registry validation passed with warnings');
  } else {
    console.log('❌ Registry validation failed');
    process.exit(1);
  }

  console.log('\n💡 Next steps:');
  if (result.errors.length > 0) {
    console.log('  1. Fix the validation errors above');
    console.log('  2. Re-run validation');
  } else {
    console.log('  1. Review any warnings and consider addressing them');
    console.log('  2. Run exchange configuration validation');
    console.log('  3. Test adapter functionality with actual exchanges');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}