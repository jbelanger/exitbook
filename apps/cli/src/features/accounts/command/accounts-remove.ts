import { ok } from '@exitbook/foundation';
import type { Command } from 'commander';
import { z } from 'zod';

import { runCommand } from '../../../runtime/command-runtime.js';
import { CliCommandError } from '../../shared/cli-command-error.js';
import { parseCliCommandOptions, withCliCommandErrorHandling } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';
import { promptConfirm } from '../../shared/prompts.js';

import type { FlatAccountRemovePreview } from './account-removal-service.js';
import { requireCliResult } from './accounts-command-helpers.js';
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
  const { format, options } = parseCliCommandOptions(
    ACCOUNTS_REMOVE_COMMAND_ID,
    rawOptions,
    AccountsRemoveCommandOptionsSchema
  );

  await withCliCommandErrorHandling(ACCOUNTS_REMOVE_COMMAND_ID, format, async () => {
    await runCommand(async (ctx) => {
      if (options.json && !options.confirm) {
        throw new CliCommandError(
          '--confirm is required when using --json for destructive account removal',
          ExitCodes.INVALID_ARGS
        );
      }

      requireCliResult(
        await withAccountsRemoveCommandScope(ctx, async (scope) => {
          const { accountIds, accountName, preview } = requireCliResult(
            await prepareAccountRemoval(scope, name),
            ExitCodes.GENERAL_ERROR
          );

          if (!options.confirm && !options.json) {
            outputRemovalPreview(accountName, preview);
            const shouldProceed = await promptConfirm(`Delete account ${accountName} and all attached data?`, false);
            if (!shouldProceed) {
              console.error('Account removal cancelled');
              process.exit(0);
            }
          }

          const removal = requireCliResult(await runAccountRemoval(scope, accountIds), ExitCodes.GENERAL_ERROR);

          if (options.json) {
            outputSuccess(ACCOUNTS_REMOVE_COMMAND_ID, {
              accountName,
              deleted: removal.deleted,
              profile: scope.profile.profileKey,
            });
          } else {
            console.log(`Removed account ${accountName}`);
          }

          return ok(undefined);
        }),
        ExitCodes.GENERAL_ERROR
      );
    });
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
