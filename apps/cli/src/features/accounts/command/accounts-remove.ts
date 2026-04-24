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
import { JsonFlagSchema } from '../../../cli/option-schema-primitives.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { promptConfirmDecision } from '../../../cli/prompts.js';
import { formatSuccessLine } from '../../../cli/success.js';
import { getAccountSelectorErrorExitCode } from '../account-selector.js';

import type { AccountRemovalImpactCounts } from './account-removal-service.js';
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
  $ exitbook accounts remove 6f4c0d1a2b
  $ exitbook accounts remove kraken-main --confirm
  $ exitbook accounts remove kraken-main --confirm --json

Notes:
  - This deletes the account, attached raw data, and affected derived projections.
  - The selector can be an account name or fingerprint prefix.
  - --confirm is required with --json because JSON mode cannot prompt interactively.
`
    )
    .argument('<selector>', 'Account selector (name or fingerprint prefix)')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--json', 'Output results in JSON format')
    .action(async (selector: string, rawOptions: unknown) => {
      await executeRemoveAccountCommand(selector, rawOptions);
    });
}

async function executeRemoveAccountCommand(selector: string, rawOptions: unknown): Promise<void> {
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
              const { accountIds, accountLabel, preview } = yield* await prepareAccountRemoval(scope, selector);

              if (!context.prepared.confirm && !context.prepared.json) {
                outputRemovalPreview(accountLabel, preview);
                const decision = await promptConfirmDecision(
                  `Delete account ${accountLabel} and the data shown above?`,
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
                  accountLabel,
                  deleted: removal.deleted,
                  profile: scope.profile.profileKey,
                });
              }

              return textSuccess(() => {
                console.log(formatSuccessLine(`Removed account ${accountLabel}`));
              });
            })
          )
        );
      }),
  });
}

async function toAccountRemovalCliResult<T>(resultPromise: Promise<import('@exitbook/foundation').Result<T, Error>>) {
  const result = await resultPromise;

  if (result.isErr()) {
    return cliErr(result.error, getAccountSelectorErrorExitCode(result.error));
  }

  return toCliResult(result, ExitCodes.GENERAL_ERROR);
}

const AccountsRemoveCommandOptionsSchema = JsonFlagSchema.extend({
  confirm: z.boolean().optional(),
});

function outputRemovalPreview(accountLabel: string, preview: AccountRemovalImpactCounts): void {
  console.error(`Deleting account ${accountLabel} will remove:`);
  writeRemovalPreviewCount(preview.accounts, 'account');

  outputRemovalPreviewSection('Imported data', [
    { count: preview.sessions, singularLabel: 'import session' },
    { count: preview.rawData, singularLabel: 'raw import data item' },
  ]);

  outputRemovalPreviewSection('Derived data', [
    { count: preview.transactions, singularLabel: 'transaction' },
    {
      count: preview.ledgerSourceActivities,
      singularLabel: 'ledger source activity',
      pluralLabel: 'ledger source activities',
    },
    { count: preview.links, singularLabel: 'transaction link' },
    { count: preview.assetReviewStates, singularLabel: 'review item' },
    {
      count: preview.balanceSnapshots + preview.balanceSnapshotAssets,
      singularLabel: 'balance',
    },
    { count: preview.costBasisSnapshots, singularLabel: 'cost basis snapshot' },
  ]);
}

function outputRemovalPreviewSection(
  heading: string,
  items: readonly { count: number; pluralLabel?: string | undefined; singularLabel: string }[]
): void {
  const visibleItems = items.filter((item) => item.count > 0);
  if (visibleItems.length === 0) {
    return;
  }

  console.error('');
  console.error(`${heading}:`);
  for (const item of visibleItems) {
    writeRemovalPreviewCount(item.count, item.singularLabel, item.pluralLabel);
  }
}

function writeRemovalPreviewCount(count: number, singularLabel: string, pluralLabel = `${singularLabel}s`): void {
  if (count <= 0) {
    return;
  }

  console.error(`  - ${count} ${count === 1 ? singularLabel : pluralLabel}`);
}
