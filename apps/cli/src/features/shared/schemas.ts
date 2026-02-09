import { z } from 'zod';

export const JsonFlagSchema = z.object({
  json: z.boolean().optional(),
});

export const VerboseFlagSchema = z.object({
  verbose: z.boolean().optional(),
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
 * Import command options (combines all import-related schemas)
 */
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
    // For blockchain: address is required
    if (data.blockchain && !data.address) {
      ctx.addIssue({
        code: 'custom',
        message: '--address is required for blockchain sources',
      });
    }
    // For exchange: either csvDir OR (apiKey + apiSecret), not both
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
      // If apiKey provided without apiSecret, or vice versa
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
      // xpubGap validation
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

/**
 * Balance command options
 */
export const BalanceCommandOptionsSchema = z
  .object({
    accountId: z.coerce.number().int().positive().optional(),
    offline: z.boolean().optional(),
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
      // Both apiKey and apiSecret must be provided together
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
      // Credentials only valid with --account-id and without --offline
      if ((data.apiKey || data.apiSecret) && !data.accountId) {
        return false;
      }
      return true;
    },
    {
      message: '--api-key/--api-secret require --account-id',
    }
  )
  .refine(
    (data) => {
      // Credentials not valid with --offline
      if ((data.apiKey || data.apiSecret) && data.offline) {
        return false;
      }
      return true;
    },
    {
      message: '--api-key/--api-secret cannot be used with --offline',
    }
  );

/**
 * Export command options
 */
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

/**
 * Reprocess command options
 */
export const ProcessCommandOptionsSchema = JsonFlagSchema.extend({
  accountId: z.coerce.number().int().positive().optional(),
}).extend(VerboseFlagSchema.shape);

/**
 * Clear command options
 */
export const ClearCommandOptionsSchema = z.object({
  accountId: z.number().int().positive().optional(),
  source: z.string().optional(),
  includeRaw: z.boolean().optional(),
  confirm: z.boolean().optional(),
  json: z.boolean().optional(),
});

/**
 * Links view command options
 */
export const LinksViewCommandOptionsSchema = z
  .object({
    status: z.enum(['suggested', 'confirmed', 'rejected', 'gaps']).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    maxConfidence: z.number().min(0).max(1).optional(),
    limit: z.number().int().positive().optional(),
    verbose: z.boolean().optional(),
    json: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // minConfidence must be <= maxConfidence
      if (data.minConfidence !== undefined && data.maxConfidence !== undefined) {
        return data.minConfidence <= data.maxConfidence;
      }
      return true;
    },
    {
      message: 'min-confidence must be less than or equal to max-confidence',
    }
  );

/**
 * Links run command options
 */
export const LinksRunCommandOptionsSchema = z
  .object({
    dryRun: z.boolean().optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    autoConfirmThreshold: z.number().min(0).max(1).optional(),
    json: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // autoConfirmThreshold must be >= minConfidence
      if (data.autoConfirmThreshold !== undefined && data.minConfidence !== undefined) {
        return data.autoConfirmThreshold >= data.minConfidence;
      }
      return true;
    },
    {
      message: 'auto-confirm-threshold must be greater than or equal to min-confidence',
    }
  );

/**
 * Links confirm command options (linkId is an argument, not validated here)
 */
export const LinksConfirmCommandOptionsSchema = JsonFlagSchema;

/**
 * Links reject command options (linkId is an argument, not validated here)
 */
export const LinksRejectCommandOptionsSchema = JsonFlagSchema;

/**
 * Transactions view command options
 */
export const TransactionsViewCommandOptionsSchema = z.object({
  source: z.string().optional(),
  asset: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  operationType: z.string().optional(),
  noPrice: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
  json: z.boolean().optional(),
});

/**
 * Prices view command options
 */
export const PricesViewCommandOptionsSchema = z.object({
  source: z.string().optional(),
  asset: z.string().optional(),
  missingOnly: z.boolean().optional(),
  json: z.boolean().optional(),
});

/**
 * Prices enrich command options
 */
export const PricesEnrichCommandOptionsSchema = z.object({
  asset: z.array(z.string()).optional(),
  onMissing: z.enum(['fail']).optional(),
  deriveOnly: z.boolean().optional(),
  normalizeOnly: z.boolean().optional(),
  fetchOnly: z.boolean().optional(),
  json: z.boolean().optional(),
});

/**
 * Prices set command options
 */
export const PricesSetCommandOptionsSchema = z.object({
  asset: z.string(),
  date: z.string(),
  price: z.string(),
  currency: z.string().optional(),
  source: z.string().optional(),
  json: z.boolean().optional(),
});

/**
 * Prices set-fx command options
 */
export const PricesSetFxCommandOptionsSchema = z.object({
  from: z.string(),
  to: z.string(),
  date: z.string(),
  rate: z.string(),
  source: z.string().optional(),
  json: z.boolean().optional(),
});

/**
 * Cost-basis command options
 */
export const CostBasisCommandOptionsSchema = z.object({
  method: z.string().optional(),
  jurisdiction: z.string().optional(),
  taxYear: z.string().optional(),
  fiatCurrency: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  calculationId: z.string().optional(),
  asset: z.string().optional(),
  json: z.boolean().optional(),
});

/**
 * Accounts view command options
 */
export const AccountsViewCommandOptionsSchema = z.object({
  accountId: z.number().int().positive().optional(),
  source: z.string().optional(),
  type: z.string().optional(),
  showSessions: z.boolean().optional(),
  json: z.boolean().optional(),
});

/**
 * Blockchains view command options
 */
export const BlockchainsViewCommandOptionsSchema = z.object({
  category: z.string().optional(),
  requiresApiKey: z.boolean().optional(),
  json: z.boolean().optional(),
});

/**
 * Benchmark-rate-limit command options
 */
export const BenchmarkRateLimitCommandOptionsSchema = z.object({
  blockchain: z.string(),
  provider: z.string(),
  maxRate: z.string().optional(),
  rates: z.string().optional(),
  numRequests: z.string().optional(),
  skipBurst: z.boolean().optional(),
  json: z.boolean().optional(),
});
