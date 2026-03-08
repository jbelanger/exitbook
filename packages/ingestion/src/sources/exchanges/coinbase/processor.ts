import { err, ok, type Result } from '@exitbook/core';
import type { RawCoinbaseLedgerEntry } from '@exitbook/exchange-providers';
import type { z } from 'zod';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { ProcessedTransaction } from '../../../shared/types/processors.js';
import {
  materializeProcessedTransaction,
  RawExchangeProcessorInputSchema,
  type ExchangeProcessingDiagnostic,
  type RawExchangeProcessorInput,
} from '../shared-v2/index.js';

import { buildCoinbaseCorrelationGroups } from './build-correlation-groups.js';
import { interpretCoinbaseGroup } from './interpret-group.js';
import { normalizeCoinbaseProviderEvent } from './normalize-provider-event.js';

/**
 * Coinbase processor built on provider-event normalization and explicit
 * provider-owned interpretation rules.
 */
export class CoinbaseProcessor extends BaseTransactionProcessor<RawExchangeProcessorInput<RawCoinbaseLedgerEntry>> {
  constructor() {
    super('coinbase');
  }

  protected get inputSchema(): z.ZodType<RawExchangeProcessorInput<RawCoinbaseLedgerEntry>> {
    return RawExchangeProcessorInputSchema as z.ZodType<RawExchangeProcessorInput<RawCoinbaseLedgerEntry>>;
  }

  protected async transformNormalizedData(
    rawInputs: RawExchangeProcessorInput<RawCoinbaseLedgerEntry>[]
  ): Promise<Result<ProcessedTransaction[], Error>> {
    const providerEvents = [];

    for (const input of rawInputs) {
      const normalizedResult = normalizeCoinbaseProviderEvent(input.raw, input.eventId);
      if (normalizedResult.isErr()) {
        return err(normalizedResult.error);
      }
      providerEvents.push(normalizedResult.value);
    }

    const groups = buildCoinbaseCorrelationGroups(providerEvents);
    const transactions: ProcessedTransaction[] = [];
    const diagnostics: ExchangeProcessingDiagnostic[] = [];

    for (const group of groups) {
      const interpretation = interpretCoinbaseGroup(group);

      if (interpretation.kind === 'confirmed') {
        transactions.push(materializeProcessedTransaction(interpretation.draft));
        continue;
      }

      diagnostics.push(interpretation.diagnostic);
    }

    for (const diagnostic of diagnostics) {
      const logContext = {
        code: diagnostic.code,
        correlationKey: diagnostic.correlationKey,
        evidence: diagnostic.evidence,
        providerEventIds: diagnostic.providerEventIds,
      };

      if (diagnostic.severity === 'error') {
        this.logger.error(logContext, diagnostic.message);
        continue;
      }

      if (diagnostic.severity === 'warning') {
        this.logger.warn(logContext, diagnostic.message);
        continue;
      }

      this.logger.info(logContext, diagnostic.message);
    }

    const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (blockingDiagnostics.length > 0) {
      const errorSummary = blockingDiagnostics
        .map((diagnostic) => `[${diagnostic.correlationKey}] ${diagnostic.code}: ${diagnostic.message}`)
        .join('; ');

      return err(
        new Error(
          `Coinbase processing cannot proceed: ${blockingDiagnostics.length}/${groups.length} group(s) were ambiguous or invalid. ${errorSummary}`
        )
      );
    }

    return ok(transactions);
  }
}
