import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { ExitCodes, jsonSuccess, runCliRuntimeCommand, textSuccess, toCliResult } from '../../../cli/command.js';
import { JsonFlagSchema } from '../../../cli/option-schema-primitives.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { formatSuccessLine } from '../../../cli/success.js';
import { buildCliProfileService } from '../profile-service.js';

const PROFILES_ADD_COMMAND_ID = 'profiles-add';

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
    .action(async (profileKey: string, rawOptions: unknown) => {
      await executeAddProfileCommand(profileKey, rawOptions);
    });
}

async function executeAddProfileCommand(profileKey: string, rawOptions: unknown): Promise<void> {
  await runCliRuntimeCommand({
    command: PROFILES_ADD_COMMAND_ID,
    format: detectCliOutputFormat(rawOptions),
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, JsonFlagSchema);
      }),
    action: async ({ runtime, prepared }) =>
      resultDoAsync(async function* () {
        const db = await runtime.database();
        const profile = yield* toCliResult(
          await buildCliProfileService(db).create(profileKey),
          ExitCodes.GENERAL_ERROR
        );

        if (prepared.json) {
          return jsonSuccess({ profile });
        }

        return textSuccess(() => {
          console.log(formatSuccessLine(`Added profile ${profile.displayName} [key: ${profile.profileKey}]`));
        });
      }),
  });
}
