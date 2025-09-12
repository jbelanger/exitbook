import * as path from 'node:path';

import { runMigrations } from '@exitbook/platform-database';

const migrationFolder = path.join(import.meta.dirname, 'migrations');
runMigrations(migrationFolder);
