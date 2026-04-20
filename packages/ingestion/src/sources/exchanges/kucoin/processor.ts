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

import { buildKuCoinCorrelationGroups } from './build-correlation-groups.js';
import { interpretKuCoinGroup } from './interpret-group.js';
import { normalizeKuCoinProviderEvent } from './normalize-provider-event.js';
import type { KuCoinCsvRow } from './types.js';

/**
 * KuCoin CSV processor built on provider-event normalization and explicit
 * provider-owned interpretation rules.
 */
export class KuCoinCsvProcessor extends BaseTransactionProcessor<RawExchangeProcessorInput<KuCoinCsvRow>> {
  constructor() {
    super('kucoin');
  }

  protected get inputSchema(): z.ZodType<RawExchangeProcessorInput<KuCoinCsvRow>> {
    return RawExchangeProcessorInputSchema as z.ZodType<RawExchangeProcessorInput<KuCoinCsvRow>>;
  }

  protected async transformNormalizedData(
    rawInputs: RawExchangeProcessorInput<KuCoinCsvRow>[]
  ): Promise<Result<TransactionDraft[], Error>> {
    const providerEvents = [];

    for (const input of rawInputs) {
      const normalizedResult = normalizeKuCoinProviderEvent(input.raw, input.eventId);
      if (normalizedResult.isErr()) {
        return err(normalizedResult.error);
      }
      providerEvents.push(normalizedResult.value);
    }

    const groups = buildKuCoinCorrelationGroups(providerEvents);
    const batchResult = collectExchangeProcessingBatchResult(groups, interpretKuCoinGroup);
    logExchangeProcessingDiagnostics(this.logger, batchResult.diagnostics);

    const failure = buildExchangeProcessingFailureError('KuCoin', groups.length, batchResult.diagnostics);
    if (failure) {
      return err(failure);
    }

    return ok(batchResult.transactions);
  }
}
