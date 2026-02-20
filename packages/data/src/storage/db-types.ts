import type { Kysely } from '@exitbook/sqlite';

import type { DatabaseSchema } from '../schema/database-schema.js';

export type KyselyDB = Kysely<DatabaseSchema>;
