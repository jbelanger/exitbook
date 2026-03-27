import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { promptConfirm } from '../../shared/prompts.js';
import { buildCliAccountLifecycleService } from '../account-service.js';

import {
  createAccountRemoveHandler,
  flattenAccountRemovePreview,
  type FlatAccountRemovePreview,
} from './accounts-remove-handler.js';

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
          }

          const db = await ctx.database();
          const profileResult = await resolveCommandProfile(ctx, db);
          if (profileResult.isErr()) {
            displayCliError('accounts-remove', profileResult.error, ExitCodes.GENERAL_ERROR, format);
          }

          const accountService = buildCliAccountLifecycleService(db);
          const accountResult = await accountService.getByName(profileResult.value.id, name);
          if (accountResult.isErr()) {
            displayCliError('accounts-remove', accountResult.error, ExitCodes.GENERAL_ERROR, format);
          }
          if (!accountResult.value) {
            displayCliError(
              'accounts-remove',
              new Error(`Account '${name.trim().toLowerCase()}' not found`),
              ExitCodes.GENERAL_ERROR,
              format
            );
          }

          const hierarchyResult = await accountService.collectHierarchy(accountResult.value.id);
          if (hierarchyResult.isErr()) {
            displayCliError('accounts-remove', hierarchyResult.error, ExitCodes.GENERAL_ERROR, format);
          }

          const removeHandler = createAccountRemoveHandler(db);
          const previewResult = await removeHandler.preview(hierarchyResult.value.map((account) => account.id));
          if (previewResult.isErr()) {
            displayCliError('accounts-remove', previewResult.error, ExitCodes.GENERAL_ERROR, format);
          }

          const flatPreview = flattenAccountRemovePreview(previewResult.value);

          if (!options.confirm && !options.json) {
            outputRemovalPreview(accountResult.value.name ?? name.trim().toLowerCase(), flatPreview);
            const shouldProceed = await promptConfirm(
              `Delete account ${accountResult.value.name ?? name.trim().toLowerCase()} and all attached data?`,
              false
            );
            if (!shouldProceed) {
              console.error('Account removal cancelled');
              process.exit(0);
            }
          }

          const removeResult = await removeHandler.execute(hierarchyResult.value.map((account) => account.id));
          if (removeResult.isErr()) {
            displayCliError('accounts-remove', removeResult.error, ExitCodes.GENERAL_ERROR, format);
          }

          if (options.json) {
            outputSuccess('accounts-remove', {
              accountName: accountResult.value.name,
              deleted: removeResult.value.deleted,
              profile: profileResult.value.profileKey,
            });
            return;
          }

          console.log(`Removed account ${accountResult.value.name}`);
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
