import { KrakenLedgerEntrySchema, type KrakenLedgerEntry } from '@exitbook/exchange-providers/kraken';
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

import { buildKrakenCorrelationGroups } from './build-correlation-groups.js';
import { interpretKrakenGroup } from './interpret-group.js';
import {
  normalizeKrakenProviderEvent,
  type KrakenProviderEvent,
  type KrakenProviderMetadata,
} from './normalize-provider-event.js';

const KrakenLedgerProcessorInputSchema = RawExchangeProcessorInputSchema.extend({
  raw: KrakenLedgerEntrySchema,
});

/**
 * Kraken ledger-v2 processor. It reuses the legacy provider-event
 * interpretation path, then materializes accounting-owned ledger artifacts.
 */
export class KrakenProcessorV2 implements IAccountingLedgerProcessor {
  private readonly logger: Logger;

  constructor() {
    this.logger = getLogger('KrakenProcessorV2');
  }

  async process(
    normalizedData: unknown[],
    context: AccountingLedgerProcessorContext
  ): Promise<Result<AccountingLedgerDraft[], Error>> {
    const inputsResult = parseKrakenLedgerProcessorInputs(normalizedData);
    if (inputsResult.isErr()) {
      return err(inputsResult.error);
    }

    const providerEventsResult = normalizeKrakenProviderEvents(inputsResult.value);
    if (providerEventsResult.isErr()) {
      return err(providerEventsResult.error);
    }

    const groups = buildKrakenCorrelationGroups(providerEventsResult.value);
    const diagnostics: ExchangeProcessingDiagnostic[] = [];
    const confirmedGroups: {
      draft: ConfirmedExchangeTransactionDraft;
      group: ExchangeCorrelationGroup<KrakenProviderMetadata>;
    }[] = [];

    for (const group of groups) {
      const interpretation = interpretKrakenGroup(group);
      if (interpretation.kind !== 'confirmed') {
        diagnostics.push(interpretation.diagnostic);
        continue;
      }

      confirmedGroups.push({ group, draft: interpretation.draft });
    }

    logExchangeProcessingDiagnostics(this.logger, diagnostics);

    const failure = buildExchangeProcessingFailureError('Kraken ledger-v2', groups.length, diagnostics);
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

function parseKrakenLedgerProcessorInputs(
  normalizedData: readonly unknown[]
): Result<RawExchangeProcessorInput<KrakenLedgerEntry>[], Error> {
  const inputs: RawExchangeProcessorInput<KrakenLedgerEntry>[] = [];

  for (let index = 0; index < normalizedData.length; index++) {
    const parseResult = KrakenLedgerProcessorInputSchema.safeParse(normalizedData[index]);
    if (!parseResult.success) {
      const detail = z.prettifyError(parseResult.error);
      return err(new Error(`Input validation failed for Kraken ledger-v2 item at index ${index}: ${detail}`));
    }

    inputs.push(parseResult.data);
  }

  return ok(inputs);
}

function normalizeKrakenProviderEvents(
  inputs: readonly RawExchangeProcessorInput<KrakenLedgerEntry>[]
): Result<KrakenProviderEvent[], Error> {
  const providerEvents: KrakenProviderEvent[] = [];

  for (const input of inputs) {
    const normalizedResult = normalizeKrakenProviderEvent(input.raw, input.eventId);
    if (normalizedResult.isErr()) {
      return err(normalizedResult.error);
    }

    providerEvents.push(normalizedResult.value);
  }

  return ok(providerEvents);
}
