#!/usr/bin/env node

import { ExchangeAdapterRegistry } from '../exchanges/registry/index.ts';
// Import to trigger registration
import '../exchanges/registry/register-adapters.ts';

function formatCapabilities(capabilities: any): string {
  const items = [
    capabilities.requiresApiKey ? '🔑 API Key Required' : '🔓 No API Key',
    capabilities.supportsCsv ? '📄 CSV' : '',
    capabilities.supportsCcxt ? '🔄 CCXT' : '',
    capabilities.supportsNative ? '⚡ Native' : '',
    capabilities.supportsPagination ? '📚 Pagination' : '',
    capabilities.supportsBalanceVerification ? '💰 Balance Check' : '',
    capabilities.supportsHistoricalData ? '📈 Historical' : ''
  ].filter(Boolean);
  
  return items.join(' • ');
}

function main() {
  console.log('📊 Available Exchange Adapters\n');
  
  const allAdapters = ExchangeAdapterRegistry.getAllAdapters();
  
  if (allAdapters.length === 0) {
    console.log('❌ No exchange adapters registered');
    process.exit(1);
  }
  
  // Group by exchange
  const byExchange = allAdapters.reduce((acc, adapter) => {
    if (!acc[adapter.exchangeId]) {
      acc[adapter.exchangeId] = [];
    }
    acc[adapter.exchangeId].push(adapter);
    return acc;
  }, {} as Record<string, typeof allAdapters>);
  
  for (const [exchangeId, adapters] of Object.entries(byExchange)) {
    console.log(`\n🏛️  ${exchangeId.toUpperCase()}`);
    console.log('─'.repeat(50));
    
    for (const adapter of adapters) {
      console.log(`\n📋 ${adapter.displayName}`);
      console.log(`   Type: ${adapter.adapterType}`);
      console.log(`   ${formatCapabilities(adapter.capabilities)}`);
      
      if (adapter.description) {
        console.log(`   📝 ${adapter.description}`);
      }
      
      if (adapter.configValidation) {
        if (adapter.configValidation.requiredCredentials?.length > 0) {
          console.log(`   🔑 Required credentials: ${adapter.configValidation.requiredCredentials.join(', ')}`);
        }
        if (adapter.configValidation.requiredOptions?.length > 0) {
          console.log(`   ⚙️  Required options: ${adapter.configValidation.requiredOptions.join(', ')}`);
        }
      }
    }
  }
  
  console.log(`\n✅ Total: ${allAdapters.length} adapters across ${Object.keys(byExchange).length} exchanges`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}