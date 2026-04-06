import { Command } from 'commander';

import { exitCliFailure } from '../../../cli/error.js';
import { detectCliTokenOutputFormat } from '../../../cli/options.js';

import { registerProfilesAddCommand } from './profiles-add.js';
import {
  buildProfilesRootSelectorError,
  parseProfilesBrowseRootInvocationResult,
  runProfilesListCommand,
} from './profiles-browse-command.js';
import { registerProfilesListCommand } from './profiles-list.js';
import { registerProfilesRemoveCommand } from './profiles-remove.js';
import { registerProfilesSwitchCommand } from './profiles-switch.js';
import { registerProfilesUpdateCommand } from './profiles-update.js';
import { registerProfilesViewCommand } from './profiles-view.js';

const PROFILES_COMMAND_ID = 'profiles';

export function registerProfilesCommand(program: Command): void {
  const profiles = program
    .command('profiles')
    .usage('[options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Manage isolated profiles within one data directory')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook profiles
  $ exitbook profiles list
  $ exitbook profiles view business
  $ exitbook profiles add business
  $ exitbook profiles remove business
  $ exitbook profiles update business --label "Business Holdings"
  $ exitbook profiles switch business

Notes:
  - Profiles isolate independent datasets and reporting contexts in the same data directory.
  - Use bare "profiles" or "profiles list" for a static list of workspaces.
  - Use "profiles view <profile-key>" for one static profile detail card.
  - EXITBOOK_PROFILE overrides the saved default profile for the current process.
`
    )
    .action(async (tokens: string[] | undefined) => {
      const format = detectCliTokenOutputFormat(tokens);
      const parsedInvocationResult = parseProfilesBrowseRootInvocationResult(tokens);
      if (parsedInvocationResult.isErr()) {
        exitCliFailure(PROFILES_COMMAND_ID, parsedInvocationResult.error, format);
        return;
      }

      const selector = parsedInvocationResult.value.selector?.trim();
      if (selector) {
        const selectorErrorResult = buildProfilesRootSelectorError(selector);
        if (selectorErrorResult.isErr()) {
          exitCliFailure(PROFILES_COMMAND_ID, selectorErrorResult.error, format);
          return;
        }
      }

      await runProfilesListCommand(PROFILES_COMMAND_ID, parsedInvocationResult.value.rawOptions);
    });

  registerProfilesListCommand(profiles);
  registerProfilesViewCommand(profiles);
  registerProfilesAddCommand(profiles);
  registerProfilesRemoveCommand(profiles);
  registerProfilesUpdateCommand(profiles);
  registerProfilesSwitchCommand(profiles);
}
