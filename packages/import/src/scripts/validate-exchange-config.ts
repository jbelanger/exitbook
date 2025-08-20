#!/usr/bin/env node

import { readFileSync } from 'fs';
import { ExchangeAdapterRegistry } from '../exchanges/registry/index.ts';
import type { ExchangeConfig } from '../exchanges/types.ts';
// Import to trigger registration
import '../exchanges/registry/register-adapters.ts';

function validateExchangeConfig(configPath: string) {
  try {
    const configData = JSON.parse(readFileSync(configPath, 'utf-8'));
    
    console.log(`🔍 Validating exchange configuration: ${configPath}\n`);
    
    let totalConfigs = 0;
    let validConfigs = 0;
    const allErrors: string[] = [];
    
    for (const [exchangeId, exchangeConfig] of Object.entries(configData)) {
      if (typeof exchangeConfig !== 'object' || !exchangeConfig) {
        continue;
      }
      
      const config = exchangeConfig as ExchangeConfig;
      config.id = exchangeId; // Ensure ID is set
      
      totalConfigs++;
      
      console.log(`📊 ${exchangeId.toUpperCase()}`);
      console.log('─'.repeat(30));
      
      const validation = ExchangeAdapterRegistry.validateConfig(config);
      
      if (validation.valid) {
        console.log('✅ Valid configuration');
        validConfigs++;
        
        // Show available capabilities
        const metadata = ExchangeAdapterRegistry.getMetadata(config.id, config.adapterType!);
        if (metadata) {
          console.log(`   📋 Adapter: ${metadata.displayName}`);
          console.log(`   🔧 Type: ${metadata.adapterType}`);
          
          const capabilities = Object.entries(metadata.capabilities)
            .filter(([_, value]) => value === true)
            .map(([key]) => key.replace(/^supports?/, '').replace(/^requires?/, ''))
            .join(', ');
          
          if (capabilities) {
            console.log(`   ⚡ Capabilities: ${capabilities}`);
          }
        }
      } else {
        console.log('❌ Invalid configuration');
        for (const error of validation.errors) {
          console.log(`   🚫 ${error}`);
          allErrors.push(`${exchangeId}: ${error}`);
        }
        
        // Show available adapters for this exchange
        const available = ExchangeAdapterRegistry.getAvailable(exchangeId);
        if (available.length > 0) {
          console.log(`   💡 Available adapters: ${available.map(a => a.adapterType).join(', ')}`);
        }
      }
      
      console.log();
    }
    
    console.log('📈 Summary');
    console.log('─'.repeat(30));
    console.log(`✅ Valid configurations: ${validConfigs}/${totalConfigs}`);
    console.log(`❌ Invalid configurations: ${totalConfigs - validConfigs}/${totalConfigs}`);
    
    if (allErrors.length > 0) {
      console.log(`\n🚫 All errors:`);
      for (const error of allErrors) {
        console.log(`   • ${error}`);
      }
      process.exit(1);
    } else {
      console.log('\n🎉 All configurations are valid!');
    }
    
  } catch (error) {
    console.error(`❌ Failed to validate config: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

function main() {
  const configPath = process.argv[2];
  
  if (!configPath) {
    console.error('Usage: node validate-exchange-config.js <config-file.json>');
    process.exit(1);
  }
  
  validateExchangeConfig(configPath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}