import { err, ok, type Result, type TransactionDraft } from '@exitbook/core';
import type { RawCoinbaseLedgerEntry } from '@exitbook/exchange-providers';
import type { z } from 'zod';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import {
  RawExchangeProcessorInputSchema,
  buildExchangeProcessingFailureError,
  collectExchangeProcessingBatchResult,
  logExchangeProcessingDiagnostics,
  type RawExchangeProcessorInput,
} from '../shared/index.js';

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
  ): Promise<Result<TransactionDraft[], Error>> {
    const providerEvents = [];

    for (const input of rawInputs) {
      const normalizedResult = normalizeCoinbaseProviderEvent(input.raw, input.eventId);
      if (normalizedResult.isErr()) {
        return err(normalizedResult.error);
      }
      providerEvents.push(normalizedResult.value);
    }

    const groups = buildCoinbaseCorrelationGroups(providerEvents);
    const batchResult = collectExchangeProcessingBatchResult(groups, interpretCoinbaseGroup);
    logExchangeProcessingDiagnostics(this.logger, batchResult.diagnostics);

    const failure = buildExchangeProcessingFailureError('Coinbase', groups.length, batchResult.diagnostics);
    if (failure) {
      return err(failure);
    }

    return ok(batchResult.transactions);
  }
}
