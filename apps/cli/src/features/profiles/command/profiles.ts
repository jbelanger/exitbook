import type { Command } from 'commander';

import { registerProfilesAddCommand } from './profiles-add.js';
import { registerProfilesCurrentCommand } from './profiles-current.js';
import { registerProfilesListCommand } from './profiles-list.js';
import { registerProfilesRenameCommand } from './profiles-rename.js';
import { registerProfilesSwitchCommand } from './profiles-switch.js';

export function registerProfilesCommand(program: Command): void {
  const profiles = program
    .command('profiles')
    .description('Manage CLI profiles')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook profiles list
  $ exitbook profiles add business
  $ exitbook profiles switch business
  $ exitbook profiles current

Notes:
  - Profiles let you isolate independent datasets and workflows in the same data directory.
`
    );

  registerProfilesAddCommand(profiles);
  registerProfilesListCommand(profiles);
  registerProfilesRenameCommand(profiles);
  registerProfilesSwitchCommand(profiles);
  registerProfilesCurrentCommand(profiles);
}
