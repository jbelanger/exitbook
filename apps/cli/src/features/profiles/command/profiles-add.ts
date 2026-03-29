import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { buildCliProfileService } from '../profile-service.js';

export function registerProfilesAddCommand(profilesCommand: Command): void {
  profilesCommand
    .command('add')
    .description('Create a new isolated profile')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook profiles add business
  $ exitbook profiles add tax-audit
  $ exitbook profiles add business --json

Notes:
  - The profile key is the stable identifier used by other commands and state files.
`
    )
    .argument('<profile>', 'Stable profile key used for deterministic identity')
    .option('--json', 'Output results in JSON format')
    .action(async (profileKey: string, options: { json?: boolean | undefined }) => {
      const format = options.json ? 'json' : 'text';

      try {
        await runCommand(async (ctx) => {
          const db = await ctx.database();
          const result = await buildCliProfileService(db).create(profileKey);
          if (result.isErr()) {
            displayCliError('profiles-add', result.error, ExitCodes.GENERAL_ERROR, format);
          }

          if (options.json) {
            outputSuccess('profiles-add', { profile: result.value });
            return;
          }

          console.log(`Added profile ${result.value.displayName} [key: ${result.value.profileKey}]`);
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
