import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { CliCommandError } from '../../shared/cli-command-error.js';
import { parseCliCommandOptions, withCliCommandErrorHandling } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';
import { buildCliAccountLifecycleService } from '../account-service.js';

import { requireCliResult } from './accounts-command-helpers.js';

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
  const { format, options } = parseCliCommandOptions(ACCOUNTS_RENAME_COMMAND_ID, rawOptions, JsonFlagSchema);

  await withCliCommandErrorHandling(ACCOUNTS_RENAME_COMMAND_ID, format, async () => {
    await runCommand(async (ctx) => {
      const db = await ctx.database();
      const profile = requireCliResult(await resolveCommandProfile(ctx, db), ExitCodes.GENERAL_ERROR);
      const account = requireCliResult(
        await buildCliAccountLifecycleService(db).rename(profile.id, currentName, nextName),
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

      if (options.json) {
        outputSuccess(ACCOUNTS_RENAME_COMMAND_ID, payload);
        return;
      }

      const renamedAccountName = account.name ?? throwMissingRenamedAccountName(account.id);
      console.log(`Renamed account ${currentName.trim().toLowerCase()} to ${renamedAccountName}`);
    });
  });
}

function throwMissingRenamedAccountName(accountId: number): never {
  throw new CliCommandError(`Renamed account ${accountId} is missing a top-level name`, ExitCodes.GENERAL_ERROR);
}
