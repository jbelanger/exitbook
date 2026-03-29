import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { buildCliProfileService } from '../profile-service.js';

export function registerProfilesRenameCommand(profilesCommand: Command): void {
  profilesCommand
    .command('rename')
    .description('Rename a profile label without changing its key')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook profiles rename business "Business Holdings"
  $ exitbook profiles rename default "Personal"
  $ exitbook profiles rename business "Business Holdings" --json

Notes:
  - Renaming changes the display label only; the profile key stays the same.
`
    )
    .argument('<profile>', 'Profile key')
    .argument('<display-name>', 'Profile display name')
    .option('--json', 'Output results in JSON format')
    .action(async (profileKey: string, displayName: string, options: { json?: boolean | undefined }) => {
      const format = options.json ? 'json' : 'text';

      try {
        await runCommand(async (ctx) => {
          const db = await ctx.database();
          const result = await buildCliProfileService(db).rename(profileKey, displayName);
          if (result.isErr()) {
            displayCliError('profiles-rename', result.error, ExitCodes.GENERAL_ERROR, format);
          }

          if (options.json) {
            outputSuccess('profiles-rename', { profile: result.value });
            return;
          }

          console.log(`Renamed profile ${result.value.profileKey} to ${result.value.displayName}`);
        });
      } catch (error) {
        displayCliError(
          'profiles-rename',
          error instanceof Error ? error : new Error(String(error)),
          ExitCodes.GENERAL_ERROR,
          format
        );
      }
    });
}
