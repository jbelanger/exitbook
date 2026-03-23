import type { TransactionDraft } from '@exitbook/core';
import type { KrakenLedgerEntry } from '@exitbook/exchange-providers/kraken';
import { err, ok, type Result } from '@exitbook/foundation';
import type { z } from 'zod';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import {
  RawExchangeProcessorInputSchema,
  buildExchangeProcessingFailureError,
  collectExchangeProcessingBatchResult,
  logExchangeProcessingDiagnostics,
  type RawExchangeProcessorInput,
} from '../shared/index.js';

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
  ): Promise<Result<TransactionDraft[], Error>> {
    const providerEvents = [];

    for (const input of rawInputs) {
      const normalizedResult = normalizeKrakenProviderEvent(input.raw, input.eventId);
      if (normalizedResult.isErr()) {
        return err(normalizedResult.error);
      }
      providerEvents.push(normalizedResult.value);
    }

    const groups = buildKrakenCorrelationGroups(providerEvents);
    const batchResult = collectExchangeProcessingBatchResult(groups, interpretKrakenGroup);
    logExchangeProcessingDiagnostics(this.logger, batchResult.diagnostics);

    const failure = buildExchangeProcessingFailureError('Kraken', groups.length, batchResult.diagnostics);
    if (failure) {
      return err(failure);
    }

    return ok(batchResult.transactions);
  }
}
