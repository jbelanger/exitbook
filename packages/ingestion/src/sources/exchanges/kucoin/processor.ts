import type { TransactionDraft } from '@exitbook/core';
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

import { buildKucoinCorrelationGroups } from './build-correlation-groups.js';
import { interpretKucoinGroup } from './interpret-group.js';
import { normalizeKucoinProviderEvent } from './normalize-provider-event.js';
import type { KucoinCsvRow } from './types.js';

/**
 * KuCoin CSV processor built on provider-event normalization and explicit
 * provider-owned interpretation rules.
 */
export class KucoinCsvProcessor extends BaseTransactionProcessor<RawExchangeProcessorInput<KucoinCsvRow>> {
  constructor() {
    super('kucoin');
  }

  protected get inputSchema(): z.ZodType<RawExchangeProcessorInput<KucoinCsvRow>> {
    return RawExchangeProcessorInputSchema as z.ZodType<RawExchangeProcessorInput<KucoinCsvRow>>;
  }

  protected async transformNormalizedData(
    rawInputs: RawExchangeProcessorInput<KucoinCsvRow>[]
  ): Promise<Result<TransactionDraft[], Error>> {
    const providerEvents = [];

    for (const input of rawInputs) {
      const normalizedResult = normalizeKucoinProviderEvent(input.raw, input.eventId);
      if (normalizedResult.isErr()) {
        return err(normalizedResult.error);
      }
      providerEvents.push(normalizedResult.value);
    }

    const groups = buildKucoinCorrelationGroups(providerEvents);
    const batchResult = collectExchangeProcessingBatchResult(groups, interpretKucoinGroup);
    logExchangeProcessingDiagnostics(this.logger, batchResult.diagnostics);

    const failure = buildExchangeProcessingFailureError('KuCoin', groups.length, batchResult.diagnostics);
    if (failure) {
      return err(failure);
    }

    return ok(batchResult.transactions);
  }
}
