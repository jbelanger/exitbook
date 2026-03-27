import { z } from 'zod';

import { OptionalSourceSelectionSchema } from '../../shared/option-schema-primitives.js';

export const ExportCommandOptionsSchema = OptionalSourceSelectionSchema.merge(
  z.object({
    format: z.enum(['csv', 'json']).optional().default('csv'),
    csvFormat: z.enum(['normalized', 'simple']).optional(),
    output: z.string().optional(),
    since: z.string().optional(),
    json: z.boolean().optional(),
  })
).superRefine((data, ctx) => {
  if (data.format !== 'csv' && data.csvFormat) {
    ctx.addIssue({
      code: 'custom',
      message: '--csv-format is only supported when --format csv is selected',
    });
  }
});

export const TransactionsViewCommandOptionsSchema = z.object({
  platform: z.string().optional(),
  asset: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  operationType: z.string().optional(),
  noPrice: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
  json: z.boolean().optional(),
});

export const TransactionsExportCommandOptionsSchema = z
  .object({
    format: z.enum(['csv', 'json']).optional().default('csv'),
    csvFormat: z.enum(['normalized', 'simple']).optional(),
    output: z.string().optional(),
    json: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.format !== 'csv' && data.csvFormat) {
      ctx.addIssue({
        code: 'custom',
        message: '--csv-format is only supported when --format csv is selected',
      });
    }
  });

export const TransactionsEditNoteCommandOptionsSchema = z
  .object({
    clear: z.boolean().optional(),
    message: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    json: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.message && !data.clear) {
      ctx.addIssue({
        code: 'custom',
        message: 'Either --message or --clear is required',
      });
    }

    if (data.message && data.clear) {
      ctx.addIssue({
        code: 'custom',
        message: 'Cannot specify both --message and --clear',
      });
    }
  });
