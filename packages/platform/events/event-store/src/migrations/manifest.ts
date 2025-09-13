import * as path from 'node:path';

import type { MigrationManifest } from '@exitbook/platform-database';

export const eventStoreMigrations: MigrationManifest = {
  folder: path.join(import.meta.dirname),
  package: 'platform-event-store',
} as const;
