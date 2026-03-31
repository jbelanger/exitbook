import type { Profile } from '@exitbook/core';
import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { ExitCodes, jsonSuccess, runCliRuntimeCommand, textSuccess, toCliResult } from '../../../cli/command.js';
import { buildCliProfileService } from '../profile-service.js';

export function registerProfilesListCommand(profilesCommand: Command): void {
  profilesCommand
    .command('list')
    .description('List profiles and mark the active one')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook profiles list
  $ exitbook profiles list --json

Notes:
  - In text output, "*" marks the active profile.
`
    )
    .option('--json', 'Output results in JSON format')
    .action(async (options: { json?: boolean | undefined }) => {
      const format = options.json ? 'json' : 'text';
      await runCliRuntimeCommand({
        command: 'profiles-list',
        format,
        action: async (ctx) =>
          resultDoAsync(async function* () {
            const db = await ctx.database();
            const profileService = buildCliProfileService(db);

            yield* toCliResult(await profileService.findOrCreateDefault(), ExitCodes.GENERAL_ERROR);

            const profiles = yield* toCliResult(await profileService.list(), ExitCodes.GENERAL_ERROR);
            const activeProfileKey = ctx.activeProfileKey;

            if (format === 'json') {
              return jsonSuccess({
                activeProfileKey,
                profiles: profiles.map((profile) => toProfileListItem(profile, activeProfileKey)),
              });
            }

            return textSuccess(() => {
              for (const profile of profiles) {
                const marker = profile.profileKey === activeProfileKey ? '*' : ' ';
                console.log(`${marker} ${profile.displayName} [key: ${profile.profileKey}]`);
              }
            });
          }),
      });
    });
}

function toProfileListItem(profile: Profile, activeProfileKey: string) {
  return {
    id: profile.id,
    profileKey: profile.profileKey,
    displayName: profile.displayName,
    isActive: profile.profileKey === activeProfileKey,
    createdAt: profile.createdAt.toISOString(),
  };
}
