import { z } from 'zod';

import type { FlatDeletionPreview } from './clear-handler.js';
import { ClearCommandOptionsSchema } from './clear-option-schemas.js';

export type ClearCommandOptions = z.infer<typeof ClearCommandOptionsSchema>;

export interface ClearCommandResult {
  deleted: FlatDeletionPreview;
}
