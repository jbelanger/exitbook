import type { Profile } from '@exitbook/core';
import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { buildCliProfileService } from '../profile-service.js';

export function registerProfilesListCommand(profilesCommand: Command): void {
  profilesCommand
    .command('list')
    .description('List profiles')
    .option('--json', 'Output results in JSON format')
    .action(async (options: { json?: boolean | undefined }) => {
      const format = options.json ? 'json' : 'text';

      try {
        await runCommand(async (ctx) => {
          const db = await ctx.database();
          const profileService = buildCliProfileService(db);
          const defaultProfileResult = await profileService.findOrCreateDefault();
          if (defaultProfileResult.isErr()) {
            displayCliError('profiles-list', defaultProfileResult.error, ExitCodes.GENERAL_ERROR, format);
          }

          const profilesResult = await profileService.list();
          if (profilesResult.isErr()) {
            displayCliError('profiles-list', profilesResult.error, ExitCodes.GENERAL_ERROR, format);
          }

          const profiles = profilesResult.value;
          const activeProfileName = ctx.activeProfileName;

          if (options.json) {
            outputSuccess('profiles-list', {
              activeProfileName,
              profiles: profiles.map((profile) => toProfileListItem(profile, activeProfileName)),
            });
            return;
          }

          for (const profile of profiles) {
            const marker = profile.name === activeProfileName ? '*' : ' ';
            console.log(`${marker} ${profile.name}`);
          }
        });
      } catch (error) {
        displayCliError(
          'profiles-list',
          error instanceof Error ? error : new Error(String(error)),
          ExitCodes.GENERAL_ERROR,
          format
        );
      }
    });
}

function toProfileListItem(profile: Profile, activeProfileName: string) {
  return {
    id: profile.id,
    name: profile.name,
    isActive: profile.name === activeProfileName,
    createdAt: profile.createdAt.toISOString(),
  };
}
