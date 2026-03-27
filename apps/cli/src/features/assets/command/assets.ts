import type { Command } from 'commander';

import { registerAssetsClearReviewCommand } from './assets-clear-review.js';
import { registerAssetsConfirmCommand } from './assets-confirm.js';
import { registerAssetsExcludeCommand } from './assets-exclude.js';
import { registerAssetsExclusionsCommand } from './assets-exclusions.js';
import { registerAssetsIncludeCommand } from './assets-include.js';
import { registerAssetsViewCommand } from './assets-view.js';

export function registerAssetsCommand(program: Command): void {
  const assets = program
    .command('assets')
    .description('View assets and manage review or exclusion decisions')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook assets view --action-required
  $ exitbook assets confirm --symbol USDC
  $ exitbook assets exclude --asset-id blockchain:ethereum:0xa0b8...
  $ exitbook assets exclusions

Notes:
  - Use review and exclusion commands to resolve ambiguous or suspicious assets before accounting.
`
    );

  registerAssetsViewCommand(assets);
  registerAssetsConfirmCommand(assets);
  registerAssetsClearReviewCommand(assets);
  registerAssetsExcludeCommand(assets);
  registerAssetsIncludeCommand(assets);
  registerAssetsExclusionsCommand(assets);
}
