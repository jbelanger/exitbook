import { OverrideStore } from '@exitbook/data/overrides';
import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import { z } from 'zod';

import {
  cliErr,
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
import {
  formatResolvedMovementSummary,
  getTransactionMovementSelectorErrorExitCode,
  resolveTransactionMovementSelector,
} from './transaction-movement-selector.js';
import { prepareTransactionsCommandScope } from './transactions-command-scope.js';
import {
  TransactionsEditMovementRoleHandler,
  type TransactionMovementRoleEditResult,
} from './transactions-edit-movement-role-handler.js';
import { TRANSACTION_EDIT_REPAIR_COMMAND } from './transactions-edit-result.js';
import { TransactionsEditMovementRoleCommandOptionsSchema } from './transactions-option-schemas.js';

type TransactionsEditMovementRoleCommandOptions = z.infer<typeof TransactionsEditMovementRoleCommandOptionsSchema>;

export function registerTransactionsEditMovementRoleCommand(editCommand: Command): void {
  editCommand
    .command('movement-role')
    .description('Set or clear a durable movement role for one transaction movement')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook transactions edit movement-role a1b2c3d4e5 --movement 6c6545ac9a:1 --role staking_reward
  $ exitbook transactions edit movement-role a1b2c3d4e5 --movement 6c6545ac9a:1 --clear
  $ exitbook transactions edit movement-role a1b2c3d4e5 --movement 6c6545ac9a:1 --role principal --reason "Processor classified this reward leg incorrectly"
`
    )
    .argument('<selector>', 'TX-REF of the transaction to edit')
    .requiredOption('--movement <ref>', 'MOVEMENT-REF shown in transaction detail output')
    .option('--role <role>', 'Movement role to persist for the selected movement')
    .option('--clear', 'Clear the currently saved movement role override')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output results in JSON format')
    .action((selector: string, rawOptions: unknown) =>
      executeTransactionsEditMovementRoleCommand(selector, rawOptions)
    );
}

async function executeTransactionsEditMovementRoleCommand(selector: string, rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'transactions-edit-movement-role',
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        return {
          options: yield* parseCliCommandOptionsResult(rawOptions, TransactionsEditMovementRoleCommandOptionsSchema),
          selector,
        };
      }),
    action: async (context) =>
      executeTransactionsEditMovementRoleCommandResult(
        context.runtime,
        context.prepared.selector,
        context.prepared.options,
        format
      ),
  });
}

async function executeTransactionsEditMovementRoleCommandResult(
  ctx: CommandRuntime,
  selector: string,
  options: TransactionsEditMovementRoleCommandOptions,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const scope = yield* toCliResult(await prepareTransactionsCommandScope(ctx, { format }), ExitCodes.GENERAL_ERROR);
    const selection = yield* await resolveTransactionEditTarget(
      scope.database.transactions,
      scope.profile.id,
      selector
    );
    const movementSelectionResult = resolveTransactionMovementSelector(selection.transaction, options.movement);
    const movementSelection = movementSelectionResult.isErr()
      ? yield* cliErr(
          movementSelectionResult.error,
          getTransactionMovementSelectorErrorExitCode(movementSelectionResult.error)
        )
      : movementSelectionResult.value;
    const overrideStore = new OverrideStore(ctx.dataDir);
    const handler = new TransactionsEditMovementRoleHandler(scope.database, overrideStore);

    const result = options.clear
      ? yield* toCliResult(
          await handler.clearRole({
            movement: movementSelection,
            profileKey: scope.profile.profileKey,
            reason: options.reason,
            target: selection.target,
          }),
          ExitCodes.GENERAL_ERROR
        )
      : yield* toCliResult(
          await handler.setRole({
            movement: movementSelection,
            profileKey: scope.profile.profileKey,
            reason: options.reason,
            role: options.role!,
            target: selection.target,
          }),
          ExitCodes.GENERAL_ERROR
        );

    if (format === 'json') {
      return jsonSuccess(result);
    }

    return textSuccess(() => {
      printTransactionsEditMovementRoleResult(result, formatResolvedMovementSummary(movementSelection));
    });
  });
}

function printTransactionsEditMovementRoleResult(
  result: TransactionMovementRoleEditResult,
  movementSummary: string
): void {
  if (result.action === 'set') {
    console.log(formatSuccessLine(result.changed ? 'Movement role saved' : 'Movement role unchanged'));
  } else {
    console.log(formatSuccessLine(result.changed ? 'Movement role override cleared' : 'Movement role already clear'));
  }

  console.log(
    `   Transaction: ${result.transaction.txRef} (${result.transaction.platformKey} / ${result.transaction.txFingerprint})`
  );
  console.log(`   Movement: ${result.movement.movementRef} (${movementSummary})`);
  console.log(`   Role: ${result.previousEffectiveRole} -> ${result.nextEffectiveRole}`);
  if (result.warnings.length > 0) {
    console.log('');
    for (const warning of result.warnings) {
      console.log(`Warning: ${warning}`);
    }
    console.log(`Repair: ${result.repairCommand ?? TRANSACTION_EDIT_REPAIR_COMMAND}`);
  }
}
