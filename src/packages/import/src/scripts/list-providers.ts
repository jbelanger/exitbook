#!/usr/bin/env tsx

/**
 * List all registered providers across all blockchains
 */

import { ProviderRegistry } from '../providers/registry/index.ts';

// Import all providers to trigger registration
import '../providers/avalanche/SnowtraceProvider.ts';
import '../providers/bitcoin/BlockCypherProvider.ts';
import '../providers/bitcoin/BlockstreamProvider.ts';
import '../providers/bitcoin/MempoolSpaceProvider.ts';
import '../providers/ethereum/AlchemyProvider.ts';
import '../providers/ethereum/EtherscanProvider.ts';
import '../providers/ethereum/MoralisProvider.ts';
import '../providers/injective/InjectiveExplorerProvider.ts';
import '../providers/injective/InjectiveLCDProvider.ts';
import '../providers/solana/HeliusProvider.ts';
import '../providers/solana/SolanaRPCProvider.ts';
import '../providers/solana/SolscanProvider.ts';

function formatRateLimit(rateLimit: any): string {
  const parts: string[] = [];
  if (rateLimit.requestsPerSecond) {
    parts.push(`${rateLimit.requestsPerSecond}/sec`);
  }
  if (rateLimit.requestsPerMinute) {
    parts.push(`${rateLimit.requestsPerMinute}/min`);
  }
  if (rateLimit.requestsPerHour) {
    parts.push(`${rateLimit.requestsPerHour}/hour`);
  }
  if (rateLimit.burstLimit) {
    parts.push(`burst:${rateLimit.burstLimit}`);
  }
  return parts.join(', ');
}

function formatCapabilities(capabilities: any): string {
  const features: string[] = [];
  if (capabilities.providesHistoricalData) features.push('Historical');
  if (capabilities.supportsRealTimeData) features.push('Real-time');
  if (capabilities.supportsTokenData) features.push('Tokens');
  if (capabilities.supportsPagination) features.push('Pagination');
  if (capabilities.maxBatchSize > 1) features.push(`Batch:${capabilities.maxBatchSize}`);
  return features.join(', ') || 'Basic';
}

function listProviders(): void {
  console.log('🔍 Registered Blockchain Providers\n');

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

  // Display providers by blockchain
  for (const [blockchain, providers] of providersByBlockchain.entries()) {
    console.log(`📋 ${blockchain.toUpperCase()}`);
    console.log('─'.repeat(50));

    for (const provider of providers) {
      console.log(`  ✓ ${provider.name}`);
      console.log(`    Name: ${provider.displayName}`);
      console.log(`    Type: ${provider.type}`);
      console.log(`    API Key Required: ${provider.requiresApiKey ? 'Yes' : 'No'}`);

      // Show API key environment variable if available
      const metadata = ProviderRegistry.getMetadata(blockchain, provider.name);
      if (metadata?.apiKeyEnvVar && provider.requiresApiKey) {
        console.log(`    Environment Variable: ${metadata.apiKeyEnvVar}`);
      }

      console.log(`    Rate Limits: ${formatRateLimit(provider.defaultConfig.rateLimit)}`);
      console.log(`    Networks: ${provider.supportedNetworks.join(', ')}`);
      console.log(`    Operations: ${provider.capabilities.supportedOperations.join(', ')}`);
      console.log(`    Features: ${formatCapabilities(provider.capabilities)}`);
      console.log(`    Timeout: ${provider.defaultConfig.timeout}ms, Retries: ${provider.defaultConfig.retries}`);

      if (provider.description) {
        console.log(`    Description: ${provider.description}`);
      }

      console.log('');
    }
  }

  // Summary
  console.log('📊 Summary');
  console.log('─'.repeat(20));
  console.log(`Total Blockchains: ${providersByBlockchain.size}`);
  console.log(`Total Providers: ${allProviders.length}`);

  const apiKeyRequired = allProviders.filter(p => p.requiresApiKey).length;
  console.log(`Require API Key: ${apiKeyRequired}`);
  console.log(`No API Key: ${allProviders.length - apiKeyRequired}`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    listProviders();
  } catch (error) {
    console.error('❌ Failed to list providers:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export { listProviders };
