import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { ExitCodes, jsonSuccess, runCliRuntimeCommand, textSuccess, toCliResult } from '../../../cli/command.js';
import { formatSuccessLine } from '../../../cli/success.js';
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
      await runCliRuntimeCommand({
        command: 'profiles-switch',
        format,
        action: async (ctx) =>
          resultDoAsync(async function* () {
            const db = await ctx.database();
            const profileService = buildCliProfileService(db);
            const profile = yield* toCliResult(await profileService.resolve(profileKey), ExitCodes.GENERAL_ERROR);

            yield* toCliResult(writeCliStateFile(ctx.dataDir, profile.profileKey), ExitCodes.GENERAL_ERROR);

            if (format === 'json') {
              return jsonSuccess({
                defaultProfileKey: profile.profileKey,
                profile,
              });
            }

            return textSuccess(() => {
              console.log(
                formatSuccessLine(`Default profile set to ${profile.displayName} [key: ${profile.profileKey}]`)
              );
            });
          }),
      });
    });
}
