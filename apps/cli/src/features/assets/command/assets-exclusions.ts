import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { jsonSuccess, runCliRuntimeCommand, textSuccess, toCliResult } from '../../../cli/command.js';
import { ExitCodes } from '../../../cli/exit-codes.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult, type CliOutputFormat } from '../../../cli/options.js';

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
    .action((rawOptions: unknown) => executeAssetsExclusionsCommand(rawOptions));
}

async function executeAssetsExclusionsCommand(rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'assets-exclusions',
    format,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, AssetsExclusionsCommandOptionsSchema),
    action: async (context) => {
      const runtime = context.runtime;

      return resultDoAsync(async function* () {
        const result = yield* toCliResult(
          await withAssetsCommandScope(runtime, runAssetsExclusions),
          ExitCodes.GENERAL_ERROR
        );
        return buildAssetsExclusionsCompletion(format, result);
      });
    },
  });
}

function buildAssetsExclusionsCompletion(format: CliOutputFormat, result: AssetExclusionsResult) {
  if (format === 'json') {
    return jsonSuccess(result);
  }

  return textSuccess(() => {
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
  });
}
