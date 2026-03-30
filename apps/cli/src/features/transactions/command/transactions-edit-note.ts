import { OverrideStore } from '@exitbook/data/overrides';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import { z } from 'zod';

import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { captureCliRuntimeResult, runCliCommandBoundary } from '../../shared/cli-boundary.js';
import { jsonSuccess, textSuccess, toCliResult, toCliValue, type CliCommandResult } from '../../shared/cli-contract.js';
import { detectCliOutputFormat, type CliOutputFormat } from '../../shared/cli-output-format.js';
import { parseCliCommandOptionsResult } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';

import { TransactionsEditHandler, type TransactionNoteEditResult } from './transactions-edit-handler.js';
import { TransactionsEditNoteCommandOptionsSchema } from './transactions-option-schemas.js';

const TransactionIdArgumentSchema = z.coerce.number().int().positive();

type TransactionsEditNoteCommandOptions = z.infer<typeof TransactionsEditNoteCommandOptionsSchema>;

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
    .option('--message <text>', 'Note message to persist for the transaction')
    .option('--clear', 'Clear the currently saved transaction note')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output results in JSON format')
    .action((transactionId: string, rawOptions: unknown) =>
      executeTransactionsEditNoteCommand(transactionId, rawOptions)
    );
}

async function executeTransactionsEditNoteCommand(rawTransactionId: string, rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliCommandBoundary({
    command: 'transactions-edit-note',
    format,
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, TransactionsEditNoteCommandOptionsSchema);
        const transactionId = yield* toCliResult(parseTransactionId(rawTransactionId), ExitCodes.INVALID_ARGS);
        return yield* await executeTransactionsEditNoteCommandResult(transactionId, options, format);
      }),
  });
}

async function executeTransactionsEditNoteCommandResult(
  transactionId: number,
  options: TransactionsEditNoteCommandOptions,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return captureCliRuntimeResult({
    command: 'transactions-edit-note',
    action: async (ctx) =>
      resultDoAsync(async function* () {
        const database = await ctx.database();
        const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
        const overrideStore = new OverrideStore(ctx.dataDir);
        const handler = new TransactionsEditHandler(database, overrideStore);

        const result = options.clear
          ? yield* toCliResult(
              await handler.clearNote({
                profileId: profile.id,
                profileKey: profile.profileKey,
                transactionId,
                reason: options.reason,
              }),
              ExitCodes.GENERAL_ERROR
            )
          : yield* toCliResult(
              await handler.setNote({
                profileId: profile.id,
                profileKey: profile.profileKey,
                transactionId,
                message: yield* toCliValue(
                  options.message,
                  new Error('Either --message or --clear is required'),
                  ExitCodes.INVALID_ARGS
                ),
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
      }),
  });
}

function parseTransactionId(rawTransactionId: string): Result<number, Error> {
  const transactionIdResult = TransactionIdArgumentSchema.safeParse(rawTransactionId);
  if (!transactionIdResult.success) {
    return err(new Error(transactionIdResult.error.issues[0]?.message ?? 'Invalid transaction ID'));
  }

  return ok(transactionIdResult.data);
}

function printTransactionsEditNoteResult(result: TransactionNoteEditResult): void {
  if (result.action === 'set') {
    console.log(result.changed ? 'Transaction note saved' : 'Transaction note unchanged');
  } else {
    console.log(result.changed ? 'Transaction note cleared' : 'Transaction note already clear');
  }

  console.log(`   Transaction: #${result.transactionId} (${result.platformKey} / ${result.txFingerprint})`);
  if (result.note) {
    console.log(`   Note: ${result.note}`);
  }
}
