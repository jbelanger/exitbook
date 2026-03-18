import type { Logger } from '@exitbook/logger';

import type { TransactionDraft } from '../../../shared/types/processors.js';

import type { ExchangeCorrelationGroup } from './exchange-correlation-group.js';
import type { ExchangeGroupInterpretation } from './exchange-interpretation.js';
import type { ExchangeProcessingDiagnostic } from './exchange-processing-diagnostic.js';
import { materializeProcessedTransaction } from './materialize-processed-transaction.js';

interface ExchangeProcessingBatchResult {
  transactions: TransactionDraft[];
  diagnostics: ExchangeProcessingDiagnostic[];
}

export function collectExchangeProcessingBatchResult(
  groups: ExchangeCorrelationGroup[],
  interpretGroup: (group: ExchangeCorrelationGroup) => ExchangeGroupInterpretation
): ExchangeProcessingBatchResult {
  const result: ExchangeProcessingBatchResult = {
    transactions: [],
    diagnostics: [],
  };

  for (const group of groups) {
    const interpretation = interpretGroup(group);

    if (interpretation.kind === 'confirmed') {
      result.transactions.push(materializeProcessedTransaction(interpretation.draft));
      continue;
    }

    result.diagnostics.push(interpretation.diagnostic);
  }

  return result;
}

export function logExchangeProcessingDiagnostics(logger: Logger, diagnostics: ExchangeProcessingDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const logContext = {
      code: diagnostic.code,
      correlationKey: diagnostic.correlationKey,
      evidence: diagnostic.evidence,
      providerEventIds: diagnostic.providerEventIds,
    };

    if (diagnostic.severity === 'error') {
      logger.error(logContext, diagnostic.message);
      continue;
    }

    if (diagnostic.severity === 'warning') {
      logger.warn(logContext, diagnostic.message);
      continue;
    }

    logger.info(logContext, diagnostic.message);
  }
}

export function buildExchangeProcessingFailureError(
  providerName: string,
  totalGroups: number,
  diagnostics: ExchangeProcessingDiagnostic[]
): Error | undefined {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (blockingDiagnostics.length === 0) {
    return undefined;
  }

  const errorSummary = blockingDiagnostics
    .map((diagnostic) => `[${diagnostic.correlationKey}] ${diagnostic.code}: ${diagnostic.message}`)
    .join('; ');

  return new Error(
    `${providerName} processing cannot proceed: ${blockingDiagnostics.length}/${totalGroups} group(s) were ambiguous or invalid. ${errorSummary}`
  );
}
