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

import { buildNamedAccountDraft } from './account-draft-utils.js';
import { AccountAddCommandOptionsSchema } from './accounts-option-schemas.js';

export function registerAccountsAddCommand(accountsCommand: Command, appRuntime: CliAppRuntime): void {
  accountsCommand
    .command('add')
    .description('Add a named account')
    .argument('<name>', 'Account name')
    .option('--exchange <name>', 'Exchange name (e.g., kraken, kucoin)')
    .option('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum, solana)')
    .option('--csv-dir <path>', 'CSV directory for exchange accounts')
    .option('--address <address>', 'Wallet address or xpub for blockchain accounts')
    .option('--provider <name>', 'Preferred blockchain provider')
    .option('--xpub-gap <number>', 'Gap limit for xpub derivation', parseInt)
    .option('--api-key <key>', 'API key for exchange API accounts')
    .option('--api-secret <secret>', 'API secret for exchange API accounts')
    .option('--api-passphrase <passphrase>', 'API passphrase for exchange API accounts')
    .option('--profile <profile>', 'Use a specific profile key instead of the active profile')
    .option('--json', 'Output results in JSON format')
    .action(async (name: string, rawOptions: unknown) => {
      await executeAddAccountCommand(name, rawOptions, appRuntime);
    });
}

async function executeAddAccountCommand(name: string, rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const { format, options } = parseCliCommandOptions('accounts-add', rawOptions, AccountAddCommandOptionsSchema);

  try {
    await runCommand(appRuntime, async (ctx) => {
      const db = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, db, options.profile);
      if (profileResult.isErr()) {
        displayCliError('accounts-add', profileResult.error, ExitCodes.GENERAL_ERROR, format);
      }

      const draftResult = buildNamedAccountDraft(name, profileResult.value.id, options, appRuntime.adapterRegistry);
      if (draftResult.isErr()) {
        displayCliError('accounts-add', draftResult.error, ExitCodes.INVALID_ARGS, format);
      }

      const addResult = await buildCliAccountLifecycleService(db).createNamed(draftResult.value);
      if (addResult.isErr()) {
        displayCliError('accounts-add', addResult.error, ExitCodes.GENERAL_ERROR, format);
      }

      const payload = {
        account: serializeAccount(addResult.value),
        profile: profileResult.value.profileKey,
      };

      if (options.json) {
        outputSuccess('accounts-add', payload);
        return;
      }

      console.log(`Added account ${addResult.value.name} (${addResult.value.platformKey})`);
    });
  } catch (error) {
    displayCliError(
      'accounts-add',
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
