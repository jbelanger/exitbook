import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { ExitCodes, jsonSuccess, runCliRuntimeCommand, textSuccess, toCliResult } from '../../../cli/command.js';
import { formatSuccessLine } from '../../../cli/success.js';
import { buildCliProfileService } from '../profile-service.js';

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
    .action(async (profileKey: string, options: { json?: boolean | undefined }) => {
      const format = options.json ? 'json' : 'text';
      await runCliRuntimeCommand({
        command: 'profiles-add',
        format,
        action: async (ctx) =>
          resultDoAsync(async function* () {
            const db = await ctx.database();
            const profile = yield* toCliResult(
              await buildCliProfileService(db).create(profileKey),
              ExitCodes.GENERAL_ERROR
            );

            if (format === 'json') {
              return jsonSuccess({ profile });
            }

            return textSuccess(() => {
              console.log(formatSuccessLine(`Added profile ${profile.displayName} [key: ${profile.profileKey}]`));
            });
          }),
      });
    });
}
