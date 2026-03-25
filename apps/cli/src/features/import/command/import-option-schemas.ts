import { z } from 'zod';

import { JsonFlagSchema, ProfileFlagSchema, VerboseFlagSchema } from '../../shared/option-schema-primitives.js';

export const ImportCommandOptionsSchema = z
  .object({
    account: z.string().trim().min(1).optional(),
    accountId: z.number().int().positive().optional(),
    all: z.boolean().optional(),
  })
  .extend(ProfileFlagSchema.shape)
  .extend(JsonFlagSchema.shape)
  .extend(VerboseFlagSchema.shape)
  .refine(
    (data) =>
      [data.account !== undefined, data.accountId !== undefined, data.all === true].filter(Boolean).length === 1,
    {
      message: 'Specify exactly one of --account, --account-id, or --all',
    }
  );
