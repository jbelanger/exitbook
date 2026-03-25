import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { resolveCommandProfile } from '../profile-resolution.js';

export function registerProfilesCurrentCommand(profilesCommand: Command): void {
  profilesCommand
    .command('current')
    .description('Show the active profile for this command')
    .option('--json', 'Output results in JSON format')
    .action(async (options: { json?: boolean | undefined }) => {
      const format = options.json ? 'json' : 'text';

      try {
        await runCommand(async (ctx) => {
          const db = await ctx.database();
          const profileResult = await resolveCommandProfile(ctx, db);
          if (profileResult.isErr()) {
            displayCliError('profiles-current', profileResult.error, ExitCodes.GENERAL_ERROR, format);
          }

          const payload = {
            profile: profileResult.value,
            source: ctx.activeProfileSource,
          };

          if (options.json) {
            outputSuccess('profiles-current', payload);
            return;
          }

          const sourceSuffix = ctx.activeProfileSource === 'default' ? '' : ` (${ctx.activeProfileSource})`;
          console.log(`${profileResult.value.name}${sourceSuffix}`);
        });
      } catch (error) {
        displayCliError(
          'profiles-current',
          error instanceof Error ? error : new Error(String(error)),
          ExitCodes.GENERAL_ERROR,
          format
        );
      }
    });
}
