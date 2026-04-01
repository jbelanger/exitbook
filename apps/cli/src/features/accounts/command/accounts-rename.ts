import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import {
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  toCliValue,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { formatSuccessLine } from '../../../cli/success.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';
import { createCliAccountLifecycleService } from '../account-service.js';

const ACCOUNTS_RENAME_COMMAND_ID = 'accounts-rename';

export function registerAccountsRenameCommand(accountsCommand: Command): void {
  accountsCommand
    .command('rename')
    .description('Rename an account')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts rename kraken-main kraken-primary
  $ exitbook accounts rename wallet-main treasury-wallet
  $ exitbook accounts rename kraken-main kraken-primary --json

Notes:
  - Renaming keeps the underlying account data and import history intact.
  - Account names must remain unique within a profile.
  - Reserved command words such as add, list, remove, rename, update, and view cannot be used as account names.
`
    )
    .argument('<current-name>', 'Existing account name')
    .argument('<next-name>', 'New account name')
    .option('--json', 'Output results in JSON format')
    .action(async (currentName: string, nextName: string, rawOptions: unknown) => {
      await executeRenameAccountCommand(currentName, nextName, rawOptions);
    });
}

async function executeRenameAccountCommand(currentName: string, nextName: string, rawOptions: unknown): Promise<void> {
  await runCliRuntimeCommand({
    command: ACCOUNTS_RENAME_COMMAND_ID,
    format: detectCliOutputFormat(rawOptions),
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, JsonFlagSchema);
      }),
    action: async (context) =>
      resultDoAsync(async function* () {
        const db = await context.runtime.database();
        const profile = yield* toCliResult(await resolveCommandProfile(context.runtime, db), ExitCodes.GENERAL_ERROR);
        const account = yield* toCliResult(
          await createCliAccountLifecycleService(db).rename(profile.id, currentName, nextName),
          ExitCodes.GENERAL_ERROR
        );
        const payload = {
          account: {
            id: account.id,
            name: account.name,
            platformKey: account.platformKey,
          },
          profile: profile.profileKey,
        };

        if (context.prepared.json) {
          return jsonSuccess(payload);
        }

        const renamedAccountName = yield* toCliValue(
          account.name,
          `Renamed account ${account.id} is missing a top-level name`,
          ExitCodes.GENERAL_ERROR
        );

        return textSuccess(() => {
          console.log(formatSuccessLine(`Renamed account ${currentName} to ${renamedAccountName}`));
        });
      }),
  });
}
