import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { runCliRuntimeCommand } from '../../shared/cli-boundary.js';
import { jsonSuccess, textSuccess, toCliResult } from '../../shared/cli-contract.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { buildCliProfileService } from '../profile-service.js';

export function registerProfilesRenameCommand(profilesCommand: Command): void {
  profilesCommand
    .command('rename')
    .description('Rename a profile label without changing its key')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook profiles rename business "Business Holdings"
  $ exitbook profiles rename default "Personal"
  $ exitbook profiles rename business "Business Holdings" --json

Notes:
  - Renaming changes the display label only; the profile key stays the same.
`
    )
    .argument('<profile>', 'Profile key')
    .argument('<display-name>', 'Profile display name')
    .option('--json', 'Output results in JSON format')
    .action(async (profileKey: string, displayName: string, options: { json?: boolean | undefined }) => {
      const format = options.json ? 'json' : 'text';
      await runCliRuntimeCommand({
        command: 'profiles-rename',
        format,
        action: async (ctx) =>
          resultDoAsync(async function* () {
            const db = await ctx.database();
            const profile = yield* toCliResult(
              await buildCliProfileService(db).rename(profileKey, displayName),
              ExitCodes.GENERAL_ERROR
            );

            if (format === 'json') {
              return jsonSuccess({ profile });
            }

            return textSuccess(() => {
              console.log(`Renamed profile ${profile.profileKey} to ${profile.displayName}`);
            });
          }),
      });
    });
}
