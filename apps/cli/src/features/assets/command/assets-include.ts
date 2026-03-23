import { OverrideStore } from '@exitbook/data';
import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-scope.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';

import { AssetsHandler, type AssetOverrideResult } from './assets-handler.js';
import { AssetsIncludeCommandOptionsSchema } from './assets-option-schemas.js';

export function registerAssetsIncludeCommand(assetsCommand: Command): void {
  assetsCommand
    .command('include')
    .description('Re-include a previously excluded asset in accounting-scoped processing')
    .option('--asset-id <asset-id>', 'Exact asset ID (e.g., blockchain:ethereum:0xa0b8...)')
    .option('--symbol <symbol>', 'Asset symbol when it resolves to exactly one stored asset ID')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeAssetsIncludeCommand(rawOptions);
    });
}

async function executeAssetsIncludeCommand(rawOptions: unknown): Promise<void> {
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  const parseResult = AssetsIncludeCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'assets-include',
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
      const result = await handler.include({
        assetId: options.assetId,
        symbol: options.symbol,
        reason: options.reason,
      });

      if (result.isErr()) {
        displayCliError('assets-include', result.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      handleAssetsIncludeSuccess(options.json ?? false, result.value);
    });
  } catch (error) {
    displayCliError(
      'assets-include',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}

function handleAssetsIncludeSuccess(isJsonMode: boolean, result: AssetOverrideResult): void {
  if (isJsonMode) {
    outputSuccess('assets-include', result);
    return;
  }

  if (!result.changed) {
    console.log('Asset is already included in accounting');
  } else {
    console.log('✅ Asset included in accounting');
  }

  console.log(`   Asset ID: ${result.assetId}`);
  console.log(`   Symbols: ${result.assetSymbols.length > 0 ? result.assetSymbols.join(', ') : '(unknown)'}`);
  if (result.reason) {
    console.log(`   Reason: ${result.reason}`);
  }
}
