import { err, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';

import {
  cliErr,
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliFailure,
} from '../../../cli/command.js';
import { JsonFlagSchema } from '../../../cli/option-schema-primitives.js';
import {
  detectCliOutputFormat,
  parseCliBrowseRootInvocationResult,
  parseCliCommandOptionsResult,
} from '../../../cli/options.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { withProfileKeyHint } from '../profile-display.js';
import { buildCliProfileService } from '../profile-service.js';
import type { ProfileDetailViewItem, ProfileListViewItem } from '../view/profiles-static-renderer.js';
import { outputProfilesStaticDetail, outputProfilesStaticList } from '../view/profiles-static-renderer.js';

interface ProfilesBrowseData {
  activeProfileKey: string;
  activeProfileSource: 'default' | 'env' | 'state';
  profiles: ProfileListViewItem[];
}

interface ProfilesViewData extends ProfilesBrowseData {
  profile: ProfileDetailViewItem;
}

export function registerProfilesBrowseOptions(command: Command): Command {
  return command.option('--json', 'Output results in JSON format');
}

export function parseProfilesBrowseRootInvocationResult(
  tokens: string[] | undefined
): Result<{ rawOptions: Record<string, unknown>; selector?: string | undefined }, CliFailure> {
  return parseCliBrowseRootInvocationResult(tokens, registerProfilesBrowseOptions);
}

export function buildProfilesRootSelectorError(selector: string): Result<never, CliFailure> {
  return cliErr(`Use "profiles view ${selector}" for static detail.`, ExitCodes.INVALID_ARGS);
}

export async function runProfilesListCommand(commandId: string, rawOptions: unknown): Promise<void> {
  await runCliRuntimeCommand({
    command: commandId,
    format: detectCliOutputFormat(rawOptions),
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, JsonFlagSchema);
      }),
    action: async ({ runtime, prepared }) =>
      resultDoAsync(async function* () {
        const data = yield* await loadProfilesBrowseData(runtime);

        if (prepared.json) {
          return jsonSuccess({
            activeProfileKey: data.activeProfileKey,
            activeProfileSource: data.activeProfileSource,
            profiles: data.profiles.map(toProfileJsonItem),
          });
        }

        return textSuccess(() => {
          outputProfilesStaticList({
            activeProfileKey: data.activeProfileKey,
            activeProfileSource: data.activeProfileSource,
            profiles: data.profiles,
          });
        });
      }),
  });
}

export async function runProfilesViewCommand(
  commandId: string,
  profileKey: string,
  rawOptions: unknown
): Promise<void> {
  await runCliRuntimeCommand({
    command: commandId,
    format: detectCliOutputFormat(rawOptions),
    prepare: async () =>
      resultDoAsync(async function* () {
        return {
          options: yield* parseCliCommandOptionsResult(rawOptions, JsonFlagSchema),
          profileKey,
        };
      }),
    action: async ({ runtime, prepared }) =>
      resultDoAsync(async function* () {
        const data = yield* await loadProfilesViewData(runtime, prepared.profileKey);

        if (prepared.options.json) {
          return jsonSuccess({
            activeProfileKey: data.activeProfileKey,
            activeProfileSource: data.activeProfileSource,
            profile: toProfileJsonItem(data.profile),
          });
        }

        return textSuccess(() => {
          outputProfilesStaticDetail({
            activeProfileKey: data.activeProfileKey,
            activeProfileSource: data.activeProfileSource,
            profile: data.profile,
          });
        });
      }),
  });
}

async function loadProfilesBrowseData(runtime: CommandRuntime): Promise<Result<ProfilesBrowseData, CliFailure>> {
  return resultDoAsync(async function* () {
    const db = await runtime.database();
    const profileService = buildCliProfileService(db);

    yield* toCliResult(await profileService.findOrCreateDefault(), ExitCodes.GENERAL_ERROR);
    const profiles = yield* toCliResult(await profileService.listSummaries(), ExitCodes.GENERAL_ERROR);

    return {
      activeProfileKey: runtime.activeProfileKey,
      activeProfileSource: runtime.activeProfileSource,
      profiles: profiles.map((profile) => toProfileListViewItem(profile, runtime.activeProfileKey)),
    };
  });
}

async function loadProfilesViewData(
  runtime: CommandRuntime,
  selector: string
): Promise<Result<ProfilesViewData, CliFailure>> {
  return resultDoAsync(async function* () {
    const db = await runtime.database();
    const profileService = buildCliProfileService(db);

    yield* toCliResult(await profileService.findOrCreateDefault(), ExitCodes.GENERAL_ERROR);
    const profileResult = await profileService.findByKey(selector);
    if (profileResult.isErr()) {
      return yield* toCliResult(
        err(await withProfileKeyHint(profileService, selector, profileResult.error)),
        ExitCodes.GENERAL_ERROR
      );
    }

    if (!profileResult.value) {
      return yield* err(
        createCliFailure(
          await withProfileKeyHint(
            profileService,
            selector,
            new Error(`Profile '${selector.trim().toLowerCase()}' not found`)
          ),
          ExitCodes.GENERAL_ERROR
        )
      );
    }

    const resolvedProfile = profileResult.value;
    const profiles = yield* toCliResult(await profileService.listSummaries(), ExitCodes.GENERAL_ERROR);
    const activeProfileKey = runtime.activeProfileKey;
    const activeProfileSource = runtime.activeProfileSource;
    const selectedSummary =
      profiles.find((profile) => profile.profileKey === resolvedProfile.profileKey) ??
      ({
        ...resolvedProfile,
        accountCount: 0,
      } satisfies ProfileListViewItem);

    return {
      activeProfileKey,
      activeProfileSource,
      profiles: profiles.map((profile) => toProfileListViewItem(profile, activeProfileKey)),
      profile: toProfileDetailViewItem(selectedSummary, activeProfileKey, activeProfileSource),
    };
  });
}

function toProfileListViewItem(profile: ProfileListViewItem, activeProfileKey: string): ProfileListViewItem {
  return {
    ...profile,
    isActive: profile.profileKey === activeProfileKey,
  };
}

function toProfileDetailViewItem(
  profile: ProfileListViewItem,
  activeProfileKey: string,
  activeProfileSource: 'default' | 'env' | 'state'
): ProfileDetailViewItem {
  return {
    ...profile,
    isActive: profile.profileKey === activeProfileKey,
    activeProfileSource: profile.profileKey === activeProfileKey ? activeProfileSource : undefined,
  };
}

function toProfileJsonItem(profile: ProfileListViewItem | ProfileDetailViewItem) {
  return {
    ...profile,
    createdAt: profile.createdAt.toISOString(),
  };
}
