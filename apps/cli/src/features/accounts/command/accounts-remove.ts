import { err, ok } from '@exitbook/foundation';
import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { promptConfirm } from '../../shared/prompts.js';

import type { FlatAccountRemovePreview } from './account-removal-service.js';
import { withAccountsRemoveCommandScope } from './accounts-remove-command-scope.js';
import { prepareAccountRemoval, runAccountRemoval } from './run-accounts-remove.js';

export function registerAccountsRemoveCommand(accountsCommand: Command): void {
  accountsCommand
    .command('remove')
    .description('Remove a named account, purge its imported data, and reset affected projections')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts remove kraken-main
  $ exitbook accounts remove kraken-main --confirm
  $ exitbook accounts remove kraken-main --confirm --json

Notes:
  - This deletes the named account, attached raw data, and affected derived projections.
  - --confirm is required with --json because JSON mode cannot prompt interactively.
`
    )
    .argument('<name>', 'Account name')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--json', 'Output results in JSON format')
    .action(async (name: string, options: { confirm?: boolean | undefined; json?: boolean | undefined }) => {
      const format = options.json ? 'json' : 'text';

      try {
        await runCommand(async (ctx) => {
          if (options.json && !options.confirm) {
            displayCliError(
              'accounts-remove',
              new Error('--confirm is required when using --json for destructive account removal'),
              ExitCodes.INVALID_ARGS,
              format
            );
            return;
          }

          const commandResult = await withAccountsRemoveCommandScope(ctx, async (scope) => {
            const preparationResult = await prepareAccountRemoval(scope, name);
            if (preparationResult.isErr()) {
              return err(preparationResult.error);
            }

            const { accountIds, accountName, preview } = preparationResult.value;

            if (!options.confirm && !options.json) {
              outputRemovalPreview(accountName, preview);
              const shouldProceed = await promptConfirm(`Delete account ${accountName} and all attached data?`, false);
              if (!shouldProceed) {
                console.error('Account removal cancelled');
                process.exit(0);
              }
            }

            const removeResult = await runAccountRemoval(scope, accountIds);
            if (removeResult.isErr()) {
              return err(removeResult.error);
            }

            if (options.json) {
              outputSuccess('accounts-remove', {
                accountName,
                deleted: removeResult.value.deleted,
                profile: scope.profile.profileKey,
              });
            } else {
              console.log(`Removed account ${accountName}`);
            }

            return ok(undefined);
          });

          if (commandResult.isErr()) {
            displayCliError('accounts-remove', commandResult.error, ExitCodes.GENERAL_ERROR, format);
          }
        });
      } catch (error) {
        displayCliError(
          'accounts-remove',
          error instanceof Error ? error : new Error(String(error)),
          ExitCodes.GENERAL_ERROR,
          format
        );
      }
    });
}

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
