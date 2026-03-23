import { z } from 'zod';

import { JsonFlagSchema, VerboseFlagSchema } from '../../shared/option-schema-primitives.js';

export const ProcessCommandOptionsSchema = JsonFlagSchema.extend({
  accountId: z.coerce.number().int().positive().optional(),
}).extend(VerboseFlagSchema.shape);
