import type { Command } from 'commander';

import { registerProfilesAddCommand } from './profiles-add.js';
import { registerProfilesCurrentCommand } from './profiles-current.js';
import { registerProfilesListCommand } from './profiles-list.js';
import { registerProfilesRenameCommand } from './profiles-rename.js';
import { registerProfilesSwitchCommand } from './profiles-switch.js';

export function registerProfilesCommand(program: Command): void {
  const profiles = program.command('profiles').description('Manage CLI profiles');

  registerProfilesAddCommand(profiles);
  registerProfilesListCommand(profiles);
  registerProfilesRenameCommand(profiles);
  registerProfilesSwitchCommand(profiles);
  registerProfilesCurrentCommand(profiles);
}
