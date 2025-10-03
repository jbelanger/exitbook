#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Sync registered providers with blockchain configuration
 * Detects missing providers and can automatically fix config drift
 */
import type { BlockchainExplorersConfig } from '@exitbook/shared-utils';

// Import all providers to trigger registration
import '../infrastructure/blockchains/registry/register-apis.js';
import { ProviderRegistry } from '../core/blockchain/index.ts';

interface SyncResult {
  blockchain: string;
  configuredProviders: string[];
  hasChanges: boolean;
  missingProviders: string[];
  registeredProviders: string[];
}

function loadCurrentConfig(): BlockchainExplorersConfig {
  const configPath = resolve(process.cwd(), 'config/blockchain-explorers.json');
  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as BlockchainExplorersConfig;
  } catch (_error) {
    console.log('⚠️  No existing config found, will create new one');
    return {};
  }
}

function saveConfig(config: BlockchainExplorersConfig): void {
  const configPath = resolve(process.cwd(), 'config/blockchain-explorers.json');
  const content = JSON.stringify(config, undefined, 2);
  writeFileSync(configPath, content, 'utf-8');
}

function syncProviders(fix = false): SyncResult[] {
  console.log('🔄 Syncing Registered Providers with Configuration\n');

  const allProviders = ProviderRegistry.getAllProviders();
  const currentConfig = loadCurrentConfig();
  const results: SyncResult[] = [];
  let hasAnyChanges = false;

  // Group providers by blockchain
  const providersByBlockchain = new Map<string, string[]>();
  for (const provider of allProviders) {
    if (!providersByBlockchain.has(provider.blockchain)) {
      providersByBlockchain.set(provider.blockchain, []);
    }
    providersByBlockchain.get(provider.blockchain)!.push(provider.name);
  }

  // Check each blockchain
  for (const [blockchain, registeredProviders] of providersByBlockchain.entries()) {
    const blockchainConfig = currentConfig[blockchain];
    const configuredProviders = blockchainConfig?.defaultEnabled || [];
    const missingProviders = registeredProviders.filter((provider) => !configuredProviders.includes(provider));

    const result: SyncResult = {
      blockchain,
      configuredProviders,
      hasChanges: missingProviders.length > 0,
      missingProviders,
      registeredProviders,
    };

    results.push(result);

    if (result.hasChanges) {
      hasAnyChanges = true;

      if (fix) {
        // Auto-fix: add missing providers to defaultEnabled
        if (!currentConfig[blockchain]) {
          currentConfig[blockchain] = { defaultEnabled: [], overrides: {} };
        }

        const newDefaultEnabled = [...configuredProviders, ...missingProviders].sort();
        currentConfig[blockchain].defaultEnabled = newDefaultEnabled;

        console.log(`✅ Fixed ${blockchain}: Added ${missingProviders.length} missing providers`);
      }
    }
  }

  if (fix && hasAnyChanges) {
    saveConfig(currentConfig);
    console.log('\n💾 Configuration updated successfully!');
  }

  return results;
}

function displaySyncResults(results: SyncResult[]): void {
  console.log('📋 Provider Sync Analysis');
  console.log('─'.repeat(50));

  let totalMissing = 0;
  let totalConfigured = 0;
  let totalRegistered = 0;

  for (const result of results) {
    console.log(`\n${result.blockchain.toUpperCase()}:`);
    console.log(`  Registered: ${result.registeredProviders.length} providers`);
    console.log(`  Configured: ${result.configuredProviders.length} providers`);

    if (result.missingProviders.length > 0) {
      console.log(`  ❌ Missing: ${result.missingProviders.length} providers`);
      for (const provider of result.missingProviders) {
        console.log(`    - ${provider}`);
      }
    } else {
      console.log(`  ✅ All registered providers are configured`);
    }

    totalMissing += result.missingProviders.length;
    totalConfigured += result.configuredProviders.length;
    totalRegistered += result.registeredProviders.length;
  }

  // Summary
  console.log('\n📊 Summary');
  console.log('─'.repeat(20));
  console.log(`Total Registered: ${totalRegistered}`);
  console.log(`Total Configured: ${totalConfigured}`);
  console.log(`Missing from Config: ${totalMissing}`);

  if (totalMissing > 0) {
    console.log('\n🚨 Configuration Drift Detected!');
    console.log(`${totalMissing} registered providers are missing from config.`);
    console.log('Run with --fix to automatically add missing providers.');
  } else {
    console.log('\n✅ Configuration is in sync!');
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix') || args.includes('-f');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
🔄 Provider Sync Tool

Usage:
  pnpm run providers:sync              # Check for config drift
  pnpm run providers:sync --fix        # Auto-fix missing providers
  pnpm run providers:sync --help       # Show this help

Description:
  Compares registered providers (from @RegisterProvider decorators) with
  the blockchain-explorers.json configuration. Detects missing providers
  and can automatically add them to the config.

Examples:
  pnpm run providers:sync              # Analyze only
  pnpm run providers:sync --fix        # Fix config drift
`);
    return;
  }

  try {
    const results = syncProviders(fix);
    displaySyncResults(results);

    // Exit code for CI/automation
    const hasIssues = results.some((r) => r.hasChanges);
    if (hasIssues && !fix) {
      process.exit(1); // Exit with error if issues found but not fixed
    }
  } catch (error) {
    console.error('❌ Failed to sync providers:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { syncProviders };
