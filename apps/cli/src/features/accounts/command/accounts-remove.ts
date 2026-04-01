import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import { z } from 'zod';

import {
  cliErr,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { promptConfirmDecision } from '../../../cli/prompts.js';
import { formatSuccessLine } from '../../../cli/success.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';

import type { FlatAccountRemovePreview } from './account-removal-service.js';
import { withAccountsRemoveCommandScope } from './accounts-remove-command-scope.js';
import { AccountRemovalTargetNotFoundError } from './accounts-remove-errors.js';
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
  await runCliRuntimeCommand({
    command: ACCOUNTS_REMOVE_COMMAND_ID,
    format: detectCliOutputFormat(rawOptions),
    prepare: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, AccountsRemoveCommandOptionsSchema);

        if (options.json && !options.confirm) {
          return yield* cliErr(
            '--confirm is required when using --json for destructive account removal',
            ExitCodes.INVALID_ARGS
          );
        }

        return options;
      }),
    action: async (context) =>
      resultDoAsync(async function* () {
        return yield* await toAccountRemovalCliResult(
          withAccountsRemoveCommandScope(context.runtime, async (scope) =>
            resultDoAsync(async function* () {
              const { accountIds, accountName, preview } = yield* await prepareAccountRemoval(scope, name);

              if (!context.prepared.confirm && !context.prepared.json) {
                outputRemovalPreview(accountName, preview);
                const decision = await promptConfirmDecision(
                  `Delete account ${accountName} and all attached data?`,
                  false
                );
                if (decision !== 'confirmed') {
                  return textSuccess(
                    () => {
                      console.error('Account removal cancelled');
                    },
                    decision === 'cancelled' ? ExitCodes.CANCELLED : undefined
                  );
                }
              }

              const removal = yield* await runAccountRemoval(scope, accountIds);

              if (context.prepared.json) {
                return jsonSuccess({
                  accountName,
                  deleted: removal.deleted,
                  profile: scope.profile.profileKey,
                });
              }

              return textSuccess(() => {
                console.log(formatSuccessLine(`Removed account ${accountName}`));
              });
            })
          )
        );
      }),
  });
}

async function toAccountRemovalCliResult<T>(resultPromise: Promise<import('@exitbook/foundation').Result<T, Error>>) {
  const result = await resultPromise;

  if (result.isErr() && result.error instanceof AccountRemovalTargetNotFoundError) {
    return cliErr(result.error, ExitCodes.NOT_FOUND);
  }

  return toCliResult(result, ExitCodes.GENERAL_ERROR);
}

const AccountsRemoveCommandOptionsSchema = JsonFlagSchema.extend({
  confirm: z.boolean().optional(),
});

function outputRemovalPreview(accountName: string, preview: FlatAccountRemovePreview): void {
  console.error(`Removing account ${accountName} will also delete its imported data and clear related derived data:`);
  writeRemovalPreviewCount(preview.accounts, 'account row');
  writeRemovalPreviewCount(preview.transactions, 'processed transaction');
  writeRemovalPreviewCount(preview.links, 'transaction link');
  writeRemovalPreviewCount(preview.assetReviewStates, 'asset review state');
  writeRemovalPreviewCount(preview.balanceSnapshots, 'balance snapshot');
  writeRemovalPreviewCount(preview.balanceSnapshotAssets, 'balance snapshot asset');
  writeRemovalPreviewCount(preview.costBasisSnapshots, 'global cost-basis snapshot');
  writeRemovalPreviewCount(preview.sessions, 'import session');
  writeRemovalPreviewCount(preview.rawData, 'raw data item');
}

function writeRemovalPreviewCount(count: number, singularLabel: string, pluralLabel = `${singularLabel}s`): void {
  if (count <= 0) {
    return;
  }

  console.error(`  - ${count} ${count === 1 ? singularLabel : pluralLabel}`);
}
