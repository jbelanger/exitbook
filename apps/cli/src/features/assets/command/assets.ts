import type { Command } from 'commander';

import { registerAssetsClearReviewCommand } from './assets-clear-review.js';
import { registerAssetsConfirmCommand } from './assets-confirm.js';
import { registerAssetsExcludeCommand } from './assets-exclude.js';
import { registerAssetsExclusionsCommand } from './assets-exclusions.js';
import { registerAssetsIncludeCommand } from './assets-include.js';
import { registerAssetsViewCommand } from './assets-view.js';

export function registerAssetsCommand(program: Command): void {
  const assets = program.command('assets').description('View assets and manage review or exclusion decisions');

  registerAssetsViewCommand(assets);
  registerAssetsConfirmCommand(assets);
  registerAssetsClearReviewCommand(assets);
  registerAssetsExcludeCommand(assets);
  registerAssetsIncludeCommand(assets);
  registerAssetsExclusionsCommand(assets);
}
