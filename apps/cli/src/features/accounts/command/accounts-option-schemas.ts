import { AccountTypeSchema } from '@exitbook/core';
import { z } from 'zod';

import {
  BlockchainFieldsSchema,
  CsvImportSchema,
  JsonFlagSchema,
  SourceSelectionSchema,
} from '../../../cli/option-schema-primitives.js';
import { OptionalBareAccountSelectorSchema } from '../account-selector.js';

export const AccountsBrowseCommandOptionsSchema = JsonFlagSchema.extend({
  platform: z.string().optional(),
  type: AccountTypeSchema.optional(),
  showSessions: z.boolean().optional(),
});

export const AccountsRefreshCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend(JsonFlagSchema.shape);

export const AccountsReconcileCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend(JsonFlagSchema.shape)
  .extend({
    all: z.boolean().optional(),
    reference: z.enum(['stored', 'live']).optional(),
    refreshLive: z.boolean().optional(),
    strict: z.boolean().optional(),
    tolerance: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.refreshLive === true && data.reference === 'stored') {
      ctx.addIssue({
        code: 'custom',
        message: '--refresh-live cannot be combined with --reference stored',
      });
    }
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
    const hasApiPair = data.apiKey !== undefined && data.apiSecret !== undefined;

    if (data.blockchain && !data.address) {
      ctx.addIssue({
        code: 'custom',
        message: '--address is required for blockchain accounts',
      });
    }

    if (data.exchange) {
      const hasCsv = !!data.csvDir;
      if (!hasCsv && !hasApiPair) {
        ctx.addIssue({
          code: 'custom',
          message: 'Exchange accounts require --csv-dir, API credentials (--api-key, --api-secret), or both',
        });
      }
    }

    if (data.apiPassphrase !== undefined && !hasApiPair) {
      ctx.addIssue({
        code: 'custom',
        message: '--api-passphrase requires --api-key and --api-secret',
      });
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
    name: z.string().min(1).optional(),
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
      data.name !== undefined ||
      data.apiKey !== undefined ||
      data.apiSecret !== undefined ||
      data.apiPassphrase !== undefined ||
      data.csvDir !== undefined ||
      data.provider !== undefined ||
      data.xpubGap !== undefined,
    {
      message: 'At least one account property flag is required',
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
