import * as path from 'node:path';

import type { MigrationManifest } from '@exitbook/platform-database';

export const eventBusMigrations: MigrationManifest = {
  folder: path.join(import.meta.dirname),
  package: 'platform-event-bus',
} as const;
