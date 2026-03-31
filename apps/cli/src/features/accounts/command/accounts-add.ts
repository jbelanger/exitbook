import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { runCliRuntimeAction, runCliCommandBoundary } from '../../shared/cli-boundary.js';
import { jsonSuccess, textSuccess, toCliResult } from '../../shared/cli-contract.js';
import { detectCliOutputFormat } from '../../shared/cli-output-format.js';
import { parseCliCommandOptionsResult } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { buildCliAccountLifecycleService } from '../account-service.js';

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
  $ exitbook accounts add wallet-main --blockchain ethereum --address 0xabc...
  $ exitbook accounts add wallet-xpub --blockchain bitcoin --address xpub... --xpub-gap 20

Notes:
  - Create exactly one account type per command: exchange API, exchange CSV, or blockchain wallet.
  - Use --provider and --xpub-gap only for blockchain accounts.
  - Account names cannot use reserved command words such as add, list, remove, rename, update, or view.
`
    )
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
    .option('--json', 'Output results in JSON format')
    .action(async (name: string, rawOptions: unknown) => {
      await executeAddAccountCommand(name, rawOptions, appRuntime);
    });
}

async function executeAddAccountCommand(name: string, rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  await runCliCommandBoundary({
    command: ACCOUNTS_ADD_COMMAND_ID,
    format: detectCliOutputFormat(rawOptions),
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, AccountAddCommandOptionsSchema);

        return yield* await runCliRuntimeAction({
          command: ACCOUNTS_ADD_COMMAND_ID,
          appRuntime,
          action: async (ctx) =>
            resultDoAsync(async function* () {
              const db = await ctx.database();
              const profile = yield* toCliResult(await resolveCommandProfile(ctx, db), ExitCodes.GENERAL_ERROR);
              const draft = yield* toCliResult(
                buildCreateAccountInput(name, profile.id, options, appRuntime.adapterRegistry),
                ExitCodes.INVALID_ARGS
              );
              const account = yield* toCliResult(
                await buildCliAccountLifecycleService(db).create(draft),
                ExitCodes.GENERAL_ERROR
              );
              const payload = {
                account: serializeAccountForCli(account),
                profile: profile.profileKey,
              };

              if (options.json) {
                return jsonSuccess(payload);
              }

              return textSuccess(() => {
                console.log(`Added account ${account.name} (${account.platformKey})`);
              });
            }),
        });
      }),
  });
}
