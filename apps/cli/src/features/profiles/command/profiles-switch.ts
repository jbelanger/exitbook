import { err, resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { ExitCodes, jsonSuccess, runCliRuntimeCommand, textSuccess, toCliResult } from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { formatSuccessLine } from '../../../cli/success.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';
import { formatProfileReference, withProfileKeyHint } from '../profile-display.js';
import { buildCliProfileService } from '../profile-service.js';
import { writeCliStateFile } from '../profile-state.js';

const PROFILES_SWITCH_COMMAND_ID = 'profiles-switch';

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
    .argument('<profile-key>', 'Stable profile key')
    .option('--json', 'Output results in JSON format')
    .action(async (profileKey: string, rawOptions: unknown) => {
      await executeSwitchProfileCommand(profileKey, rawOptions);
    });
}

async function executeSwitchProfileCommand(profileKey: string, rawOptions: unknown): Promise<void> {
  await runCliRuntimeCommand({
    command: PROFILES_SWITCH_COMMAND_ID,
    format: detectCliOutputFormat(rawOptions),
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, JsonFlagSchema);
      }),
    action: async ({ runtime, prepared }) =>
      resultDoAsync(async function* () {
        const db = await runtime.database();
        const profileService = buildCliProfileService(db);
        const resolveResult = await profileService.resolve(profileKey);
        if (resolveResult.isErr()) {
          return yield* toCliResult(
            err(await withProfileKeyHint(profileService, profileKey, resolveResult.error)),
            ExitCodes.GENERAL_ERROR
          );
        }

        const profile = resolveResult.value;

        yield* toCliResult(writeCliStateFile(runtime.dataDir, profile.profileKey), ExitCodes.GENERAL_ERROR);

        if (prepared.json) {
          return jsonSuccess({
            defaultProfileKey: profile.profileKey,
            profile,
          });
        }

        return textSuccess(() => {
          console.log(formatSuccessLine(`Default profile set to ${formatProfileReference(profile)}`));
        });
      }),
  });
}
