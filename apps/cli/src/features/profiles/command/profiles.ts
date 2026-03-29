import type { Command } from 'commander';

import { registerProfilesAddCommand } from './profiles-add.js';
import { registerProfilesCurrentCommand } from './profiles-current.js';
import { registerProfilesListCommand } from './profiles-list.js';
import { registerProfilesRenameCommand } from './profiles-rename.js';
import { registerProfilesSwitchCommand } from './profiles-switch.js';

export function registerProfilesCommand(program: Command): void {
  const profiles = program
    .command('profiles')
    .description('Manage isolated profiles within one data directory')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook profiles list
  $ exitbook profiles add business
  $ exitbook profiles switch business
  $ exitbook profiles current

Notes:
  - Profiles isolate independent datasets and reporting contexts in the same data directory.
  - EXITBOOK_PROFILE overrides the saved default profile for the current process.
`
    );

  registerProfilesAddCommand(profiles);
  registerProfilesListCommand(profiles);
  registerProfilesRenameCommand(profiles);
  registerProfilesSwitchCommand(profiles);
  registerProfilesCurrentCommand(profiles);
}
