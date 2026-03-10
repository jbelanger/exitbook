import type { Command } from 'commander';

import { registerAssetsExcludeCommand } from './assets-exclude.js';
import { registerAssetsExclusionsCommand } from './assets-exclusions.js';
import { registerAssetsIncludeCommand } from './assets-include.js';

export function registerAssetsCommand(program: Command): void {
  const assets = program.command('assets').description('Manage accounting asset overrides');

  registerAssetsExcludeCommand(assets);
  registerAssetsIncludeCommand(assets);
  registerAssetsExclusionsCommand(assets);
}
