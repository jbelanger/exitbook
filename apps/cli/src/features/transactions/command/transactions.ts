import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { cliErr, ExitCodes, runCliRuntimeCommand } from '../../../cli/command.js';
import { detectCliTokenOutputFormat, parseCliBrowseRootInvocationResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import {
  buildTransactionsBrowseOptionsHelpText,
  executePreparedTransactionsBrowseCommand,
  prepareTransactionsBrowseCommand,
  registerTransactionsBrowseOptions,
} from './transactions-browse-command.js';
import { registerTransactionsEditCommand } from './transactions-edit.js';
import { registerTransactionsExploreCommand } from './transactions-explore.js';
import { registerTransactionsExportCommand } from './transactions-export.js';
import { registerTransactionsListCommand } from './transactions-list.js';
import { registerTransactionsViewCommand } from './transactions-view.js';

const TRANSACTIONS_COMMAND_ID = 'transactions';

/**
 * Register the unified transactions command with all subcommands.
 *
 * Structure:
 *   transactions                - Static transaction list
 *   transactions list           - Explicit static transaction list alias
 *   transactions view <ref>     - Static transaction detail
 *   transactions explore        - Interactive transactions explorer
 *   transactions edit note      - Set or clear durable transaction notes by TX-REF
 *   transactions edit movement-role - Set or clear durable movement roles by TX-REF + MOVEMENT-REF
 *   transactions export         - Export all transactions to CSV or JSON
 */
export function registerTransactionsCommand(program: Command, appRuntime: CliAppRuntime): void {
  const transactions = program
    .command('transactions')
    .usage('[options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Manage processed transactions (view, edit, and export transaction history)')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook transactions
  $ exitbook transactions --account wallet-main
  $ exitbook transactions list --platform kraken
  $ exitbook transactions view a1b2c3d4e5
  $ exitbook transactions explore --asset BTC
  $ exitbook transactions explore a1b2c3d4e5
  $ exitbook transactions edit note a1b2c3d4e5 --message "Moved to Ledger"
  $ exitbook transactions edit movement-role a1b2c3d4e5 --movement 6c6545ac9a:1 --role staking_reward
  $ exitbook transactions export --format json --output tx.json
  $ exitbook transactions --json

Browse Options:
${buildTransactionsBrowseOptionsHelpText()}

Notes:
  - Use bare "transactions" or "transactions list" for static transaction lists.
  - Use "transactions view <fingerprint_ref>" for one static transaction detail card.
  - Use "transactions explore" for the interactive explorer.
  - Use "transactions edit note <TX-REF>" for durable analyst context without changing transaction amounts.
  - Use "transactions edit movement-role <TX-REF> --movement <MOVEMENT-REF>" for durable movement-role corrections.
`
    )
    .action(async (tokens: string[] | undefined) => {
      const format = detectCliTokenOutputFormat(tokens);

      await runCliRuntimeCommand({
        appRuntime,
        command: TRANSACTIONS_COMMAND_ID,
        format,
        prepare: async () =>
          resultDoAsync(async function* () {
            const parsedInvocation = yield* parseCliBrowseRootInvocationResult(
              tokens,
              registerTransactionsBrowseOptions
            );
            const transactionSelector = parsedInvocation.selector?.trim();

            if (transactionSelector) {
              return yield* cliErr(
                new Error(
                  `Use "transactions view ${transactionSelector}" for static detail or ` +
                    `"transactions explore ${transactionSelector}" for the explorer.`
                ),
                ExitCodes.INVALID_ARGS
              );
            }

            return yield* prepareTransactionsBrowseCommand({
              commandId: TRANSACTIONS_COMMAND_ID,
              rawOptions: parsedInvocation.rawOptions,
              transactionSelector: undefined,
            });
          }),
        action: async (context) => executePreparedTransactionsBrowseCommand(context.runtime, context.prepared, format),
      });
    });

  registerTransactionsListCommand(transactions, appRuntime);
  registerTransactionsViewCommand(transactions, appRuntime);
  registerTransactionsExploreCommand(transactions, appRuntime);
  registerTransactionsEditCommand(transactions, appRuntime);
  registerTransactionsExportCommand(transactions, appRuntime);
}
