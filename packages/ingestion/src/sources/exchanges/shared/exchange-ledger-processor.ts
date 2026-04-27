import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger, type Logger } from '@exitbook/logger';
import { z } from 'zod';

import type {
  AccountingLedgerDraft,
  AccountingLedgerProcessorContext,
  IAccountingLedgerProcessor,
} from '../../../shared/types/processors.js';

import type { ExchangeCorrelationGroup } from './exchange-correlation-group.js';
import type { ConfirmedExchangeTransactionDraft, ExchangeGroupInterpretation } from './exchange-interpretation.js';
import { assembleExchangeLedgerDraft } from './exchange-ledger-assembler.js';
import type { ExchangeProcessingDiagnostic } from './exchange-processing-diagnostic.js';
import type { ExchangeProviderEvent, ExchangeProviderMetadata } from './exchange-provider-event.js';
import { buildExchangeProcessingFailureError, logExchangeProcessingDiagnostics } from './processing-result.js';
import type { RawExchangeProcessorInput } from './raw-exchange-input.js';

export interface ExchangeLedgerProcessorOptions<TRaw, TProviderMetadata extends ExchangeProviderMetadata> {
  buildGroups: (events: ExchangeProviderEvent<TProviderMetadata>[]) => ExchangeCorrelationGroup<TProviderMetadata>[];
  displayName: string;
  inputSchema: z.ZodType<RawExchangeProcessorInput<TRaw>>;
  interpretGroup: (group: ExchangeCorrelationGroup<TProviderMetadata>) => ExchangeGroupInterpretation;
  loggerName: string;
  normalizeEvent: (input: RawExchangeProcessorInput<TRaw>) => Result<ExchangeProviderEvent<TProviderMetadata>, Error>;
}

export class ExchangeLedgerProcessor<
  TRaw,
  TProviderMetadata extends ExchangeProviderMetadata,
> implements IAccountingLedgerProcessor {
  private readonly logger: Logger;

  constructor(private readonly options: ExchangeLedgerProcessorOptions<TRaw, TProviderMetadata>) {
    this.logger = getLogger(options.loggerName);
  }

  async process(
    normalizedData: unknown[],
    context: AccountingLedgerProcessorContext
  ): Promise<Result<AccountingLedgerDraft[], Error>> {
    const inputsResult = this.parseInputs(normalizedData);
    if (inputsResult.isErr()) {
      return err(inputsResult.error);
    }

    const providerEventsResult = this.normalizeEvents(inputsResult.value);
    if (providerEventsResult.isErr()) {
      return err(providerEventsResult.error);
    }

    const groups = this.options.buildGroups(providerEventsResult.value);
    const diagnostics: ExchangeProcessingDiagnostic[] = [];
    const confirmedGroups: {
      draft: ConfirmedExchangeTransactionDraft;
      group: ExchangeCorrelationGroup<TProviderMetadata>;
    }[] = [];

    for (const group of groups) {
      const interpretation = this.options.interpretGroup(group);
      if (interpretation.kind !== 'confirmed') {
        diagnostics.push(interpretation.diagnostic);
        continue;
      }

      confirmedGroups.push({ group, draft: interpretation.draft });
    }

    logExchangeProcessingDiagnostics(this.logger, diagnostics);

    const failure = buildExchangeProcessingFailureError(this.options.displayName, groups.length, diagnostics);
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

  private parseInputs(normalizedData: readonly unknown[]): Result<RawExchangeProcessorInput<TRaw>[], Error> {
    const inputs: RawExchangeProcessorInput<TRaw>[] = [];

    for (let index = 0; index < normalizedData.length; index++) {
      const parseResult = this.options.inputSchema.safeParse(normalizedData[index]);
      if (!parseResult.success) {
        const detail = z.prettifyError(parseResult.error);
        return err(
          new Error(`Input validation failed for ${this.options.displayName} item at index ${index}: ${detail}`)
        );
      }

      inputs.push(parseResult.data);
    }

    return ok(inputs);
  }

  private normalizeEvents(
    inputs: readonly RawExchangeProcessorInput<TRaw>[]
  ): Result<ExchangeProviderEvent<TProviderMetadata>[], Error> {
    const providerEvents: ExchangeProviderEvent<TProviderMetadata>[] = [];

    for (const input of inputs) {
      const normalizedResult = this.options.normalizeEvent(input);
      if (normalizedResult.isErr()) {
        return err(normalizedResult.error);
      }

      providerEvents.push(normalizedResult.value);
    }

    return ok(providerEvents);
  }
}
