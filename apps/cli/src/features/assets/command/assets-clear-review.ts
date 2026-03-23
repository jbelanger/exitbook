import { OverrideStore } from '@exitbook/data';
import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-scope.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { AssetsClearReviewCommandOptionsSchema } from '../../shared/schemas.js';

import { AssetsHandler, type AssetReviewOverrideResult } from './assets-handler.js';

export function registerAssetsClearReviewCommand(assetsCommand: Command): void {
  assetsCommand
    .command('clear-review')
    .description('Clear a prior review confirmation for an asset')
    .option('--asset-id <asset-id>', 'Exact asset ID (e.g., blockchain:ethereum:0xa0b8...)')
    .option('--symbol <symbol>', 'Asset symbol when it resolves to exactly one stored asset ID')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeAssetsClearReviewCommand(rawOptions);
    });
}

async function executeAssetsClearReviewCommand(rawOptions: unknown): Promise<void> {
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  const parseResult = AssetsClearReviewCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'assets-clear-review',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJsonMode ? 'json' : 'text'
    );
  }

  const options = parseResult.data;

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const overrideStore = new OverrideStore(ctx.dataDir);
      const handler = new AssetsHandler(database, overrideStore, ctx.dataDir);
      const result = await handler.clearReview({
        assetId: options.assetId,
        symbol: options.symbol,
        reason: options.reason,
      });

      if (result.isErr()) {
        displayCliError('assets-clear-review', result.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      handleAssetsClearReviewSuccess(options.json ?? false, result.value);
    });
  } catch (error) {
    displayCliError(
      'assets-clear-review',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
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
