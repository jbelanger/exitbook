import { z } from 'zod';

import { OptionalBareAccountSelectorSchema } from '../../accounts/account-selector.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';

export const ImportCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend({
  all: z.boolean().optional(),
})
  .extend(JsonFlagSchema.shape)
  .refine((data) => [data.selector !== undefined, data.all === true].filter(Boolean).length === 1, {
    message: 'Specify exactly one of <selector> or --all',
  });
