import { z } from 'zod';

import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';

export const ReprocessCommandOptionsSchema = JsonFlagSchema.extend({
  accountId: z.coerce.number().int().positive().optional(),
});
