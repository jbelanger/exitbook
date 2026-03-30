import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import { z } from 'zod';

import { captureCliRuntimeResult, runCliCommandBoundary } from '../../shared/cli-boundary.js';
import { cliErr, jsonSuccess, textSuccess, toCliResult } from '../../shared/cli-contract.js';
import { detectCliOutputFormat } from '../../shared/cli-output-format.js';
import { parseCliCommandOptionsResult } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';
import { promptConfirm } from '../../shared/prompts.js';

import type { FlatAccountRemovePreview } from './account-removal-service.js';
import { withAccountsRemoveCommandScope } from './accounts-remove-command-scope.js';
import { prepareAccountRemoval, runAccountRemoval } from './run-accounts-remove.js';

const ACCOUNTS_REMOVE_COMMAND_ID = 'accounts-remove';

export function registerAccountsRemoveCommand(accountsCommand: Command): void {
  accountsCommand
    .command('remove')
    .description('Remove an account, purge its imported data, and reset affected projections')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts remove kraken-main
  $ exitbook accounts remove kraken-main --confirm
  $ exitbook accounts remove kraken-main --confirm --json

Notes:
  - This deletes the account, attached raw data, and affected derived projections.
  - --confirm is required with --json because JSON mode cannot prompt interactively.
`
    )
    .argument('<name>', 'Account name')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--json', 'Output results in JSON format')
    .action(async (name: string, rawOptions: unknown) => {
      await executeRemoveAccountCommand(name, rawOptions);
    });
}

async function executeRemoveAccountCommand(name: string, rawOptions: unknown): Promise<void> {
  await runCliCommandBoundary({
    command: ACCOUNTS_REMOVE_COMMAND_ID,
    format: detectCliOutputFormat(rawOptions),
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, AccountsRemoveCommandOptionsSchema);

        if (options.json && !options.confirm) {
          return yield* cliErr(
            '--confirm is required when using --json for destructive account removal',
            ExitCodes.INVALID_ARGS
          );
        }

        return yield* await captureCliRuntimeResult({
          command: ACCOUNTS_REMOVE_COMMAND_ID,
          action: async (ctx) =>
            resultDoAsync(async function* () {
              return yield* toCliResult(
                await withAccountsRemoveCommandScope(ctx, async (scope) =>
                  resultDoAsync(async function* () {
                    const { accountIds, accountName, preview } = yield* await prepareAccountRemoval(scope, name);

                    if (!options.confirm && !options.json) {
                      outputRemovalPreview(accountName, preview);
                      const shouldProceed = await promptConfirm(
                        `Delete account ${accountName} and all attached data?`,
                        false
                      );
                      if (!shouldProceed) {
                        return textSuccess(() => {
                          console.error('Account removal cancelled');
                        });
                      }
                    }

                    const removal = yield* await runAccountRemoval(scope, accountIds);

                    if (options.json) {
                      return jsonSuccess({
                        accountName,
                        deleted: removal.deleted,
                        profile: scope.profile.profileKey,
                      });
                    }

                    return textSuccess(() => {
                      console.log(`Removed account ${accountName}`);
                    });
                  })
                ),
                ExitCodes.GENERAL_ERROR
              );
            }),
        });
      }),
  });
}

const AccountsRemoveCommandOptionsSchema = JsonFlagSchema.extend({
  confirm: z.boolean().optional(),
});

function outputRemovalPreview(accountName: string, preview: FlatAccountRemovePreview): void {
  console.error(`\nThis will remove account ${accountName}, delete attached imported data, and reset derived state:`);
  if (preview.accounts > 0) console.error(`  - ${preview.accounts} account rows`);
  if (preview.transactions > 0) console.error(`  - ${preview.transactions} processed transactions`);
  if (preview.links > 0) console.error(`  - ${preview.links} transaction links`);
  if (preview.assetReviewStates > 0) console.error(`  - ${preview.assetReviewStates} asset review states`);
  if (preview.balanceSnapshots > 0) console.error(`  - ${preview.balanceSnapshots} balance snapshots`);
  if (preview.balanceSnapshotAssets > 0) console.error(`  - ${preview.balanceSnapshotAssets} balance snapshot assets`);
  if (preview.costBasisSnapshots > 0) {
    console.error(`  - ${preview.costBasisSnapshots} global cost-basis snapshots`);
  }
  if (preview.sessions > 0) console.error(`  - ${preview.sessions} import sessions`);
  if (preview.rawData > 0) console.error(`  - ${preview.rawData} raw data items`);
  console.error('');
}
