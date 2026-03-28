import { OverrideStore } from '@exitbook/data/overrides';
import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';

import { AssetsHandler, type AssetExclusionsResult } from './assets-handler.js';
import { AssetsExclusionsCommandOptionsSchema } from './assets-option-schemas.js';

export function registerAssetsExclusionsCommand(assetsCommand: Command): void {
  assetsCommand
    .command('exclusions')
    .description('List asset IDs currently excluded from accounting')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook assets exclusions
  $ exitbook assets exclusions --json

Notes:
  - Use "assets include" to re-enable any listed asset.
`
    )
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeAssetsExclusionsCommand(rawOptions);
    });
}

async function executeAssetsExclusionsCommand(rawOptions: unknown): Promise<void> {
  const { format } = parseCliCommandOptions('assets-exclusions', rawOptions, AssetsExclusionsCommandOptionsSchema);

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        displayCliError('assets-exclusions', profileResult.error, ExitCodes.GENERAL_ERROR, format);
      }

      const overrideStore = new OverrideStore(ctx.dataDir);
      const handler = new AssetsHandler(database, overrideStore, ctx.dataDir);
      const result = await handler.listExclusions(profileResult.value.id, profileResult.value.profileKey);

      if (result.isErr()) {
        displayCliError('assets-exclusions', result.error, ExitCodes.GENERAL_ERROR, format);
      }

      handleAssetsExclusionsSuccess(format === 'json', result.value);
    });
  } catch (error) {
    displayCliError(
      'assets-exclusions',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      format
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
