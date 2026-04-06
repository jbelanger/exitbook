import type { Command } from 'commander';

import { registerProfilesBrowseOptions, runProfilesListCommand } from './profiles-browse-command.js';

export function registerProfilesListCommand(profilesCommand: Command): void {
  registerProfilesBrowseOptions(
    profilesCommand
      .command('list')
      .description('Show a static list of profiles')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook profiles list
  $ exitbook profiles list --json
`
      )
  ).action(async (rawOptions: unknown) => {
    await runProfilesListCommand('profiles-list', rawOptions);
  });
}
