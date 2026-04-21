import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { ExitCodes, jsonSuccess, runCliRuntimeCommand, textSuccess, toCliResult } from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { formatSuccessLine } from '../../../cli/success.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { createCliAccountLifecycleService } from '../account-service.js';

import { serializeAccountForCli } from './account-cli-serialization.js';
import { buildCreateAccountInput } from './account-draft-utils.js';
import { AccountAddCommandOptionsSchema } from './accounts-option-schemas.js';

const ACCOUNTS_ADD_COMMAND_ID = 'accounts-add';

export function registerAccountsAddCommand(accountsCommand: Command, appRuntime: CliAppRuntime): void {
  accountsCommand
    .command('add')
    .description('Add an account')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts add kraken-main --exchange kraken --api-key KEY --api-secret SECRET
  $ exitbook accounts add kucoin-csv --exchange kucoin --csv-dir ./exports/kucoin
  $ exitbook accounts add kucoin-csv --exchange kucoin --csv-dir ./exports/kucoin --api-key KEY --api-secret SECRET --api-passphrase PASSPHRASE
  $ exitbook accounts add wallet-main --blockchain ethereum --address 0xabc...
  $ exitbook accounts add wallet-xpub --blockchain bitcoin --address xpub... --xpub-gap 20

Notes:
  - Create exactly one account type per command: exchange API, exchange CSV, or blockchain wallet.
  - Exchange CSV accounts may also store provider credentials for live balance refresh.
  - Use --provider and --xpub-gap only for blockchain accounts.
  - Account names cannot use reserved command words such as add, explore, list, refresh, remove, update, or view.
`
    )
    .argument('<name>', 'Account name')
    .option('--exchange <name>', 'Exchange name (e.g., kraken, kucoin)')
    .option('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum, solana)')
    .option('--csv-dir <path>', 'CSV directory for exchange accounts')
    .option('--address <address>', 'Wallet address or xpub for blockchain accounts')
    .option('--provider <name>', 'Preferred blockchain provider')
    .option('--xpub-gap <number>', 'Gap limit for xpub derivation', parseInt)
    .option('--api-key <key>', 'API key to store on an exchange account for provider-backed verification')
    .option('--api-secret <secret>', 'API secret to store on an exchange account for provider-backed verification')
    .option('--api-passphrase <passphrase>', 'API passphrase to store on an exchange account when required')
    .option('--json', 'Output results in JSON format')
    .action(async (name: string, rawOptions: unknown) => {
      await executeAddAccountCommand(name, rawOptions, appRuntime);
    });
}

async function executeAddAccountCommand(name: string, rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  await runCliRuntimeCommand({
    command: ACCOUNTS_ADD_COMMAND_ID,
    format: detectCliOutputFormat(rawOptions),
    appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, AccountAddCommandOptionsSchema);
      }),
    action: async (context) =>
      resultDoAsync(async function* () {
        const db = await context.runtime.openDatabaseSession();
        const profile = yield* toCliResult(await resolveCommandProfile(context.runtime, db), ExitCodes.GENERAL_ERROR);
        const draft = yield* toCliResult(
          buildCreateAccountInput(name, profile.id, context.prepared, appRuntime.adapterRegistry),
          ExitCodes.INVALID_ARGS
        );
        const account = yield* toCliResult(
          await createCliAccountLifecycleService(db).create(draft),
          ExitCodes.GENERAL_ERROR
        );
        const payload = {
          account: serializeAccountForCli(account),
          profile: profile.profileKey,
        };

        if (context.prepared.json) {
          return jsonSuccess(payload);
        }

        return textSuccess(() => {
          console.log(formatSuccessLine(`Added account ${account.name} (${account.platformKey})`));
        });
      }),
  });
}
