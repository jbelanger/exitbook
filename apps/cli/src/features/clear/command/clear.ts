import type { Command } from 'commander';

import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';

import { ClearCommandOptionsSchema } from './clear-option-schemas.js';
import { runClearTerminalFlow } from './clear-terminal.js';
import { runClearTuiFlow } from './clear-tui.js';

/**
 * Register the clear command.
 */
export function registerClearCommand(program: Command): void {
  program
    .command('clear')
    .description('Clear processed data (keeps raw data by default for reprocessing)')
    .option('--account-id <id>', 'Clear data for specific account ID', parseInt)
    .option('--source <name>', 'Clear data for all accounts with this source name')
    .option('--include-raw', 'Also clear raw imported data (WARNING: requires re-import)')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeClearCommand(rawOptions);
    });
}

/**
 * Execute the clear command.
 */
async function executeClearCommand(rawOptions: unknown): Promise<void> {
  const validationResult = ClearCommandOptionsSchema.safeParse(rawOptions);
  if (!validationResult.success) {
    const firstError = validationResult.error.issues[0];
    displayCliError('clear', new Error(firstError?.message ?? 'Invalid options'), ExitCodes.GENERAL_ERROR, 'text');
  }

  const options = validationResult.data;
  const useJsonMode = options.json ?? false;
  const useConfirmBypass = options.confirm ?? false;

  if (!useJsonMode && !useConfirmBypass) {
    await runClearTuiFlow(options);
    return;
  }

  await runClearTerminalFlow(options);
}
