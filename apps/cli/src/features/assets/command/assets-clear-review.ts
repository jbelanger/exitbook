import type { Command } from 'commander';

import { jsonSuccess, textSuccess } from '../../../cli/command.js';
import type { CliOutputFormat } from '../../../cli/options.js';
import { formatSuccessLine } from '../../../cli/success.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { executeAssetOverrideCommand } from './asset-override-command.js';
import { AssetsClearReviewCommandOptionsSchema } from './assets-option-schemas.js';
import type { AssetReviewOverrideResult } from './assets-types.js';
import { runAssetsClearReview } from './run-assets.js';

export function registerAssetsClearReviewCommand(assetsCommand: Command, appRuntime: CliAppRuntime): void {
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
      await executeAssetsClearReviewCommand(rawOptions, appRuntime);
    });
}

async function executeAssetsClearReviewCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  await executeAssetOverrideCommand(
    'assets-clear-review',
    appRuntime,
    rawOptions,
    AssetsClearReviewCommandOptionsSchema,
    (scope, options) =>
      runAssetsClearReview(scope, {
        assetId: options.assetId,
        symbol: options.symbol,
        reason: options.reason,
      }),
    buildAssetsClearReviewCompletion
  );
}

function buildAssetsClearReviewCompletion(format: CliOutputFormat, result: AssetReviewOverrideResult) {
  if (format === 'json') {
    return jsonSuccess(result);
  }

  return textSuccess(() => {
    if (!result.changed) {
      console.log(formatSuccessLine('Asset review confirmation was already cleared'));
    } else {
      console.log(formatSuccessLine('Asset review confirmation cleared'));
    }

    console.log(`   Asset ID: ${result.assetId}`);
    console.log(`   Symbols: ${result.assetSymbols.length > 0 ? result.assetSymbols.join(', ') : '(unknown)'}`);
    console.log(`   Review Status: ${result.reviewStatus}`);
    if (result.reviewSummarySource !== 'refreshed') {
      console.log(`   Summary Source: ${result.reviewSummarySource}`);
    }
    if (result.reason) {
      console.log(`   Reason: ${result.reason}`);
    }
    if (result.warnings.length > 0) {
      console.log('');
      for (const warning of result.warnings) {
        console.log(`Warning: ${warning}`);
      }
    }
  });
}
