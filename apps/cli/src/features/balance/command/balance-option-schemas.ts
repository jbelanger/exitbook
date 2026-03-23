import { z } from 'zod';

import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';

export const BalanceViewCommandOptionsSchema = z
  .object({
    accountId: z.coerce.number().int().positive().optional(),
  })
  .extend(JsonFlagSchema.shape);

export const BalanceRefreshCommandOptionsSchema = z
  .object({
    accountId: z.coerce.number().int().positive().optional(),
  })
  .extend(
    z.object({
      apiKey: z.string().min(1).optional(),
      apiSecret: z.string().min(1).optional(),
      apiPassphrase: z.string().optional(),
    }).shape
  )
  .extend(JsonFlagSchema.shape)
  .refine(
    (data) => {
      if ((data.apiKey || data.apiSecret) && !(data.apiKey && data.apiSecret)) {
        return false;
      }
      return true;
    },
    {
      message: 'Both --api-key and --api-secret must be provided together',
    }
  )
  .refine(
    (data) => {
      if ((data.apiKey || data.apiSecret) && !data.accountId) {
        return false;
      }
      return true;
    },
    {
      message: '--api-key/--api-secret require --account-id',
    }
  );
