import { z } from 'zod';

import { ClearCommandOptionsSchema } from './clear-option-schemas.js';
import type { FlatDeletionPreview } from './clear-service.js';

export type ClearCommandOptions = z.infer<typeof ClearCommandOptionsSchema>;

export interface ClearCommandResult {
  deleted: FlatDeletionPreview;
}
