import { err, ok, type Result } from '@exitbook/core';
import type { KrakenLedgerEntry } from '@exitbook/exchange-providers';
import type { z } from 'zod';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { ProcessedTransaction } from '../../../shared/types/processors.js';
import {
  materializeProcessedTransaction,
  RawExchangeProcessorInputSchema,
  type ExchangeProcessingDiagnostic,
  type RawExchangeProcessorInput,
} from '../shared-v2/index.js';

import { buildKrakenCorrelationGroups } from './build-correlation-groups.js';
import { interpretKrakenGroup } from './interpret-group.js';
import { normalizeKrakenProviderEvent } from './normalize-provider-event.js';

/**
 * Kraken processor built on provider-event normalization and explicit
 * interpretation outcomes. Ambiguous same-asset opposing groups fail closed
 * instead of being materialized as transfers.
 */
export class KrakenProcessor extends BaseTransactionProcessor<RawExchangeProcessorInput<KrakenLedgerEntry>> {
  constructor() {
    super('kraken');
  }

  protected get inputSchema(): z.ZodType<RawExchangeProcessorInput<KrakenLedgerEntry>> {
    return RawExchangeProcessorInputSchema as z.ZodType<RawExchangeProcessorInput<KrakenLedgerEntry>>;
  }

  protected async transformNormalizedData(
    rawInputs: RawExchangeProcessorInput<KrakenLedgerEntry>[]
  ): Promise<Result<ProcessedTransaction[], Error>> {
    const providerEvents = [];

    for (const input of rawInputs) {
      const normalizedResult = normalizeKrakenProviderEvent(input.raw, input.eventId);
      if (normalizedResult.isErr()) {
        return err(normalizedResult.error);
      }
      providerEvents.push(normalizedResult.value);
    }

    const groups = buildKrakenCorrelationGroups(providerEvents);
    const transactions: ProcessedTransaction[] = [];
    const diagnostics: ExchangeProcessingDiagnostic[] = [];

    for (const group of groups) {
      const interpretation = interpretKrakenGroup(group);

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
          `Kraken processing cannot proceed: ${blockingDiagnostics.length}/${groups.length} group(s) were ambiguous or invalid. ${errorSummary}`
        )
      );
    }

    return ok(transactions);
  }
}
