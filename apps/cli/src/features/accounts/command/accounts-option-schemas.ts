import { AccountTypeSchema } from '@exitbook/core';
import { z } from 'zod';

import {
  BlockchainFieldsSchema,
  CsvImportSchema,
  JsonFlagSchema,
  SourceSelectionSchema,
} from '../../shared/option-schema-primitives.js';
import { AccountSelectorValueSchema } from '../account-selector.js';

export const AccountsBrowseCommandOptionsSchema = JsonFlagSchema.extend({
  account: AccountSelectorValueSchema.optional(),
  platform: z.string().optional(),
  type: AccountTypeSchema.optional(),
  showSessions: z.boolean().optional(),
});

export const AccountAddCommandOptionsSchema = SourceSelectionSchema.extend(BlockchainFieldsSchema.shape)
  .extend(
    z.object({
      apiKey: z.string().min(1).optional(),
      apiSecret: z.string().min(1).optional(),
      apiPassphrase: z.string().optional(),
    }).shape
  )
  .extend(CsvImportSchema.shape)
  .extend(JsonFlagSchema.shape)
  .superRefine((data, ctx) => {
    if (data.blockchain && !data.address) {
      ctx.addIssue({
        code: 'custom',
        message: '--address is required for blockchain accounts',
      });
    }

    if (data.exchange) {
      const hasCsv = !!data.csvDir;
      const hasApi = !!(data.apiKey && data.apiSecret);
      if (!hasCsv && !hasApi) {
        ctx.addIssue({
          code: 'custom',
          message: 'Either --csv-dir or API credentials (--api-key, --api-secret) are required for exchange accounts',
        });
      }
      if (hasCsv && hasApi) {
        ctx.addIssue({
          code: 'custom',
          message: 'Cannot specify both --csv-dir and API credentials',
        });
      }
    }
  })
  .refine(
    (data: { apiKey?: string | undefined; apiSecret?: string | undefined }) => {
      if (data.apiKey && !data.apiSecret) {
        return false;
      }
      if (!data.apiKey && data.apiSecret) {
        return false;
      }
      return true;
    },
    {
      message: '--api-key and --api-secret must be provided together',
    }
  )
  .refine(
    (data: { xpubGap?: number | undefined }) => {
      if (data.xpubGap !== undefined) {
        if (!Number.isFinite(data.xpubGap)) {
          return false;
        }
        if (data.xpubGap < 1) {
          return false;
        }
      }
      return true;
    },
    {
      message: '--xpub-gap must be a positive integer (minimum: 1)',
    }
  );

export const AccountUpdateCommandOptionsSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    apiSecret: z.string().min(1).optional(),
    apiPassphrase: z.string().optional(),
    csvDir: z.string().optional(),
    provider: z.string().optional(),
    json: z.boolean().optional(),
    xpubGap: z.number().int().positive().optional(),
  })
  .refine(
    (data) =>
      data.apiKey !== undefined ||
      data.apiSecret !== undefined ||
      data.apiPassphrase !== undefined ||
      data.csvDir !== undefined ||
      data.provider !== undefined ||
      data.xpubGap !== undefined,
    {
      message: 'At least one account config flag is required',
    }
  )
  .refine(
    (data) => {
      if (data.xpubGap !== undefined) {
        if (!Number.isFinite(data.xpubGap)) {
          return false;
        }
        if (data.xpubGap < 1) {
          return false;
        }
      }
      return true;
    },
    {
      message: '--xpub-gap must be a positive integer (minimum: 1)',
    }
  );

export type AccountAddCommandOptions = z.infer<typeof AccountAddCommandOptionsSchema>;
export type AccountUpdateCommandOptions = z.infer<typeof AccountUpdateCommandOptionsSchema>;
