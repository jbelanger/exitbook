import type { Command } from 'commander';

import { registerProfilesBrowseOptions, runProfilesViewCommand } from './profiles-browse-command.js';

export function registerProfilesViewCommand(profilesCommand: Command): void {
  registerProfilesBrowseOptions(
    profilesCommand
      .command('view <profile-key>')
      .description('Show static detail for one profile')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook profiles view business
  $ exitbook profiles view default
  $ exitbook profiles view business --json

Notes:
  - Use the stable profile key, not the display label.
`
      )
  ).action(async (profileKey: string, rawOptions: unknown) => {
    await runProfilesViewCommand('profiles-view', profileKey, rawOptions);
  });
}
