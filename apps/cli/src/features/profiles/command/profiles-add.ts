import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';

export function registerProfilesAddCommand(profilesCommand: Command): void {
  profilesCommand
    .command('add')
    .description('Create a new profile')
    .argument('<name>', 'Profile name')
    .option('--json', 'Output results in JSON format')
    .action(async (name: string, options: { json?: boolean | undefined }) => {
      const format = options.json ? 'json' : 'text';

      try {
        await runCommand(async (ctx) => {
          const db = await ctx.database();
          const result = await db.profiles.create(name);
          if (result.isErr()) {
            displayCliError('profiles-add', result.error, ExitCodes.GENERAL_ERROR, format);
          }

          if (options.json) {
            outputSuccess('profiles-add', { profile: result.value });
            return;
          }

          console.log(`Added profile ${result.value.name}`);
        });
      } catch (error) {
        displayCliError(
          'profiles-add',
          error instanceof Error ? error : new Error(String(error)),
          ExitCodes.GENERAL_ERROR,
          format
        );
      }
    });
}
