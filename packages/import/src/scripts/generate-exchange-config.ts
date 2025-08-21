#!/usr/bin/env tsx

/**
 * Generate exchange configuration template from registered adapters
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ExchangeAdapterRegistry } from '../exchanges/registry/index.ts';

// Import all exchange adapters to trigger registration
import '../exchanges/registry/register-adapters.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateExchangeConfiguration(): void {
  console.log('🔧 Generating Exchange Configuration Template\n');

  const allAdapters = ExchangeAdapterRegistry.getAllAdapters();

  if (allAdapters.length === 0) {
    console.log('❌ No exchange adapters found. Ensure adapter files are imported.');
    process.exit(1);
  }

  // Group adapters by exchange
  const adaptersByExchange = new Map<string, typeof allAdapters>();

  for (const adapter of allAdapters) {
    if (!adaptersByExchange.has(adapter.exchangeId)) {
      adaptersByExchange.set(adapter.exchangeId, []);
    }
    adaptersByExchange.get(adapter.exchangeId)!.push(adapter);
  }

  // Generate configuration object
  const config: any = {};

  for (const [exchangeId, adapters] of adaptersByExchange.entries()) {
    // Sort adapters by priority (ccxt, native, universal)
    const sortedAdapters = adapters.sort((a, b) => {
      const priority = { ccxt: 1, native: 2, universal: 3 };
      return (priority[a.adapterType as keyof typeof priority] || 99) - 
             (priority[b.adapterType as keyof typeof priority] || 99);
    });

    // Use the first adapter as the default
    const defaultAdapter = sortedAdapters[0];

    const exchangeConfig: any = {
      id: exchangeId,
      name: defaultAdapter.displayName,
      enabled: true,
      adapterType: defaultAdapter.adapterType,
      
      ...(defaultAdapter.description && {
        description: defaultAdapter.description
      }),

      // Credentials section (common for all adapter types)
      credentials: {},

      // Options section
      options: {
        ...(defaultAdapter.defaultConfig && {
          ...defaultAdapter.defaultConfig
        })
      },

      // Available adapters info
      availableAdapters: sortedAdapters.map(adapter => ({
        type: adapter.adapterType,
        displayName: adapter.displayName,
        capabilities: adapter.capabilities,
        ...(adapter.configValidation?.requiredCredentials && {
          requiredCredentials: adapter.configValidation.requiredCredentials
        }),
        ...(adapter.configValidation?.requiredOptions && {
          requiredOptions: adapter.configValidation.requiredOptions
        })
      }))
    };

    // Add required credentials template
    if (defaultAdapter.configValidation?.requiredCredentials) {
      for (const credential of defaultAdapter.configValidation.requiredCredentials) {
        exchangeConfig.credentials[credential] = `process.env.${exchangeId.toUpperCase()}_${credential.toUpperCase()}`;
      }
    }

    // Add required options template
    if (defaultAdapter.configValidation?.requiredOptions) {
      for (const option of defaultAdapter.configValidation.requiredOptions) {
        if (!exchangeConfig.options[option]) {
          exchangeConfig.options[option] = `TODO: Configure ${option}`;
        }
      }
    }

    config[exchangeId] = exchangeConfig;
  }

  // Write configuration file
  const configPath = path.join(__dirname, '../../config/exchanges-template.json');
  const configJson = JSON.stringify(config, null, 2);

  try {
    // Ensure config directory exists
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, configJson);

    console.log('✅ Exchange configuration template generated successfully!');
    console.log(`📄 File: ${configPath}`);
    console.log(`📊 Generated ${Object.keys(config).length} exchanges with ${allAdapters.length} total adapters\n`);

    // Show summary
    console.log('📋 Generated Configuration:');
    console.log('─'.repeat(50));

    for (const [exchangeId, exchangeConfig] of Object.entries(config)) {
      const { adapterType, availableAdapters } = exchangeConfig as any;
      
      console.log(`${exchangeId.toUpperCase()}:`);
      console.log(`  Default adapter: ${adapterType}`);
      console.log(`  Available adapters: ${availableAdapters.map((a: any) => a.type).join(', ')}`);
      
      const credentials = Object.keys((exchangeConfig as any).credentials || {});
      if (credentials.length > 0) {
        console.log(`  Required credentials: ${credentials.join(', ')}`);
      }
      console.log('');
    }

    console.log('💡 Next steps:');
    console.log('  1. Review the generated template');
    console.log('  2. Copy to exchanges.json if needed');
    console.log('  3. Configure required environment variables:');

    // Show required environment variables
    const allCredentials = new Set<string>();
    Object.entries(config).forEach(([exchangeId, exchangeConfig]) => {
      const credentials = Object.keys((exchangeConfig as any).credentials || {});
      credentials.forEach(cred => {
        allCredentials.add(`${exchangeId.toUpperCase()}_${cred.toUpperCase()}`);
      });
    });

    if (allCredentials.size > 0) {
      allCredentials.forEach(envVar => {
        console.log(`     export ${envVar}="your_api_key_here"`);
      });
    }

    console.log('  4. Update adapter types and options as needed');
    console.log('  5. Run `pnpm run validate:exchange-config` to verify');

  } catch (error) {
    console.error('❌ Failed to write configuration file:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    generateExchangeConfiguration();
  } catch (error) {
    console.error('❌ Failed to generate exchange configuration:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export { generateExchangeConfiguration };