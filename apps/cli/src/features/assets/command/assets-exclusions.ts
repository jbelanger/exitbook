import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';

import { withAssetsCommandScope } from './assets-command-scope.js';
import { AssetsExclusionsCommandOptionsSchema } from './assets-option-schemas.js';
import type { AssetExclusionsResult } from './assets-types.js';
import { runAssetsExclusions } from './run-assets.js';

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
      const result = await withAssetsCommandScope(ctx, runAssetsExclusions);

      if (result.isErr()) {
        displayCliError('assets-exclusions', result.error, ExitCodes.GENERAL_ERROR, format);
        return;
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
