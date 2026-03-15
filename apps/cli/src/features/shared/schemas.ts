import { z } from 'zod';

const JsonFlagSchema = z.object({
  json: z.boolean().optional(),
});

const VerboseFlagSchema = z.object({
  verbose: z.boolean().optional(),
});

const SourceSelectionSchema = z
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

const OptionalSourceSelectionSchema = z
  .object({
    exchange: z.string().optional(),
    blockchain: z.string().optional(),
  })
  .refine((data) => !(data.exchange && data.blockchain), {
    message: 'Cannot specify both --exchange and --blockchain',
  });

const BlockchainFieldsSchema = z.object({
  address: z.string().optional(),
  provider: z.string().optional(),
  xpubGap: z.number().int().positive().optional(),
});

const CsvImportSchema = z.object({
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
 * Balance view command options
 */
export const BalanceViewCommandOptionsSchema = z
  .object({
    accountId: z.coerce.number().int().positive().optional(),
  })
  .extend(JsonFlagSchema.shape);

/**
 * Balance refresh command options
 */
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
      // Credentials are only valid when refreshing a specific account scope
      if ((data.apiKey || data.apiSecret) && !data.accountId) {
        return false;
      }
      return true;
    },
    {
      message: '--api-key/--api-secret require --account-id',
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
 * Transactions export command options
 */
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

const AssetSelectionCommandOptionsSchema = z
  .object({
    assetId: z.string().min(1).optional(),
    symbol: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.assetId || data.symbol), {
    message: 'Either --asset-id or --symbol is required',
  })
  .refine((data) => !(data.assetId && data.symbol), {
    message: 'Specify only one of --asset-id or --symbol',
  });

export const AssetsExcludeCommandOptionsSchema = AssetSelectionCommandOptionsSchema.extend({
  reason: z.string().min(1).optional(),
  json: z.boolean().optional(),
});

export const AssetsIncludeCommandOptionsSchema = AssetSelectionCommandOptionsSchema.extend({
  reason: z.string().min(1).optional(),
  json: z.boolean().optional(),
});

export const AssetsConfirmCommandOptionsSchema = AssetSelectionCommandOptionsSchema.extend({
  reason: z.string().min(1).optional(),
  json: z.boolean().optional(),
});

export const AssetsClearReviewCommandOptionsSchema = AssetSelectionCommandOptionsSchema.extend({
  reason: z.string().min(1).optional(),
  json: z.boolean().optional(),
});

export const AssetsExclusionsCommandOptionsSchema = z.object({
  json: z.boolean().optional(),
});

export const AssetsViewCommandOptionsSchema = z.object({
  actionRequired: z.boolean().optional(),
  needsReview: z.boolean().optional(),
  json: z.boolean().optional(),
});

interface CostBasisMethodJurisdictionOptions {
  jurisdiction?: string | undefined;
  method?: string | undefined;
}

function validateCostBasisMethodJurisdictionCombination(
  data: CostBasisMethodJurisdictionOptions,
  ctx: z.RefinementCtx
): void {
  if (data.method === 'average-cost' && data.jurisdiction && data.jurisdiction !== 'CA') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'average-cost method is only valid with CA jurisdiction',
      path: ['method'],
    });
  }

  if (data.jurisdiction === 'CA' && data.method && data.method !== 'average-cost') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'CA jurisdiction currently supports only average-cost (ACB)',
      path: ['method'],
    });
  }
}

/**
 * Cost-basis command options
 */
export const CostBasisCommandOptionsSchema = z
  .object({
    method: z.string().optional(),
    jurisdiction: z.string().optional(),
    taxYear: z.string().optional(),
    fiatCurrency: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    asset: z.string().optional(),
    refresh: z.boolean().optional(),
    json: z.boolean().optional(),
  })
  .superRefine(validateCostBasisMethodJurisdictionCombination);

export const CostBasisExportCommandOptionsSchema = z
  .object({
    method: z.string().optional(),
    jurisdiction: z.string().optional(),
    taxYear: z.string().optional(),
    fiatCurrency: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    asset: z.string().optional(),
    refresh: z.boolean().optional(),
    json: z.boolean().optional(),
    format: z.literal('tax-package').optional(),
    output: z.string().optional(),
  })
  .superRefine(validateCostBasisMethodJurisdictionCombination);

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
 * Providers view command options
 */
export const ProvidersViewCommandOptionsSchema = z.object({
  blockchain: z.string().optional(),
  health: z.enum(['healthy', 'degraded', 'unhealthy']).optional(),
  missingApiKey: z.boolean().optional(),
  json: z.boolean().optional(),
});

/**
 * Providers benchmark command options
 */
export const ProvidersBenchmarkCommandOptionsSchema = z.object({
  blockchain: z.string(),
  provider: z.string(),
  maxRate: z.string().optional(),
  rates: z.string().optional(),
  numRequests: z.string().optional(),
  skipBurst: z.boolean().optional(),
  json: z.boolean().optional(),
});

/**
 * Portfolio command options
 */
export const PortfolioCommandOptionsSchema = z
  .object({
    method: z.string().optional(),
    jurisdiction: z.string().optional(),
    fiatCurrency: z.string().optional(),
    asOf: z.string().optional(),
    json: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // average-cost only valid with CA jurisdiction
      if (data.method === 'average-cost' && data.jurisdiction && data.jurisdiction !== 'CA') {
        return false;
      }
      if (data.jurisdiction === 'CA' && data.method && data.method !== 'average-cost') {
        return false;
      }
      return true;
    },
    {
      message: 'CA portfolio uses only average-cost, and average-cost is only valid with CA jurisdiction',
    }
  );
