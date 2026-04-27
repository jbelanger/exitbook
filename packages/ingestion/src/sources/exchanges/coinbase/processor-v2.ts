import { RawCoinbaseLedgerEntrySchema, type RawCoinbaseLedgerEntry } from '@exitbook/exchange-providers/coinbase';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger, type Logger } from '@exitbook/logger';
import { z } from 'zod';

import type {
  AccountingLedgerDraft,
  AccountingLedgerProcessorContext,
  IAccountingLedgerProcessor,
} from '../../../shared/types/processors.js';
import {
  assembleExchangeLedgerDraft,
  buildExchangeProcessingFailureError,
  type ConfirmedExchangeTransactionDraft,
  type ExchangeCorrelationGroup,
  type ExchangeProcessingDiagnostic,
  logExchangeProcessingDiagnostics,
  RawExchangeProcessorInputSchema,
  type RawExchangeProcessorInput,
} from '../shared/index.js';

import { buildCoinbaseCorrelationGroups } from './build-correlation-groups.js';
import { interpretCoinbaseGroup } from './interpret-group.js';
import {
  normalizeCoinbaseProviderEvent,
  type CoinbaseProviderEvent,
  type CoinbaseProviderMetadata,
} from './normalize-provider-event.js';

const CoinbaseLedgerProcessorInputSchema = RawExchangeProcessorInputSchema.extend({
  raw: RawCoinbaseLedgerEntrySchema,
});

/**
 * Coinbase ledger-v2 processor. It reuses the provider-event interpretation
 * path, then materializes accounting-owned ledger artifacts.
 */
export class CoinbaseProcessorV2 implements IAccountingLedgerProcessor {
  private readonly logger: Logger;

  constructor() {
    this.logger = getLogger('CoinbaseProcessorV2');
  }

  async process(
    normalizedData: unknown[],
    context: AccountingLedgerProcessorContext
  ): Promise<Result<AccountingLedgerDraft[], Error>> {
    const inputsResult = parseCoinbaseLedgerProcessorInputs(normalizedData);
    if (inputsResult.isErr()) {
      return err(inputsResult.error);
    }

    const providerEventsResult = normalizeCoinbaseProviderEvents(inputsResult.value);
    if (providerEventsResult.isErr()) {
      return err(providerEventsResult.error);
    }

    const groups = buildCoinbaseCorrelationGroups(providerEventsResult.value);
    const diagnostics: ExchangeProcessingDiagnostic[] = [];
    const confirmedGroups: {
      draft: ConfirmedExchangeTransactionDraft;
      group: ExchangeCorrelationGroup<CoinbaseProviderMetadata>;
    }[] = [];

    for (const group of groups) {
      const interpretation = interpretCoinbaseGroup(group);
      if (interpretation.kind !== 'confirmed') {
        diagnostics.push(interpretation.diagnostic);
        continue;
      }

      confirmedGroups.push({ group, draft: interpretation.draft });
    }

    logExchangeProcessingDiagnostics(this.logger, diagnostics);

    const failure = buildExchangeProcessingFailureError('Coinbase ledger-v2', groups.length, diagnostics);
    if (failure) {
      return err(failure);
    }

    const drafts: AccountingLedgerDraft[] = [];
    for (const confirmed of confirmedGroups) {
      const draftResult = assembleExchangeLedgerDraft({
        draft: confirmed.draft,
        group: confirmed.group,
        ownerAccount: context.account,
      });
      if (draftResult.isErr()) {
        return err(draftResult.error);
      }

      drafts.push(draftResult.value);
    }

    return ok(drafts);
  }
}

function parseCoinbaseLedgerProcessorInputs(
  normalizedData: readonly unknown[]
): Result<RawExchangeProcessorInput<RawCoinbaseLedgerEntry>[], Error> {
  const inputs: RawExchangeProcessorInput<RawCoinbaseLedgerEntry>[] = [];

  for (let index = 0; index < normalizedData.length; index++) {
    const parseResult = CoinbaseLedgerProcessorInputSchema.safeParse(normalizedData[index]);
    if (!parseResult.success) {
      const detail = z.prettifyError(parseResult.error);
      return err(new Error(`Input validation failed for Coinbase ledger-v2 item at index ${index}: ${detail}`));
    }

    inputs.push(parseResult.data);
  }

  return ok(inputs);
}

function normalizeCoinbaseProviderEvents(
  inputs: readonly RawExchangeProcessorInput<RawCoinbaseLedgerEntry>[]
): Result<CoinbaseProviderEvent[], Error> {
  const providerEvents: CoinbaseProviderEvent[] = [];

  for (const input of inputs) {
    const normalizedResult = normalizeCoinbaseProviderEvent(input.raw, input.eventId);
    if (normalizedResult.isErr()) {
      return err(normalizedResult.error);
    }

    providerEvents.push(normalizedResult.value);
  }

  return ok(providerEvents);
}
