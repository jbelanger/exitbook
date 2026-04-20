import { z } from 'zod';

import { JsonFlagSchema } from '../../../cli/option-schema-primitives.js';
import { OptionalBareAccountSelectorSchema } from '../../accounts/account-selector.js';

export const ImportCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend({
  all: z.boolean().optional(),
})
  .extend(JsonFlagSchema.shape)
  .refine((data) => [data.selector !== undefined, data.all === true].filter(Boolean).length === 1, {
    message: 'Specify exactly one of <selector> or --all',
  });
