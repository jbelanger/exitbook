import type { Command } from 'commander';

import { outputSuccess } from '../../shared/json-output.js';

import { executeAssetOverrideCommand } from './asset-override-command.js';
import type { AssetReviewOverrideResult } from './assets-handler.js';
import { AssetsClearReviewCommandOptionsSchema } from './assets-option-schemas.js';
import { runAssetsClearReview } from './run-assets.js';

export function registerAssetsClearReviewCommand(assetsCommand: Command): void {
  assetsCommand
    .command('clear-review')
    .description('Clear a prior review confirmation for an asset')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook assets clear-review --asset-id blockchain:ethereum:0xa0b8...
  $ exitbook assets clear-review --symbol USDC
  $ exitbook assets clear-review --symbol USDC --reason "Reopened after metadata change"
  $ exitbook assets clear-review --asset-id blockchain:solana:EPjFWd... --json

Notes:
  - Use this when a previously confirmed asset needs manual review again.
`
    )
    .option('--asset-id <asset-id>', 'Exact asset ID (e.g., blockchain:ethereum:0xa0b8...)')
    .option('--symbol <symbol>', 'Asset symbol when it resolves to exactly one stored asset ID')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeAssetsClearReviewCommand(rawOptions);
    });
}

async function executeAssetsClearReviewCommand(rawOptions: unknown): Promise<void> {
  await executeAssetOverrideCommand(
    'assets-clear-review',
    rawOptions,
    AssetsClearReviewCommandOptionsSchema,
    (scope, options) =>
      runAssetsClearReview(scope, {
        assetId: options.assetId,
        symbol: options.symbol,
        reason: options.reason,
      }),
    handleAssetsClearReviewSuccess
  );
}

function handleAssetsClearReviewSuccess(isJsonMode: boolean, result: AssetReviewOverrideResult): void {
  if (isJsonMode) {
    outputSuccess('assets-clear-review', result);
    return;
  }

  if (!result.changed) {
    console.log('Asset review confirmation was already cleared');
  } else {
    console.log('Asset review confirmation cleared');
  }

  console.log(`   Asset ID: ${result.assetId}`);
  console.log(`   Symbols: ${result.assetSymbols.length > 0 ? result.assetSymbols.join(', ') : '(unknown)'}`);
  console.log(`   Review Status: ${result.reviewStatus}`);
  if (result.reason) {
    console.log(`   Reason: ${result.reason}`);
  }
}
