import type { Account } from '@exitbook/core';
import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import {
  cliErr,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { formatSuccessLine } from '../../../cli/success.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import {
  formatAccountSelectorLabel,
  getAccountSelectorErrorExitCode,
  resolveRequiredOwnedAccountSelector,
} from '../account-selector.js';
import { createCliAccountLifecycleService } from '../account-service.js';

import { serializeAccountForCli } from './account-cli-serialization.js';
import { buildUpdateAccountInput } from './account-draft-utils.js';
import { AccountUpdateCommandOptionsSchema, type AccountUpdateCommandOptions } from './accounts-option-schemas.js';

const ACCOUNTS_UPDATE_COMMAND_ID = 'accounts-update';

export function registerAccountsUpdateCommand(accountsCommand: Command, appRuntime: CliAppRuntime): void {
  accountsCommand
    .command('update')
    .description('Update account properties')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts update kraken-main --name kraken-primary
  $ exitbook accounts update kraken-main --api-key NEW_KEY --api-secret NEW_SECRET
  $ exitbook accounts update kraken-main --name kraken-primary --api-key NEW_KEY --api-secret NEW_SECRET
  $ exitbook accounts update kucoin-csv --csv-dir ./exports/kucoin-2026
  $ exitbook accounts update 6f4c0d1a2b --provider blockchair
  $ exitbook accounts update wallet-main --provider blockchair
  $ exitbook accounts update wallet-xpub --xpub-gap 30

Notes:
  - Supply only the properties you want to change.
  - The selector can be an account name or fingerprint prefix.
  - Compatible property changes can be combined in one command.
  - --xpub-gap can increase the stored gap limit for xpub accounts.
`
    )
    .argument('<selector>', 'Account selector (name or fingerprint prefix)')
    .option('--name <name>', 'New account name')
    .option('--api-key <key>', 'New API key for exchange API accounts')
    .option('--api-secret <secret>', 'New API secret for exchange API accounts')
    .option('--api-passphrase <passphrase>', 'New API passphrase for exchange API accounts')
    .option('--csv-dir <path>', 'New CSV directory for exchange CSV accounts')
    .option('--provider <name>', 'New preferred blockchain provider for blockchain accounts')
    .option('--xpub-gap <number>', 'Increase the xpub gap limit for xpub accounts', parseInt)
    .option('--json', 'Output results in JSON format')
    .action(async (selector: string, rawOptions: unknown) => {
      await executeUpdateAccountCommand(selector, rawOptions, appRuntime);
    });
}

async function executeUpdateAccountCommand(
  selector: string,
  rawOptions: unknown,
  appRuntime: CliAppRuntime
): Promise<void> {
  await runCliRuntimeCommand({
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
        const accountService = createCliAccountLifecycleService(db);
        const selection = await resolveRequiredOwnedAccountSelector(
          accountService,
          profile.id,
          selector,
          'Account update requires an account selector'
        );
        if (selection.isErr()) {
          return yield* cliErr(selection.error, getAccountSelectorErrorExitCode(selection.error));
        }

        const existingAccount = selection.value.account;
        const draft = yield* toCliResult(
          buildUpdateAccountInput(existingAccount, context.prepared, appRuntime.adapterRegistry),
          ExitCodes.INVALID_ARGS
        );
        const updatedAccount = yield* toCliResult(
          await accountService.updateOwned(profile.id, existingAccount.id, draft),
          ExitCodes.GENERAL_ERROR
        );
        const payload = {
          account: serializeAccountForCli(updatedAccount),
          profile: profile.profileKey,
        };

        if (context.prepared.json) {
          return jsonSuccess(payload);
        }

        const changeSummary = buildAccountUpdateSummary(existingAccount, updatedAccount, context.prepared);
        const updatedAccountLabel = formatAccountSelectorLabel(updatedAccount);

        return textSuccess(() => {
          console.log(formatSuccessLine(`Updated account ${updatedAccountLabel}`));
          if (changeSummary.length > 0) {
            console.log(`Changes: ${changeSummary.join(' · ')}`);
          }
        });
      }),
  });
}

function buildAccountUpdateSummary(
  previous: Account,
  updated: Pick<Account, 'identifier' | 'metadata' | 'name' | 'providerName'>,
  options: AccountUpdateCommandOptions
): string[] {
  const changes: string[] = [];

  if (options.name !== undefined && updated.name !== previous.name) {
    changes.push(`renamed to ${updated.name}`);
  }
  if (options.apiKey !== undefined && options.apiKey !== previous.credentials?.apiKey) {
    changes.push('api key updated');
  }
  if (options.apiSecret !== undefined && options.apiSecret !== previous.credentials?.apiSecret) {
    changes.push('api secret updated');
  }
  if (options.apiPassphrase !== undefined && options.apiPassphrase !== previous.credentials?.apiPassphrase) {
    changes.push('api passphrase updated');
  }
  if (options.csvDir !== undefined && updated.identifier !== previous.identifier) {
    changes.push(`csv directory set to ${updated.identifier}`);
  }
  if (options.provider !== undefined && updated.providerName !== previous.providerName) {
    changes.push(updated.providerName ? `provider set to ${updated.providerName}` : 'provider cleared');
  }

  const previousGapLimit = previous.metadata?.xpub?.gapLimit;
  const nextGapLimit = updated.metadata?.xpub?.gapLimit;
  if (options.xpubGap !== undefined && nextGapLimit !== undefined && nextGapLimit !== previousGapLimit) {
    changes.push(`xpub gap limit set to ${nextGapLimit}`);
  }

  return changes;
}
