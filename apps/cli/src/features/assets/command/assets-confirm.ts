import { OverrideStore } from '@exitbook/data';
import type { Command } from 'commander';

import { displayCliError } from '../../shared/cli-error.js';
import { runCommand } from '../../shared/command-runtime.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { AssetsConfirmCommandOptionsSchema } from '../../shared/schemas.js';

import { AssetsHandler, type AssetReviewOverrideResult } from './assets-handler.js';

export function registerAssetsConfirmCommand(assetsCommand: Command): void {
  assetsCommand
    .command('confirm')
    .description('Confirm the current review evidence for a suspicious asset')
    .option('--asset-id <asset-id>', 'Exact asset ID (e.g., blockchain:ethereum:0xa0b8...)')
    .option('--symbol <symbol>', 'Asset symbol when it resolves to exactly one stored asset ID')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeAssetsConfirmCommand(rawOptions);
    });
}

async function executeAssetsConfirmCommand(rawOptions: unknown): Promise<void> {
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  const parseResult = AssetsConfirmCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'assets-confirm',
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
      const result = await handler.confirmReview({
        assetId: options.assetId,
        symbol: options.symbol,
        reason: options.reason,
      });

      if (result.isErr()) {
        displayCliError('assets-confirm', result.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      handleAssetsConfirmSuccess(options.json ?? false, result.value);
    });
  } catch (error) {
    displayCliError(
      'assets-confirm',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}

function handleAssetsConfirmSuccess(isJsonMode: boolean, result: AssetReviewOverrideResult): void {
  if (isJsonMode) {
    outputSuccess('assets-confirm', result);
    return;
  }

  if (!result.changed) {
    console.log('Asset review is already confirmed for the current evidence');
  } else {
    console.log('Asset review confirmed');
  }

  console.log(`   Asset ID: ${result.assetId}`);
  console.log(`   Symbols: ${result.assetSymbols.length > 0 ? result.assetSymbols.join(', ') : '(unknown)'}`);
  console.log(`   Review Status: ${result.reviewStatus}`);
  console.log(`   Accounting: ${result.accountingBlocked ? 'blocked' : 'allowed'}`);
  if (result.reason) {
    console.log(`   Reason: ${result.reason}`);
  }

  if (result.accountingBlocked) {
    const hasAmbiguity = result.evidence.some((e) => e.kind === 'same-symbol-ambiguity');
    if (hasAmbiguity) {
      console.log('');
      console.log('Confirmation recorded, but accounting is still blocked until one conflicting contract is excluded.');
      console.log('Run: assets exclude --asset-id <conflicting-asset-id>');
    } else {
      console.log('');
      console.log('Confirmation recorded, but accounting is still blocked due to unresolved evidence.');
    }
  }
}
