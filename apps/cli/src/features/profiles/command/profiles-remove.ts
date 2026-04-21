import { err, resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import { z } from 'zod';

import {
  cliErr,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
} from '../../../cli/command.js';
import { JsonFlagSchema } from '../../../cli/option-schema-primitives.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { promptConfirmDecision } from '../../../cli/prompts.js';
import { formatSuccessLine } from '../../../cli/success.js';
import { formatProfileReference, withProfileKeyHint } from '../profile-display.js';
import { buildCliProfileService } from '../profile-service.js';
import { clearCliStateFile, readCliStateFile } from '../profile-state.js';

import type { ProfileRemovalImpactCounts } from './profile-removal-service.js';
import { prepareProfileRemoval, runProfileRemoval } from './run-profiles-remove.js';

const PROFILES_REMOVE_COMMAND_ID = 'profiles-remove';

export function registerProfilesRemoveCommand(profilesCommand: Command): void {
  profilesCommand
    .command('remove')
    .description('Remove a profile, purge its account data, and reset affected projections')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook profiles remove business
  $ exitbook profiles remove tax-audit --confirm
  $ exitbook profiles remove business --confirm --json

Notes:
  - This deletes the profile, all accounts it owns, attached raw data, and affected derived projections.
  - You cannot remove the current profile for this process.
  - --confirm is required with --json because JSON mode cannot prompt interactively.
`
    )
    .argument('<profile-key>', 'Stable profile key')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--json', 'Output results in JSON format')
    .action(async (profileKey: string, rawOptions: unknown) => {
      await executeRemoveProfileCommand(profileKey, rawOptions);
    });
}

async function executeRemoveProfileCommand(profileKey: string, rawOptions: unknown): Promise<void> {
  await runCliRuntimeCommand({
    command: PROFILES_REMOVE_COMMAND_ID,
    format: detectCliOutputFormat(rawOptions),
    prepare: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, ProfilesRemoveCommandOptionsSchema);

        if (options.json && !options.confirm) {
          return yield* cliErr(
            '--confirm is required when using --json for destructive profile removal',
            ExitCodes.INVALID_ARGS
          );
        }

        return options;
      }),
    action: async ({ runtime, prepared }) =>
      resultDoAsync(async function* () {
        const db = await runtime.openDatabaseSession();
        const profileService = buildCliProfileService(db);
        const preparationResult = await prepareProfileRemoval(db, profileService, profileKey);
        if (preparationResult.isErr()) {
          return yield* toCliResult(
            err(await withProfileKeyHint(profileService, profileKey, preparationResult.error)),
            ExitCodes.GENERAL_ERROR
          );
        }

        const preparation = preparationResult.value;
        const profileReference = formatProfileReference(preparation.profile);

        if (preparation.profile.profileKey === runtime.activeProfileKey) {
          return yield* cliErr(
            buildActiveProfileRemovalError(preparation.profile.profileKey, runtime.activeProfileSource),
            ExitCodes.INVALID_ARGS
          );
        }

        if (!prepared.confirm && !prepared.json) {
          outputRemovalPreview(profileReference, preparation.preview);
          const decision = await promptConfirmDecision(
            `Delete profile ${profileReference} and the data shown above?`,
            false
          );
          if (decision !== 'confirmed') {
            return textSuccess(
              () => {
                console.error('Profile removal cancelled');
              },
              decision === 'cancelled' ? ExitCodes.CANCELLED : undefined
            );
          }
        }

        const savedStateReferencesProfile = savedStateReferencesRemovedProfile(
          runtime.dataDir,
          preparation.profile.profileKey
        );
        const removal = yield* toCliResult(
          await runProfileRemoval(db, preparation.profile.profileKey, preparation.accountIds),
          ExitCodes.GENERAL_ERROR
        );

        if (savedStateReferencesProfile) {
          const clearStateResult = clearCliStateFile(runtime.dataDir);
          if (clearStateResult.isErr()) {
            return yield* cliErr(
              new Error(
                `Removed profile ${profileReference}, but failed to clear saved default profile state: ${clearStateResult.error.message}`
              ),
              ExitCodes.GENERAL_ERROR
            );
          }
        }

        if (prepared.json) {
          return jsonSuccess({
            clearedSavedDefault: savedStateReferencesProfile,
            deleted: removal.deleted,
            profile: preparation.profile.profileKey,
          });
        }

        return textSuccess(() => {
          console.log(formatSuccessLine(`Removed profile ${profileReference}`));
        });
      }),
  });
}

function savedStateReferencesRemovedProfile(dataDir: string, profileKey: string): boolean {
  const stateResult = readCliStateFile(dataDir);
  if (stateResult.isErr()) {
    return false;
  }

  return stateResult.value.activeProfileKey === profileKey;
}

function buildActiveProfileRemovalError(profileKey: string, source: 'default' | 'env' | 'state'): Error {
  if (source === 'env') {
    return new Error(`Cannot remove the current profile '${profileKey}'. Unset EXITBOOK_PROFILE first.`);
  }

  return new Error(`Cannot remove the current profile '${profileKey}'. Switch to another profile first.`);
}

const ProfilesRemoveCommandOptionsSchema = JsonFlagSchema.extend({
  confirm: z.boolean().optional(),
});

function outputRemovalPreview(profileReference: string, preview: ProfileRemovalImpactCounts): void {
  console.error(`Deleting profile ${profileReference} will remove:`);
  writeRemovalPreviewCount(preview.profiles, 'profile');
  writeRemovalPreviewCount(preview.accounts, 'account');

  outputRemovalPreviewSection('Imported data', [
    { count: preview.sessions, singularLabel: 'import session' },
    { count: preview.rawData, singularLabel: 'raw import data item' },
  ]);

  outputRemovalPreviewSection('Derived data', [
    { count: preview.transactions, singularLabel: 'transaction' },
    { count: preview.links, singularLabel: 'transaction link' },
    { count: preview.assetReviewStates, singularLabel: 'review item' },
    {
      count: preview.balanceSnapshots + preview.balanceSnapshotAssets,
      singularLabel: 'balance',
    },
    { count: preview.costBasisSnapshots, singularLabel: 'cost basis snapshot' },
  ]);
}

function outputRemovalPreviewSection(
  heading: string,
  items: readonly { count: number; pluralLabel?: string | undefined; singularLabel: string }[]
): void {
  const visibleItems = items.filter((item) => item.count > 0);
  if (visibleItems.length === 0) {
    return;
  }

  console.error('');
  console.error(`${heading}:`);
  for (const item of visibleItems) {
    writeRemovalPreviewCount(item.count, item.singularLabel, item.pluralLabel);
  }
}

function writeRemovalPreviewCount(count: number, singularLabel: string, pluralLabel = `${singularLabel}s`): void {
  if (count <= 0) {
    return;
  }

  console.error(`  - ${count} ${count === 1 ? singularLabel : pluralLabel}`);
}
