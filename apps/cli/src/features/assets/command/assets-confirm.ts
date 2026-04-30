import type { Command } from 'commander';

import { jsonSuccess, textSuccess } from '../../../cli/command.js';
import type { CliOutputFormat } from '../../../cli/options.js';
import { formatSuccessLine } from '../../../cli/success.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { executeAssetOverrideCommand } from './asset-override-command.js';
import { AssetsConfirmCommandOptionsSchema } from './assets-option-schemas.js';
import type { AssetReviewOverrideResult } from './assets-types.js';
import { runAssetsConfirmReview } from './run-assets.js';

export function registerAssetsConfirmCommand(assetsCommand: Command, appRuntime: CliAppRuntime): void {
  assetsCommand
    .command('confirm')
    .description('Confirm the current review evidence for a suspicious asset')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook assets confirm --asset-id blockchain:ethereum:0xa0b8...
  $ exitbook assets confirm --symbol USDC
  $ exitbook assets confirm --symbol USDC --reason "Reviewed issuer and contract"
  $ exitbook assets confirm --asset-id blockchain:solana:EPjFWd... --json

Notes:
  - Use either --asset-id or --symbol.
  - Confirming review evidence does not automatically clear all accounting blocks if ambiguity remains.
`
    )
    .option('--asset-id <asset-id>', 'Exact asset ID (e.g., blockchain:ethereum:0xa0b8...)')
    .option('--symbol <symbol>', 'Asset symbol when it resolves to exactly one stored asset ID')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeAssetsConfirmCommand(rawOptions, appRuntime);
    });
}

async function executeAssetsConfirmCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  await executeAssetOverrideCommand(
    'assets-confirm',
    appRuntime,
    rawOptions,
    AssetsConfirmCommandOptionsSchema,
    (scope, options) =>
      runAssetsConfirmReview(scope, {
        assetId: options.assetId,
        symbol: options.symbol,
        reason: options.reason,
      }),
    buildAssetsConfirmCompletion
  );
}

function buildAssetsConfirmCompletion(format: CliOutputFormat, result: AssetReviewOverrideResult) {
  if (format === 'json') {
    return jsonSuccess(result);
  }

  return textSuccess(() => {
    if (!result.changed) {
      console.log(formatSuccessLine('Asset review is already confirmed for the current evidence'));
    } else {
      console.log(formatSuccessLine('Asset review confirmed'));
    }

    console.log(`   Asset ID: ${result.assetId}`);
    console.log(`   Symbols: ${result.assetSymbols.length > 0 ? result.assetSymbols.join(', ') : '(unknown)'}`);
    console.log(`   Review Status: ${result.reviewStatus}`);
    console.log(`   Accounting: ${result.accountingBlocked ? 'blocked' : 'allowed'}`);
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

    if (result.accountingBlocked) {
      const hasAmbiguity = result.evidence.some((e) => e.kind === 'same-symbol-ambiguity');
      if (hasAmbiguity) {
        console.log('');
        console.log(
          'Confirmation recorded, but accounting is still blocked until one conflicting contract is excluded.'
        );
        console.log('Run: assets exclude --asset-id <conflicting-asset-id>');
      } else {
        console.log('');
        console.log('Confirmation recorded, but accounting is still blocked due to unresolved evidence.');
      }
    }
  });
}
