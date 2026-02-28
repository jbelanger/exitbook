import path from 'node:path';

import {
  CostBasisReportGenerator,
  StandardFxRateProvider,
  runCostBasisPipeline,
  validateCostBasisParams,
  type AcquisitionLot,
  type AssetMatchError,
  type CostBasisCalculation,
  type CostBasisInput,
  type CostBasisReport,
  type CostBasisSummary,
  type LotDisposal,
  type LotTransfer,
} from '@exitbook/accounting';
import { type Currency, type UniversalTransactionData } from '@exitbook/core';
import { type DataContext } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { createPriceProviderManager } from '@exitbook/price-providers';
import { err, ok, type Result } from 'neverthrow';

import type { CommandContext, CommandDatabase } from '../shared/command-runtime.js';
import { getDataDir } from '../shared/data-dir.js';
import { ensureLinks, ensurePrices } from '../shared/prereqs.js';

export type { CostBasisInput };

const logger = getLogger('CostBasisHandler');

/**
 * Result of the cost basis calculation operation.
 */
export interface CostBasisResult {
  /** Calculation summary */
  summary: CostBasisSummary;
  /** Warning if any transactions are missing prices */
  missingPricesWarning?: string | undefined;
  /** Report with display currency conversion (if displayCurrency != USD) */
  report?: CostBasisReport | undefined;
  /** Lots created during calculation (for detailed JSON output) */
  lots: AcquisitionLot[];
  /** Disposals processed during calculation (for detailed JSON output) */
  disposals: LotDisposal[];
  /** Lot transfers during calculation (for detailed JSON output) */
  lotTransfers: LotTransfer[];
  /** Per-asset calculation errors (partial failure) */
  errors: AssetMatchError[];
}

/**
 * Cost Basis Handler - Encapsulates all cost basis calculation business logic.
 * Tier 2 handler — query-only constructor, external factory handles prereq orchestration.
 */
export class CostBasisHandler {
  constructor(private readonly db: DataContext) {}

  /**
   * Execute the cost basis calculation.
   */
  async execute(params: CostBasisInput): Promise<Result<CostBasisResult, Error>> {
    try {
      const validation = validateCostBasisParams(params);
      if (validation.isErr()) {
        return err(validation.error);
      }

      const { config } = params;
      logger.debug({ config }, 'Starting cost basis calculation');

      // 1. Fetch and filter transactions to the report window
      const txResult = await this.fetchTransactionsForWindow(config);
      if (txResult.isErr()) {
        return err(txResult.error);
      }

      // 2. Validate prices, get jurisdiction rules, run lot matching + gain/loss
      const pipelineResult = await runCostBasisPipeline(
        txResult.value,
        config,
        this.db.transactions,
        this.db.transactionLinks
      );
      if (pipelineResult.isErr()) {
        return err(pipelineResult.error);
      }

      const { summary, missingPricesCount } = pipelineResult.value;

      logger.info(
        {
          calculationId: summary.calculation.id,
          lotsCreated: summary.lotsCreated,
          disposalsProcessed: summary.disposalsProcessed,
          assetsProcessed: summary.assetsProcessed.length,
        },
        'Cost basis calculation completed'
      );

      const { lots, disposals, lotTransfers } = summary;

      // 3. Generate optional report with currency conversion
      let report: CostBasisReport | undefined;
      if (config.currency !== 'USD') {
        const reportResult = await this.generateReport(
          summary.calculation,
          disposals,
          lots,
          lotTransfers,
          config.currency as Currency
        );
        if (reportResult.isErr()) {
          return err(reportResult.error);
        }
        report = reportResult.value;
      }

      return ok({
        summary,
        missingPricesWarning:
          missingPricesCount > 0
            ? `${missingPricesCount} transactions were excluded due to missing prices. Run 'exitbook prices fetch' to populate missing prices.`
            : undefined,
        report,
        lots,
        disposals,
        lotTransfers,
        errors: summary.errors,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Fetch and filter transactions to the report window end date.
   * Pre-period acquisitions are included so the lot pool is complete.
   */
  private async fetchTransactionsForWindow(
    config: CostBasisInput['config']
  ): Promise<Result<UniversalTransactionData[], Error>> {
    // Guard against any non-CLI callers that bypass validation.
    if (!config.startDate || !config.endDate) {
      return err(new Error('Start date and end date must be defined'));
    }

    const transactionsResult = await this.db.transactions.getTransactions();
    if (transactionsResult.isErr()) {
      return err(transactionsResult.error);
    }

    const allTransactions = transactionsResult.value;
    if (allTransactions.length === 0) {
      return err(
        new Error('No transactions found in database. Please import transactions using the import command first.')
      );
    }

    // Include all transactions up to end of reporting period.
    // Pre-period acquisitions are needed to build the lot pool — e.g. a 2023 buy
    // must exist so a 2024 transfer/disposal can match against it.
    // The calculator filters output disposals to [startDate, endDate] for reporting.
    const transactionsUpToEndDate = allTransactions.filter((tx) => new Date(tx.timestamp) <= config.endDate);

    if (transactionsUpToEndDate.length === 0) {
      return err(new Error(`No transactions found on or before ${config.endDate.toISOString().split('T')[0]}`));
    }

    return ok(transactionsUpToEndDate);
  }

  /**
   * Generate cost basis report with currency conversion
   */
  private async generateReport(
    calculation: CostBasisCalculation,
    disposals: LotDisposal[],
    lots: AcquisitionLot[],
    lotTransfers: LotTransfer[],
    displayCurrency: Currency
  ): Promise<Result<CostBasisReport, Error>> {
    logger.info({ displayCurrency }, 'Generating report with currency conversion');

    const dataDir = getDataDir();
    const priceManagerResult = await createPriceProviderManager({
      providers: { databasePath: path.join(dataDir, 'prices.db') },
    });
    if (priceManagerResult.isErr()) {
      return err(new Error(`Failed to create price provider manager: ${priceManagerResult.error.message}`));
    }

    const priceManager = priceManagerResult.value;
    try {
      const fxProvider = new StandardFxRateProvider(priceManager);
      const reportGenerator = new CostBasisReportGenerator(fxProvider);

      const reportResult = await reportGenerator.generateReport({
        calculation,
        disposals,
        lots,
        lotTransfers,
        displayCurrency,
      });
      if (reportResult.isErr()) {
        return err(reportResult.error);
      }

      const report = reportResult.value;
      logger.info(
        {
          calculationId: calculation.id,
          displayCurrency,
          disposalsConverted: report.disposals.length,
          lotsConverted: report.lots.length,
          transfersConverted: report.lotTransfers.length,
        },
        'Report generation completed'
      );

      return ok(report);
    } finally {
      await priceManager.destroy();
    }
  }
}

/**
 * Create a CostBasisHandler with prereqs (linking + price enrichment) run first.
 * Factory runs prereqs -- command files NEVER call ensureLinks/ensurePrices directly.
 */
export async function createCostBasisHandler(
  ctx: CommandContext,
  database: CommandDatabase,
  options: { isJsonMode: boolean; params: CostBasisInput }
): Promise<Result<CostBasisHandler, Error>> {
  let prereqAbort: (() => void) | undefined;
  if (!options.isJsonMode) {
    ctx.onAbort(() => {
      prereqAbort?.();
    });
  }

  // Run linking prereq
  const linksResult = await ensureLinks(database, ctx.dataDir, {
    isJsonMode: options.isJsonMode,
    setAbort: (abort) => {
      prereqAbort = abort;
    },
  });
  if (linksResult.isErr()) {
    return err(linksResult.error);
  }

  // Run price enrichment prereq (needs date range from params)
  const { config } = options.params;
  if (config.startDate && config.endDate) {
    const pricesResult = await ensurePrices(database, config.startDate, config.endDate, config.currency, {
      isJsonMode: options.isJsonMode,
      setAbort: (abort) => {
        prereqAbort = abort;
      },
    });
    if (pricesResult.isErr()) {
      return err(pricesResult.error);
    }
  }

  prereqAbort = undefined;
  return ok(new CostBasisHandler(database));
}
