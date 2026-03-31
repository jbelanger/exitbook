import type { Account } from '@exitbook/core';
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
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { buildCliAccountLifecycleService } from '../account-service.js';

import { serializeAccountForCli } from './account-cli-serialization.js';
import { buildUpdateAccountInput } from './account-draft-utils.js';
import { AccountUpdateCommandOptionsSchema, type AccountUpdateCommandOptions } from './accounts-option-schemas.js';

const ACCOUNTS_UPDATE_COMMAND_ID = 'accounts-update';

export function registerAccountsUpdateCommand(accountsCommand: Command, appRuntime: CliAppRuntime): void {
  accountsCommand
    .command('update')
    .description('Update sync config for an account')
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
    .option('--provider <name>', 'New preferred blockchain provider for blockchain accounts')
    .option('--xpub-gap <number>', 'Increase the xpub gap limit for xpub accounts', parseInt)
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
  await runCliRuntimeCommand<AccountUpdateCommandOptions>({
    command: ACCOUNTS_UPDATE_COMMAND_ID,
    format: detectCliOutputFormat(rawOptions),
    appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, AccountUpdateCommandOptionsSchema);
      }),
    action: async (context) =>
      resultDoAsync(async function* () {
        const db = await context.runtime.database();
        const profile = yield* toCliResult(await resolveCommandProfile(context.runtime, db), ExitCodes.GENERAL_ERROR);
        const accountService = buildCliAccountLifecycleService(db);
        const account = yield* toCliResult(await accountService.getByName(profile.id, name), ExitCodes.GENERAL_ERROR);
        const existingAccount = yield* toCliValue(
          account,
          `Account '${name.trim().toLowerCase()}' not found`,
          ExitCodes.NOT_FOUND
        );
        const draft = yield* toCliResult(
          buildUpdateAccountInput(existingAccount, context.prepared, appRuntime.adapterRegistry),
          ExitCodes.INVALID_ARGS
        );
        const updatedAccount = yield* toCliResult(
          await accountService.update(profile.id, name, draft),
          ExitCodes.GENERAL_ERROR
        );
        const payload = {
          account: serializeAccountForCli(updatedAccount),
          profile: profile.profileKey,
        };

        if (context.prepared.json) {
          return jsonSuccess(payload);
        }

        return textSuccess(() => {
          console.log(`Updated account ${updatedAccount.name}`);
          for (const change of buildAccountUpdateSummary(existingAccount, updatedAccount, context.prepared)) {
            console.log(`  ${change}`);
          }
        });
      }),
  });
}

function buildAccountUpdateSummary(
  previous: Account,
  updated: Pick<Account, 'identifier' | 'metadata' | 'providerName'>,
  options: AccountUpdateCommandOptions
): string[] {
  const changes: string[] = [];

  if (options.apiKey !== undefined && options.apiKey !== previous.credentials?.apiKey) {
    changes.push('API key updated');
  }
  if (options.apiSecret !== undefined && options.apiSecret !== previous.credentials?.apiSecret) {
    changes.push('API secret updated');
  }
  if (options.apiPassphrase !== undefined && options.apiPassphrase !== previous.credentials?.apiPassphrase) {
    changes.push('API passphrase updated');
  }
  if (options.csvDir !== undefined && updated.identifier !== previous.identifier) {
    changes.push(`CSV directory set to: ${updated.identifier}`);
  }
  if (options.provider !== undefined && updated.providerName !== previous.providerName) {
    changes.push(updated.providerName ? `Provider set to: ${updated.providerName}` : 'Provider cleared');
  }

  const previousGapLimit = previous.metadata?.xpub?.gapLimit;
  const nextGapLimit = updated.metadata?.xpub?.gapLimit;
  if (options.xpubGap !== undefined && nextGapLimit !== undefined && nextGapLimit !== previousGapLimit) {
    changes.push(`Xpub gap limit set to: ${nextGapLimit}`);
  }

  return changes;
}
