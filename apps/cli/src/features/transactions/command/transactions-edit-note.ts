import { OverrideStore } from '@exitbook/data/overrides';
import type { Command } from 'commander';
import { z } from 'zod';

import { runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';

import { TransactionsEditHandler, type TransactionNoteEditResult } from './transactions-edit-handler.js';
import { TransactionsEditNoteCommandOptionsSchema } from './transactions-option-schemas.js';

const TransactionIdArgumentSchema = z.coerce.number().int().positive();

/**
 * Register the transactions edit note subcommand.
 */
export function registerTransactionsEditNoteCommand(editCommand: Command): void {
  editCommand
    .command('note')
    .description('Set or clear a durable note for a transaction')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook transactions edit note 123 --message "Moved to Ledger"
  $ exitbook transactions edit note 123 --clear
  $ exitbook transactions edit note 123 --message "Airdrop" --reason "manual categorization"
`
    )
    .argument('<transaction-id>', 'ID of the transaction to annotate')
    .option('--profile <profile>', 'Use a specific profile key instead of the active profile')
    .option('--message <text>', 'Note message to persist for the transaction')
    .option('--clear', 'Clear the currently saved transaction note')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output results in JSON format')
    .action(async (transactionId: string, rawOptions: unknown) => {
      await executeTransactionsEditNoteCommand(transactionId, rawOptions);
    });
}

async function executeTransactionsEditNoteCommand(rawTransactionId: string, rawOptions: unknown): Promise<void> {
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  const transactionIdResult = TransactionIdArgumentSchema.safeParse(rawTransactionId);
  if (!transactionIdResult.success) {
    displayCliError(
      'transactions-edit-note',
      new Error(transactionIdResult.error.issues[0]?.message ?? 'Invalid transaction ID'),
      ExitCodes.INVALID_ARGS,
      isJsonMode ? 'json' : 'text'
    );
  }

  const parseResult = TransactionsEditNoteCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'transactions-edit-note',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJsonMode ? 'json' : 'text'
    );
  }

  const options = parseResult.data;

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database, options.profile);
      if (profileResult.isErr()) {
        displayCliError(
          'transactions-edit-note',
          profileResult.error,
          ExitCodes.GENERAL_ERROR,
          options.json ? 'json' : 'text'
        );
      }

      const overrideStore = new OverrideStore(ctx.dataDir);
      const handler = new TransactionsEditHandler(database, overrideStore);

      const result = options.clear
        ? await handler.clearNote({
            profileId: profileResult.value.id,
            profileKey: profileResult.value.profileKey,
            transactionId: transactionIdResult.data,
            reason: options.reason,
          })
        : await handler.setNote({
            profileId: profileResult.value.id,
            profileKey: profileResult.value.profileKey,
            transactionId: transactionIdResult.data,
            message: options.message!,
            reason: options.reason,
          });

      if (result.isErr()) {
        displayCliError(
          'transactions-edit-note',
          result.error,
          ExitCodes.GENERAL_ERROR,
          options.json ? 'json' : 'text'
        );
      }

      if (options.json) {
        outputSuccess('transactions-edit-note', result.value);
        return;
      }

      printTransactionsEditNoteResult(result.value);
    });
  } catch (error) {
    displayCliError(
      'transactions-edit-note',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}

function printTransactionsEditNoteResult(result: TransactionNoteEditResult): void {
  if (result.action === 'set') {
    console.log(result.changed ? 'Transaction note saved' : 'Transaction note unchanged');
  } else {
    console.log(result.changed ? 'Transaction note cleared' : 'Transaction note already clear');
  }

  console.log(`   Transaction: #${result.transactionId} (${result.source} / ${result.txFingerprint})`);
  if (result.note) {
    console.log(`   Note: ${result.note}`);
  }
}
