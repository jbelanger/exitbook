import { z } from 'zod';

import { OptionalAccountSelectorSchema } from '../../accounts/account-selector.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';

export const ImportCommandOptionsSchema = OptionalAccountSelectorSchema.extend({
  all: z.boolean().optional(),
})
  .extend(JsonFlagSchema.shape)
  .refine(
    (data) =>
      [data.accountName !== undefined, data.accountRef !== undefined, data.all === true].filter(Boolean).length === 1,
    {
      message: 'Specify exactly one of --account-name, --account-ref, or --all',
    }
  );
