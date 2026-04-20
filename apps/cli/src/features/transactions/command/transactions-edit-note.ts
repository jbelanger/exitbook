import { OverrideStore } from '@exitbook/data/overrides';
import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import { z } from 'zod';

import {
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliCommandResult,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult, type CliOutputFormat } from '../../../cli/options.js';
import { formatSuccessLine } from '../../../cli/success.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';

import { resolveTransactionEditTarget } from './transaction-edit-target.js';
import { prepareTransactionsCommandScope } from './transactions-command-scope.js';
import { TransactionsEditNoteHandler, type TransactionUserNoteEditResult } from './transactions-edit-note-handler.js';
import { TRANSACTION_EDIT_REPAIR_COMMAND } from './transactions-edit-result.js';
import { TransactionsEditNoteCommandOptionsSchema } from './transactions-option-schemas.js';

type TransactionsEditNoteCommandOptions = z.infer<typeof TransactionsEditNoteCommandOptionsSchema>;

export function registerTransactionsEditNoteCommand(editCommand: Command): void {
  editCommand
    .command('note')
    .description('Set or clear a durable note for a transaction')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook transactions edit note a1b2c3d4e5 --message "Moved to Ledger"
  $ exitbook transactions edit note a1b2c3d4e5 --clear
  $ exitbook transactions edit note a1b2c3d4e5 --message "Airdrop" --reason "manual categorization"
`
    )
    .argument('<selector>', 'TX-REF of the transaction to annotate')
    .option('--message <text>', 'Note message to persist for the transaction')
    .option('--clear', 'Clear the currently saved transaction note')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output results in JSON format')
    .action((selector: string, rawOptions: unknown) => executeTransactionsEditNoteCommand(selector, rawOptions));
}

async function executeTransactionsEditNoteCommand(selector: string, rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'transactions-edit-note',
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        return {
          options: yield* parseCliCommandOptionsResult(rawOptions, TransactionsEditNoteCommandOptionsSchema),
          selector,
        };
      }),
    action: async (context) =>
      executeTransactionsEditNoteCommandResult(
        context.runtime,
        context.prepared.selector,
        context.prepared.options,
        format
      ),
  });
}

async function executeTransactionsEditNoteCommandResult(
  ctx: CommandRuntime,
  selector: string,
  options: TransactionsEditNoteCommandOptions,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const scope = yield* toCliResult(await prepareTransactionsCommandScope(ctx, { format }), ExitCodes.GENERAL_ERROR);
    const selection = yield* await resolveTransactionEditTarget(
      scope.database.transactions,
      scope.profile.id,
      selector
    );
    const overrideStore = new OverrideStore(ctx.dataDir);
    const handler = new TransactionsEditNoteHandler(scope.database, overrideStore);

    const result = options.clear
      ? yield* toCliResult(
          await handler.clearNote({
            profileKey: scope.profile.profileKey,
            target: selection.target,
            reason: options.reason,
          }),
          ExitCodes.GENERAL_ERROR
        )
      : yield* toCliResult(
          await handler.setNote({
            profileKey: scope.profile.profileKey,
            target: selection.target,
            message: options.message!,
            reason: options.reason,
          }),
          ExitCodes.GENERAL_ERROR
        );

    if (format === 'json') {
      return jsonSuccess(result);
    }

    return textSuccess(() => {
      printTransactionsEditNoteResult(result);
    });
  });
}

function printTransactionsEditNoteResult(result: TransactionUserNoteEditResult): void {
  if (result.action === 'set') {
    console.log(formatSuccessLine(result.changed ? 'Transaction note saved' : 'Transaction note unchanged'));
  } else {
    console.log(formatSuccessLine(result.changed ? 'Transaction note cleared' : 'Transaction note already clear'));
  }

  console.log(
    `   Transaction: ${result.transaction.txRef} (${result.transaction.platformKey} / ${result.transaction.txFingerprint})`
  );
  if (result.note) {
    console.log(`   Note: ${result.note}`);
  }
  if (result.warnings.length > 0) {
    console.log('');
    for (const warning of result.warnings) {
      console.log(`Warning: ${warning}`);
    }
    console.log(`Repair: ${result.repairCommand ?? TRANSACTION_EDIT_REPAIR_COMMAND}`);
  }
}
