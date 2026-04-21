import { err, resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import { z } from 'zod';

import { ExitCodes, jsonSuccess, runCliRuntimeCommand, textSuccess, toCliResult } from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { formatSuccessLine } from '../../../cli/success.js';
import { withProfileKeyHint } from '../profile-display.js';
import { buildCliProfileService } from '../profile-service.js';

const PROFILES_UPDATE_COMMAND_ID = 'profiles-update';

const ProfilesUpdateCommandOptionsSchema = z
  .object({
    json: z.boolean().optional(),
    label: z.string().min(1).optional(),
  })
  .refine((data) => data.label !== undefined, {
    message: 'At least one profile property flag is required',
  });

type ProfilesUpdateCommandOptions = z.infer<typeof ProfilesUpdateCommandOptionsSchema>;

export function registerProfilesUpdateCommand(profilesCommand: Command): void {
  profilesCommand
    .command('update')
    .description('Update profile properties')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook profiles update business --label "Business Holdings"
  $ exitbook profiles update default --label Personal
  $ exitbook profiles update business --label "Business Holdings" --json

Notes:
  - Updating a profile changes the display label only; the stable profile key stays the same.
`
    )
    .argument('<profile-key>', 'Stable profile key')
    .option('--label <display-label>', 'New profile display label')
    .option('--json', 'Output results in JSON format')
    .action(async (profileKey: string, rawOptions: unknown) => {
      await executeUpdateProfileCommand(profileKey, rawOptions);
    });
}

async function executeUpdateProfileCommand(profileKey: string, rawOptions: unknown): Promise<void> {
  await runCliRuntimeCommand({
    command: PROFILES_UPDATE_COMMAND_ID,
    format: detectCliOutputFormat(rawOptions),
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, ProfilesUpdateCommandOptionsSchema);
      }),
    action: async ({ runtime, prepared }) =>
      resultDoAsync(async function* () {
        const db = await runtime.openDatabaseSession();
        const profileService = buildCliProfileService(db);
        const updateResult = await profileService.update(profileKey, buildUpdateProfileInput(prepared));
        if (updateResult.isErr()) {
          return yield* toCliResult(
            err(await withProfileKeyHint(profileService, profileKey, updateResult.error)),
            ExitCodes.GENERAL_ERROR
          );
        }

        const profile = updateResult.value;

        if (prepared.json) {
          return jsonSuccess({ profile });
        }

        return textSuccess(() => {
          console.log(formatSuccessLine(`Updated profile ${profile.profileKey} label to ${profile.displayName}`));
        });
      }),
  });
}

function buildUpdateProfileInput(options: ProfilesUpdateCommandOptions) {
  return {
    displayName: options.label,
  };
}
