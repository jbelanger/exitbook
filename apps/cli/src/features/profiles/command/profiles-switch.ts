import { DEFAULT_PROFILE_NAME } from '@exitbook/core';
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
    .description('Set the default active profile for future commands')
    .argument('<name>', 'Profile name')
    .option('--json', 'Output results in JSON format')
    .action(async (name: string, options: { json?: boolean | undefined }) => {
      const format = options.json ? 'json' : 'text';

      try {
        await runCommand(async (ctx) => {
          const db = await ctx.database();
          const profileService = buildCliProfileService(db);
          const normalizedName = name.trim().toLowerCase();
          const profileResult =
            normalizedName === DEFAULT_PROFILE_NAME
              ? await profileService.findOrCreateDefault()
              : await profileService.findByName(name);

          if (profileResult.isErr()) {
            displayCliError('profiles-switch', profileResult.error, ExitCodes.GENERAL_ERROR, format);
          }
          if (!profileResult.value) {
            displayCliError(
              'profiles-switch',
              new Error(`Profile '${normalizedName}' not found`),
              ExitCodes.GENERAL_ERROR,
              format
            );
          }

          const writeResult = writeCliStateFile(ctx.dataDir, profileResult.value.name);
          if (writeResult.isErr()) {
            displayCliError('profiles-switch', writeResult.error, ExitCodes.GENERAL_ERROR, format);
          }

          if (options.json) {
            outputSuccess('profiles-switch', { defaultProfileName: profileResult.value.name });
            return;
          }

          console.log(`Default profile set to ${profileResult.value.name}`);
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
