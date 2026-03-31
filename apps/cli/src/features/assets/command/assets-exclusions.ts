import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { captureCliRuntimeResult, runCliCommandBoundary } from '../../shared/cli-boundary.js';
import { jsonSuccess, textSuccess, toCliResult, type CliCommandResult } from '../../shared/cli-contract.js';
import { detectCliOutputFormat, type CliOutputFormat } from '../../shared/cli-output-format.js';
import { parseCliCommandOptionsResult } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';

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

  await runCliCommandBoundary({
    command: 'assets-exclusions',
    format,
    action: async () =>
      resultDoAsync(async function* () {
        yield* parseCliCommandOptionsResult(rawOptions, AssetsExclusionsCommandOptionsSchema);
        return yield* await executeAssetsExclusionsCommandResult(format);
      }),
  });
}

async function executeAssetsExclusionsCommandResult(format: CliOutputFormat): Promise<CliCommandResult> {
  return captureCliRuntimeResult({
    command: 'assets-exclusions',
    action: async (ctx) =>
      resultDoAsync(async function* () {
        const result = yield* toCliResult(
          await withAssetsCommandScope(ctx, runAssetsExclusions),
          ExitCodes.GENERAL_ERROR
        );
        return buildAssetsExclusionsCompletion(format, result);
      }),
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
