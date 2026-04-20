import { validateMethodJurisdictionCombination } from '@exitbook/accounting/cost-basis';
import { z } from 'zod';

export const JsonFlagSchema = z.object({
  json: z.boolean().optional(),
});

export const SourceSelectionSchema = z
  .object({
    exchange: z.string().optional(),
    blockchain: z.string().optional(),
  })
  .refine((data) => !!(data.exchange || data.blockchain), {
    message: 'Either --exchange or --blockchain is required',
  })
  .refine((data) => !(data.exchange && data.blockchain), {
    message: 'Cannot specify both --exchange and --blockchain',
  });

export const OptionalSourceSelectionSchema = z
  .object({
    exchange: z.string().optional(),
    blockchain: z.string().optional(),
  })
  .refine((data) => !(data.exchange && data.blockchain), {
    message: 'Cannot specify both --exchange and --blockchain',
  });

export const BlockchainFieldsSchema = z.object({
  address: z.string().optional(),
  provider: z.string().optional(),
  xpubGap: z.number().int().positive().optional(),
});

export const CsvImportSchema = z.object({
  csvDir: z.string().optional(),
});

/**
 * Translates the canonical accounting method/jurisdiction validation into a
 * Zod refinement for CLI option parsing.
 */
export function validateAccountingMethodJurisdictionOptions(
  data: { jurisdiction?: string | undefined; method?: string | undefined },
  ctx: z.RefinementCtx
): void {
  if (!data.method || !data.jurisdiction) {
    return;
  }

  const method = data.method.toLowerCase();
  const jurisdiction = data.jurisdiction.toUpperCase();
  const result = validateMethodJurisdictionCombination(
    method as Parameters<typeof validateMethodJurisdictionCombination>[0],
    jurisdiction as Parameters<typeof validateMethodJurisdictionCombination>[1]
  );

  if (result.isErr()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.error.message,
      path: ['method'],
    });
  }
}
