import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { cliErr, ExitCodes, runCliRuntimeCommand } from '../../../cli/command.js';
import { detectCliTokenOutputFormat, parseCliBrowseRootInvocationResult } from '../../../cli/options.js';

import {
  buildTransactionsBrowseOptionsHelpText,
  executePreparedTransactionsBrowseCommand,
  prepareTransactionsBrowseCommand,
  registerTransactionsBrowseOptions,
} from './transactions-browse-command.js';
import { registerTransactionsEditCommand } from './transactions-edit.js';
import { registerTransactionsExportCommand } from './transactions-export.js';
import { registerTransactionsViewCommand } from './transactions-view.js';

const TRANSACTIONS_COMMAND_ID = 'transactions';
const TRANSACTIONS_LIST_ALIAS = 'list';

/**
 * Register the unified transactions command with all subcommands.
 *
 * Structure:
 *   transactions                - Static transaction list
 *   transactions <ref>          - Static transaction detail
 *   transactions view           - View processed transactions with filters
 *   transactions edit note      - Set or clear durable transaction notes
 *   transactions export         - Export all transactions to CSV or JSON
 */
export function registerTransactionsCommand(program: Command): void {
  const transactions = program
    .command('transactions')
    .usage('[selector] [options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Manage processed transactions (view, edit, and export transaction history)')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook transactions
  $ exitbook transactions a1b2c3d4e5
  $ exitbook transactions view --asset BTC
  $ exitbook transactions edit note 123 --message "Moved to Ledger"
  $ exitbook transactions export --format json --output tx.json
  $ exitbook transactions --json

Browse Options:
${buildTransactionsBrowseOptionsHelpText()}

Notes:
  - Use bare "transactions" for a static transaction list.
  - Use "transactions <fingerprint_ref>" for a static transaction detail.
  - Use "transactions view" for the interactive explorer.
  - Use "transactions edit note" for durable analyst context without changing transaction amounts.
`
    )
    .action(async (tokens: string[] | undefined) => {
      const format = detectCliTokenOutputFormat(tokens);

      await runCliRuntimeCommand({
        command: TRANSACTIONS_COMMAND_ID,
        format,
        prepare: async () =>
          resultDoAsync(async function* () {
            const parsedInvocation = yield* parseCliBrowseRootInvocationResult(
              tokens,
              registerTransactionsBrowseOptions
            );
            const transactionSelector = parsedInvocation.selector?.trim();

            if (transactionSelector?.toLowerCase() === TRANSACTIONS_LIST_ALIAS) {
              return yield* cliErr(
                new Error('Use bare "transactions" instead of "transactions list".'),
                ExitCodes.INVALID_ARGS
              );
            }

            return yield* prepareTransactionsBrowseCommand({
              transactionSelector,
              rawOptions: parsedInvocation.rawOptions,
            });
          }),
        action: async (context) => executePreparedTransactionsBrowseCommand(context.runtime, context.prepared, format),
      });
    });

  registerTransactionsViewCommand(transactions);
  registerTransactionsEditCommand(transactions);
  registerTransactionsExportCommand(transactions);
}
