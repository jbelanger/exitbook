import { z } from 'zod';

import {
  BlockchainFieldsSchema,
  CsvImportSchema,
  JsonFlagSchema,
  SourceSelectionSchema,
  VerboseFlagSchema,
} from '../../shared/option-schema-primitives.js';

export const ImportCommandOptionsSchema = SourceSelectionSchema.extend(BlockchainFieldsSchema.shape)
  .extend(
    z.object({
      apiKey: z.string().min(1).optional(),
      apiSecret: z.string().min(1).optional(),
      apiPassphrase: z.string().optional(),
    }).shape
  )
  .extend(CsvImportSchema.shape)
  .extend(JsonFlagSchema.shape)
  .extend(VerboseFlagSchema.shape)
  .superRefine((data, ctx) => {
    if (data.blockchain && !data.address) {
      ctx.addIssue({
        code: 'custom',
        message: '--address is required for blockchain sources',
      });
    }

    if (data.exchange) {
      const hasCsv = !!data.csvDir;
      const hasApi = !!(data.apiKey && data.apiSecret);
      if (!hasCsv && !hasApi) {
        ctx.addIssue({
          code: 'custom',
          message: 'Either --csv-dir or API credentials (--api-key, --api-secret) are required for exchange sources',
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
