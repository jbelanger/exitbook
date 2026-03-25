import type { Command } from 'commander';

import { runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { buildCliAccountLifecycleService } from '../account-service.js';

export function registerAccountsRenameCommand(accountsCommand: Command): void {
  accountsCommand
    .command('rename')
    .description('Rename a named account')
    .argument('<current-name>', 'Existing account name')
    .argument('<next-name>', 'New account name')
    .option('--profile <name>', 'Use a specific profile instead of the active profile')
    .option('--json', 'Output results in JSON format')
    .action(
      async (
        currentName: string,
        nextName: string,
        options: { json?: boolean | undefined; profile?: string | undefined }
      ) => {
        const format = options.json ? 'json' : 'text';

        try {
          await runCommand(async (ctx) => {
            const db = await ctx.database();
            const profileResult = await resolveCommandProfile(ctx, db, options.profile);
            if (profileResult.isErr()) {
              displayCliError('accounts-rename', profileResult.error, ExitCodes.GENERAL_ERROR, format);
            }

            const renameResult = await buildCliAccountLifecycleService(db).rename(
              profileResult.value.id,
              currentName,
              nextName
            );
            if (renameResult.isErr()) {
              displayCliError('accounts-rename', renameResult.error, ExitCodes.GENERAL_ERROR, format);
            }

            const payload = {
              account: {
                id: renameResult.value.id,
                name: renameResult.value.name,
                platformKey: renameResult.value.platformKey,
              },
              profile: profileResult.value.name,
            };

            if (options.json) {
              outputSuccess('accounts-rename', payload);
              return;
            }

            console.log(`Renamed account ${currentName.trim().toLowerCase()} to ${renameResult.value.name}`);
          });
        } catch (error) {
          displayCliError(
            'accounts-rename',
            error instanceof Error ? error : new Error(String(error)),
            ExitCodes.GENERAL_ERROR,
            format
          );
        }
      }
    );
}
