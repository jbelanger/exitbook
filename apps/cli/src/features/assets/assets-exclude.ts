import { OverrideStore } from '@exitbook/data';
import type { Command } from 'commander';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { AssetsExcludeCommandOptionsSchema } from '../shared/schemas.js';

import { AssetsHandler, type AssetOverrideResult } from './assets-handler.js';

export type AssetsExcludeCommandOptions = z.infer<typeof AssetsExcludeCommandOptionsSchema>;

export function registerAssetsExcludeCommand(assetsCommand: Command): void {
  assetsCommand
    .command('exclude')
    .description('Exclude an asset from accounting-scoped cost basis and portfolio processing')
    .option('--asset-id <asset-id>', 'Exact asset ID (e.g., blockchain:ethereum:0xa0b8...)')
    .option('--symbol <symbol>', 'Asset symbol when it resolves to exactly one stored asset ID')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeAssetsExcludeCommand(rawOptions);
    });
}

async function executeAssetsExcludeCommand(rawOptions: unknown): Promise<void> {
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  const parseResult = AssetsExcludeCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'assets-exclude',
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
      const handler = new AssetsHandler(database, overrideStore);
      const result = await handler.exclude({
        assetId: options.assetId,
        symbol: options.symbol,
        reason: options.reason,
      });

      if (result.isErr()) {
        displayCliError('assets-exclude', result.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      handleAssetsExcludeSuccess(options.json ?? false, result.value);
    });
  } catch (error) {
    displayCliError(
      'assets-exclude',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}

function handleAssetsExcludeSuccess(isJsonMode: boolean, result: AssetOverrideResult): void {
  if (isJsonMode) {
    outputSuccess('assets-exclude', result);
    return;
  }

  if (!result.changed) {
    console.log('Asset is already excluded from accounting');
  } else {
    console.log('✅ Asset excluded from accounting');
  }

  console.log(`   Asset ID: ${result.assetId}`);
  console.log(`   Symbols: ${result.assetSymbols.length > 0 ? result.assetSymbols.join(', ') : '(unknown)'}`);
  if (result.reason) {
    console.log(`   Reason: ${result.reason}`);
  }
}
