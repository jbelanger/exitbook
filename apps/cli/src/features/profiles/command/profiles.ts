import type { ProfileSummary } from '@exitbook/accounts';
import { resultDoAsync } from '@exitbook/foundation';
import { Command } from 'commander';

import { ExitCodes, jsonSuccess, runCliRuntimeCommand, textSuccess, toCliResult } from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';
import { buildCliProfileService } from '../profile-service.js';
import { outputProfilesStaticList } from '../view/profiles-static-renderer.js';

import { registerProfilesAddCommand } from './profiles-add.js';
import { registerProfilesRemoveCommand } from './profiles-remove.js';
import { registerProfilesSwitchCommand } from './profiles-switch.js';
import { registerProfilesUpdateCommand } from './profiles-update.js';

const PROFILES_COMMAND_ID = 'profiles';

export function registerProfilesCommand(program: Command): void {
  const profiles = program
    .command('profiles')
    .description('Manage isolated profiles within one data directory')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook profiles
  $ exitbook profiles add business
  $ exitbook profiles remove business
  $ exitbook profiles update business --label "Business Holdings"
  $ exitbook profiles switch business

Notes:
  - Profiles isolate independent datasets and reporting contexts in the same data directory.
  - EXITBOOK_PROFILE overrides the saved default profile for the current process.
`
    )
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await runCliRuntimeCommand({
        command: PROFILES_COMMAND_ID,
        format: detectCliOutputFormat(rawOptions),
        prepare: async () =>
          resultDoAsync(async function* () {
            return yield* parseCliCommandOptionsResult(rawOptions, JsonFlagSchema);
          }),
        action: async ({ runtime, prepared }) =>
          resultDoAsync(async function* () {
            const db = await runtime.database();
            const profileService = buildCliProfileService(db);

            yield* toCliResult(await profileService.findOrCreateDefault(), ExitCodes.GENERAL_ERROR);

            const profilesList = yield* toCliResult(await profileService.listSummaries(), ExitCodes.GENERAL_ERROR);
            const activeProfileKey = runtime.activeProfileKey;
            const activeProfileSource = runtime.activeProfileSource;

            if (prepared.json) {
              return jsonSuccess({
                activeProfileKey,
                activeProfileSource,
                profiles: profilesList.map((profile) => toProfileListItem(profile, activeProfileKey)),
              });
            }

            return textSuccess(() => {
              outputProfilesStaticList({
                activeProfileKey,
                activeProfileSource,
                profiles: profilesList,
              });
            });
          }),
      });
    });

  registerProfilesAddCommand(profiles);
  registerProfilesRemoveCommand(profiles);
  registerProfilesUpdateCommand(profiles);
  registerProfilesSwitchCommand(profiles);
}

function toProfileListItem(profile: ProfileSummary, activeProfileKey: string) {
  return {
    accountCount: profile.accountCount,
    id: profile.id,
    profileKey: profile.profileKey,
    displayName: profile.displayName,
    isActive: profile.profileKey === activeProfileKey,
    createdAt: profile.createdAt.toISOString(),
  };
}
