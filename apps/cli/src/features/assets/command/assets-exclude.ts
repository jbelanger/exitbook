import type { Command } from 'commander';

import { outputSuccess } from '../../shared/json-output.js';

import { executeAssetOverrideCommand } from './asset-override-command.js';
import { AssetsExcludeCommandOptionsSchema } from './assets-option-schemas.js';
import type { AssetOverrideResult } from './assets-types.js';
import { runAssetsExclude } from './run-assets.js';

export function registerAssetsExcludeCommand(assetsCommand: Command): void {
  assetsCommand
    .command('exclude')
    .description('Exclude an asset from accounting-scoped cost basis and portfolio processing')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook assets exclude --asset-id blockchain:ethereum:0xa0b8...
  $ exitbook assets exclude --symbol USDC
  $ exitbook assets exclude --symbol USDC --reason "Spam token"
  $ exitbook assets exclude --asset-id blockchain:solana:mint123 --json

Notes:
  - Exclusion removes the asset from accounting-scoped cost basis and portfolio calculations.
`
    )
    .option('--asset-id <asset-id>', 'Exact asset ID (e.g., blockchain:ethereum:0xa0b8...)')
    .option('--symbol <symbol>', 'Asset symbol when it resolves to exactly one stored asset ID')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeAssetsExcludeCommand(rawOptions);
    });
}

async function executeAssetsExcludeCommand(rawOptions: unknown): Promise<void> {
  await executeAssetOverrideCommand(
    'assets-exclude',
    rawOptions,
    AssetsExcludeCommandOptionsSchema,
    (scope, options) =>
      runAssetsExclude(scope, {
        assetId: options.assetId,
        symbol: options.symbol,
        reason: options.reason,
      }),
    handleAssetsExcludeSuccess
  );
}

function handleAssetsExcludeSuccess(isJsonMode: boolean, result: AssetOverrideResult): void {
  if (isJsonMode) {
    outputSuccess('assets-exclude', result);
    return;
  }

  if (!result.changed) {
    console.log('Asset is already excluded from accounting');
  } else {
    console.log('✓ Asset excluded from accounting');
  }

  console.log(`   Asset ID: ${result.assetId}`);
  console.log(`   Symbols: ${result.assetSymbols.length > 0 ? result.assetSymbols.join(', ') : '(unknown)'}`);
  if (result.reason) {
    console.log(`   Reason: ${result.reason}`);
  }
}
