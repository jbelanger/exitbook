import { z } from 'zod';

import { OptionalBareAccountSelectorSchema } from '../../accounts/account-selector.js';

export const ClearCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend({
  platform: z.string().optional(),
  includeRaw: z.boolean().optional(),
  confirm: z.boolean().optional(),
  json: z.boolean().optional(),
}).refine((data) => !(data.platform && data.selector), {
  message: 'Cannot specify both an account selector and --platform',
});
