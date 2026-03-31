import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { runCliRuntimeCommand } from '../../../cli/command.js';
import { ExitCodes } from '../../../cli/exit-codes.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';

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
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook clear
  $ exitbook clear --account-id 12
  $ exitbook clear --platform kraken
  $ exitbook clear --include-raw --confirm
  $ exitbook clear --account-id 12 --json

Notes:
  - By default this keeps raw imports so you can run "exitbook reprocess" afterward.
  - Use --include-raw only when you also want to delete imported source data.
`
    )
    .option('--account-id <id>', 'Clear data for specific account ID', parseInt)
    .option('--platform <name>', 'Clear data for all accounts with this platform name')
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
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'clear',
    format,
    unexpectedErrorExitCode: ExitCodes.GENERAL_ERROR,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, ClearCommandOptionsSchema, ExitCodes.INVALID_ARGS),
    action: async ({ runtime, prepared: options }) =>
      resultDoAsync(async function* () {
        if (format === 'text' && options.confirm !== true) {
          return yield* await runClearTuiFlow(runtime, options);
        }

        return yield* await runClearTerminalFlow(runtime, options);
      }),
  });
}
