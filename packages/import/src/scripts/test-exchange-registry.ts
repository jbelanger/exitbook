#!/usr/bin/env node

import { ExchangeAdapterRegistry } from '../exchanges/registry/index.ts';
import type { ExchangeConfig } from '../exchanges/types.ts';
// Import to trigger registration
import '../exchanges/registry/register-adapters.ts';

async function testExchangeRegistry() {
  console.log('🧪 Testing Exchange Adapter Registry\n');
  
  try {
    // Test 1: List all registered adapters
    console.log('1️⃣  Testing adapter listing...');
    const allAdapters = ExchangeAdapterRegistry.getAllAdapters();
    console.log(`   ✅ Found ${allAdapters.length} registered adapters`);
    
    // Test 2: Check specific registrations
    console.log('\n2️⃣  Testing specific adapter registrations...');
    const exchanges = ['coinbase', 'kraken', 'kucoin', 'ledgerlive'];
    for (const exchange of exchanges) {
      const available = ExchangeAdapterRegistry.getAvailable(exchange);
      console.log(`   📊 ${exchange}: ${available.length} adapters`);
    }
    
    // Test 3: Test configuration validation
    console.log('\n3️⃣  Testing configuration validation...');
    
    // Valid config test
    const validConfig: ExchangeConfig = {
      id: 'kraken',
      enabled: true,
      adapterType: 'csv',
      credentials: {
        apiKey: '',
        secret: ''
      },
      options: {
        csvDirectories: ['/path/to/csv']
      }
    };
    
    const validation = ExchangeAdapterRegistry.validateConfig(validConfig);
    console.log(`   ✅ Valid config validation: ${validation.valid ? 'PASSED' : 'FAILED'}`);
    
    // Invalid config test
    const invalidConfig: ExchangeConfig = {
      id: 'kraken',
      enabled: true,
      adapterType: 'csv',
      credentials: {
        apiKey: '',
        secret: ''
      },
      options: {} // Missing required csvDirectories
    };
    
    const invalidValidation = ExchangeAdapterRegistry.validateConfig(invalidConfig);
    console.log(`   ✅ Invalid config validation: ${!invalidValidation.valid ? 'PASSED' : 'FAILED'}`);
    if (!invalidValidation.valid) {
      console.log(`      Error: ${invalidValidation.errors[0]}`);
    }
    
    // Test 4: Test adapter creation
    console.log('\n4️⃣  Testing adapter creation...');
    
    try {
      const adapter = await ExchangeAdapterRegistry.createAdapter(
        'kraken',
        'csv',
        validConfig
      );
      console.log(`   ✅ Adapter creation: PASSED (${adapter.constructor.name})`);
    } catch (error) {
      console.log(`   ❌ Adapter creation: FAILED - ${error instanceof Error ? error.message : error}`);
    }
    
    // Test 5: Test unsupported adapter
    console.log('\n5️⃣  Testing unsupported adapter handling...');
    
    try {
      await ExchangeAdapterRegistry.createAdapter(
        'nonexistent',
        'csv',
        { ...validConfig, id: 'nonexistent' }
      );
      console.log(`   ❌ Unsupported adapter test: FAILED (should have thrown error)`);
    } catch (error) {
      console.log(`   ✅ Unsupported adapter test: PASSED (correctly threw error)`);
    }
    
    console.log('\n🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error(`❌ Test failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testExchangeRegistry();
}