import { z } from 'zod';

import { OptionalAccountSelectorSchema } from '../../accounts/account-selector.js';

export const ClearCommandOptionsSchema = OptionalAccountSelectorSchema.extend({
  platform: z.string().optional(),
  includeRaw: z.boolean().optional(),
  confirm: z.boolean().optional(),
  json: z.boolean().optional(),
}).refine((data) => !(data.platform && (data.accountName || data.accountRef)), {
  message: 'Cannot specify both an account selector and --platform',
});
