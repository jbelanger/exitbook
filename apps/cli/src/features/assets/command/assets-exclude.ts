import { OverrideStore } from '@exitbook/data/overrides';
import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';

import { AssetsHandler, type AssetOverrideResult } from './assets-handler.js';
import { AssetsExcludeCommandOptionsSchema } from './assets-option-schemas.js';

export function registerAssetsExcludeCommand(assetsCommand: Command): void {
  assetsCommand
    .command('exclude')
    .description('Exclude an asset from accounting-scoped cost basis and portfolio processing')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook assets exclude --asset-id blockchain:ethereum:0xa0b8...
  $ exitbook assets exclude --symbol USDC
  $ exitbook assets exclude --symbol USDC --reason "Spam token"
  $ exitbook assets exclude --asset-id blockchain:solana:mint123 --json

Notes:
  - Exclusion removes the asset from accounting-scoped cost basis and portfolio calculations.
`
    )
    .option('--profile <profile>', 'Use a specific profile key instead of the active profile')
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
      const profileResult = await resolveCommandProfile(ctx, database, options.profile);
      if (profileResult.isErr()) {
        displayCliError('assets-exclude', profileResult.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      const overrideStore = new OverrideStore(ctx.dataDir);
      const handler = new AssetsHandler(database, overrideStore, ctx.dataDir);
      const result = await handler.exclude({
        assetId: options.assetId,
        profileId: profileResult.value.id,
        profileKey: profileResult.value.profileKey,
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
