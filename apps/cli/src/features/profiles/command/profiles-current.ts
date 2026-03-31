import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { ExitCodes, jsonSuccess, runCliRuntimeCommand, textSuccess, toCliResult } from '../../../cli/command.js';
import { resolveCommandProfile } from '../profile-resolution.js';

export function registerProfilesCurrentCommand(profilesCommand: Command): void {
  profilesCommand
    .command('current')
    .description('Show which profile this command will use')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook profiles current
  $ exitbook profiles current --json

Notes:
  - The output includes the resolved profile and whether it came from default, env, or saved state.
`
    )
    .option('--json', 'Output results in JSON format')
    .action(async (options: { json?: boolean | undefined }) => {
      const format = options.json ? 'json' : 'text';
      await runCliRuntimeCommand({
        command: 'profiles-current',
        format,
        action: async (ctx) =>
          resultDoAsync(async function* () {
            const db = await ctx.database();
            const profile = yield* toCliResult(await resolveCommandProfile(ctx, db), ExitCodes.GENERAL_ERROR);
            const payload = {
              profile,
              source: ctx.activeProfileSource,
            };

            if (format === 'json') {
              return jsonSuccess(payload);
            }

            return textSuccess(() => {
              const sourceSuffix = ctx.activeProfileSource === 'default' ? '' : ` (${ctx.activeProfileSource})`;
              console.log(`${profile.displayName} [key: ${profile.profileKey}]${sourceSuffix}`);
            });
          }),
      });
    });
}
