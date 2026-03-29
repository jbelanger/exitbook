import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { buildCliProfileService } from '../profile-service.js';
import { writeCliStateFile } from '../profile-state.js';

export function registerProfilesSwitchCommand(profilesCommand: Command): void {
  profilesCommand
    .command('switch')
    .description('Set the default profile for future commands in this data directory')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook profiles switch business
  $ exitbook profiles switch default --json

Notes:
  - This updates the default profile used by future commands in this data directory.
`
    )
    .argument('<profile>', 'Profile key')
    .option('--json', 'Output results in JSON format')
    .action(async (profileKey: string, options: { json?: boolean | undefined }) => {
      const format = options.json ? 'json' : 'text';

      try {
        await runCommand(async (ctx) => {
          const db = await ctx.database();
          const profileService = buildCliProfileService(db);
          const profileResult = await profileService.resolve(profileKey);

          if (profileResult.isErr()) {
            displayCliError('profiles-switch', profileResult.error, ExitCodes.GENERAL_ERROR, format);
          }

          const writeResult = writeCliStateFile(ctx.dataDir, profileResult.value.profileKey);
          if (writeResult.isErr()) {
            displayCliError('profiles-switch', writeResult.error, ExitCodes.GENERAL_ERROR, format);
          }

          if (options.json) {
            outputSuccess('profiles-switch', {
              defaultProfileKey: profileResult.value.profileKey,
              profile: profileResult.value,
            });
            return;
          }

          console.log(
            `Default profile set to ${profileResult.value.displayName} [key: ${profileResult.value.profileKey}]`
          );
        });
      } catch (error) {
        displayCliError(
          'profiles-switch',
          error instanceof Error ? error : new Error(String(error)),
          ExitCodes.GENERAL_ERROR,
          format
        );
      }
    });
}
