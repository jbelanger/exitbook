import { OverrideStore } from '@exitbook/data';
import type { Command } from 'commander';
import type { z } from 'zod';

import { displayCliError } from '../../shared/cli-error.js';
import { runCommand } from '../../shared/command-runtime.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { AssetsExclusionsCommandOptionsSchema } from '../../shared/schemas.js';

import { AssetsHandler, type AssetExclusionsResult } from './assets-handler.js';

export type AssetsExclusionsCommandOptions = z.infer<typeof AssetsExclusionsCommandOptionsSchema>;

export function registerAssetsExclusionsCommand(assetsCommand: Command): void {
  assetsCommand
    .command('exclusions')
    .description('List asset IDs currently excluded from accounting')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeAssetsExclusionsCommand(rawOptions);
    });
}

async function executeAssetsExclusionsCommand(rawOptions: unknown): Promise<void> {
  const parseResult = AssetsExclusionsCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'assets-exclusions',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      'text'
    );
  }

  const options = parseResult.data;

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const overrideStore = new OverrideStore(ctx.dataDir);
      const handler = new AssetsHandler(database, overrideStore);
      const result = await handler.listExclusions();

      if (result.isErr()) {
        displayCliError('assets-exclusions', result.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      handleAssetsExclusionsSuccess(options.json ?? false, result.value);
    });
  } catch (error) {
    displayCliError(
      'assets-exclusions',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}

function handleAssetsExclusionsSuccess(isJsonMode: boolean, result: AssetExclusionsResult): void {
  if (isJsonMode) {
    outputSuccess('assets-exclusions', result);
    return;
  }

  if (result.excludedAssets.length === 0) {
    console.log('No assets are currently excluded from accounting');
    return;
  }

  console.log(`Excluded assets (${result.excludedAssets.length}):`);
  for (const excludedAsset of result.excludedAssets) {
    const symbolText = excludedAsset.assetSymbols.length > 0 ? excludedAsset.assetSymbols.join(', ') : '(unknown)';
    console.log(
      `- ${symbolText}  ${excludedAsset.assetId}  ${excludedAsset.transactionCount} txs  ${excludedAsset.movementCount} movements`
    );
  }
}
