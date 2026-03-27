import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { buildCliAccountLifecycleService } from '../account-service.js';
import { maskIdentifier } from '../query/account-query-utils.js';

import { buildUpdatedAccountDraft } from './account-draft-utils.js';
import { AccountUpdateCommandOptionsSchema } from './accounts-option-schemas.js';

export function registerAccountsUpdateCommand(accountsCommand: Command, appRuntime: CliAppRuntime): void {
  accountsCommand
    .command('update')
    .description('Update sync config for a named account')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts update kraken-main --api-key NEW_KEY --api-secret NEW_SECRET
  $ exitbook accounts update kucoin-csv --csv-dir ./exports/kucoin-2026
  $ exitbook accounts update wallet-main --provider blockchair
  $ exitbook accounts update wallet-xpub --xpub-gap 30

Notes:
  - Supply only the fields you want to change.
  - --xpub-gap can increase the stored gap limit for xpub accounts.
`
    )
    .argument('<name>', 'Account name')
    .option('--api-key <key>', 'New API key for exchange API accounts')
    .option('--api-secret <secret>', 'New API secret for exchange API accounts')
    .option('--api-passphrase <passphrase>', 'New API passphrase for exchange API accounts')
    .option('--csv-dir <path>', 'New CSV directory for exchange CSV accounts')
    .option('--provider <name>', 'Preferred blockchain provider for blockchain accounts')
    .option('--xpub-gap <number>', 'Increase the xpub gap limit for xpub accounts', parseInt)
    .option('--profile <profile>', 'Use a specific profile key instead of the active profile')
    .option('--json', 'Output results in JSON format')
    .action(async (name: string, rawOptions: unknown) => {
      await executeUpdateAccountCommand(name, rawOptions, appRuntime);
    });
}

async function executeUpdateAccountCommand(
  name: string,
  rawOptions: unknown,
  appRuntime: CliAppRuntime
): Promise<void> {
  const { format, options } = parseCliCommandOptions('accounts-update', rawOptions, AccountUpdateCommandOptionsSchema);

  try {
    await runCommand(appRuntime, async (ctx) => {
      const db = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, db, options.profile);
      if (profileResult.isErr()) {
        displayCliError('accounts-update', profileResult.error, ExitCodes.GENERAL_ERROR, format);
      }

      const accountService = buildCliAccountLifecycleService(db);
      const accountResult = await accountService.getByName(profileResult.value.id, name);
      if (accountResult.isErr()) {
        displayCliError('accounts-update', accountResult.error, ExitCodes.GENERAL_ERROR, format);
      }
      if (!accountResult.value) {
        displayCliError(
          'accounts-update',
          new Error(`Account '${name.trim().toLowerCase()}' not found`),
          ExitCodes.GENERAL_ERROR,
          format
        );
      }

      const draftResult = buildUpdatedAccountDraft(accountResult.value, options, appRuntime.adapterRegistry);
      if (draftResult.isErr()) {
        displayCliError('accounts-update', draftResult.error, ExitCodes.INVALID_ARGS, format);
      }

      const updateResult = await accountService.updateNamed(profileResult.value.id, name, draftResult.value);
      if (updateResult.isErr()) {
        displayCliError('accounts-update', updateResult.error, ExitCodes.GENERAL_ERROR, format);
      }

      const payload = {
        account: serializeAccount(updateResult.value),
        profile: profileResult.value.profileKey,
      };

      if (options.json) {
        outputSuccess('accounts-update', payload);
        return;
      }

      console.log(`Updated account ${updateResult.value.name}`);
    });
  } catch (error) {
    displayCliError(
      'accounts-update',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      format
    );
  }
}

function serializeAccount(account: {
  accountType: 'blockchain' | 'exchange-api' | 'exchange-csv';
  createdAt: Date;
  id: number;
  identifier: string;
  name?: string | undefined;
  platformKey: string;
  providerName?: string | undefined;
}) {
  return {
    id: account.id,
    name: account.name,
    accountType: account.accountType,
    platformKey: account.platformKey,
    identifier: maskIdentifier(account),
    providerName: account.providerName,
    createdAt: account.createdAt.toISOString(),
  };
}
