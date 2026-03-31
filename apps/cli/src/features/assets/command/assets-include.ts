import type { Command } from 'commander';

import { jsonSuccess, textSuccess } from '../../../cli/command.js';
import type { CliOutputFormat } from '../../../cli/options.js';
import { formatSuccessLine } from '../../../cli/success.js';

import { executeAssetOverrideCommand } from './asset-override-command.js';
import { AssetsIncludeCommandOptionsSchema } from './assets-option-schemas.js';
import type { AssetOverrideResult } from './assets-types.js';
import { runAssetsInclude } from './run-assets.js';

export function registerAssetsIncludeCommand(assetsCommand: Command): void {
  assetsCommand
    .command('include')
    .description('Re-include a previously excluded asset in accounting-scoped processing')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook assets include --asset-id blockchain:ethereum:0xa0b8...
  $ exitbook assets include --symbol USDC
  $ exitbook assets include --symbol USDC --reason "Verified legitimate contract"
  $ exitbook assets include --asset-id blockchain:solana:mint123 --json

Notes:
  - Re-inclusion only affects assets that were previously excluded from accounting.
`
    )
    .option('--asset-id <asset-id>', 'Exact asset ID (e.g., blockchain:ethereum:0xa0b8...)')
    .option('--symbol <symbol>', 'Asset symbol when it resolves to exactly one stored asset ID')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeAssetsIncludeCommand(rawOptions);
    });
}

async function executeAssetsIncludeCommand(rawOptions: unknown): Promise<void> {
  await executeAssetOverrideCommand(
    'assets-include',
    rawOptions,
    AssetsIncludeCommandOptionsSchema,
    (scope, options) =>
      runAssetsInclude(scope, {
        assetId: options.assetId,
        symbol: options.symbol,
        reason: options.reason,
      }),
    buildAssetsIncludeCompletion
  );
}

function buildAssetsIncludeCompletion(format: CliOutputFormat, result: AssetOverrideResult) {
  if (format === 'json') {
    return jsonSuccess(result);
  }

  return textSuccess(() => {
    if (!result.changed) {
      console.log(formatSuccessLine('Asset is already included in accounting'));
    } else {
      console.log(formatSuccessLine('Asset included in accounting'));
    }

    console.log(`   Asset ID: ${result.assetId}`);
    console.log(`   Symbols: ${result.assetSymbols.length > 0 ? result.assetSymbols.join(', ') : '(unknown)'}`);
    if (result.reason) {
      console.log(`   Reason: ${result.reason}`);
    }
  });
}
