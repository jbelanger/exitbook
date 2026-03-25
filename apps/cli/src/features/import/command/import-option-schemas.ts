import { z } from 'zod';

import { JsonFlagSchema, ProfileFlagSchema, VerboseFlagSchema } from '../../shared/option-schema-primitives.js';

export const ImportCommandOptionsSchema = z
  .object({
    account: z.string().trim().min(1).optional(),
    accountId: z.number().int().positive().optional(),
  })
  .extend(ProfileFlagSchema.shape)
  .extend(JsonFlagSchema.shape)
  .extend(VerboseFlagSchema.shape)
  .refine((data) => data.account !== undefined || data.accountId !== undefined, {
    message: 'Either --account or --account-id is required',
  })
  .refine((data) => !(data.account !== undefined && data.accountId !== undefined), {
    message: 'Cannot specify both --account and --account-id',
  });
