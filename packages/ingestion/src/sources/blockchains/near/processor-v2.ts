import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import {
  type NearBalanceChange,
  type NearStreamEvent,
  type NearTokenTransfer,
  NearStreamEventSchema,
} from '@exitbook/blockchain-providers/near';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { INearBatchSource } from '../../../ports/near-batch-source.js';
import {
  parseLedgerProcessorItems,
  validateLedgerProcessorDraftJournals,
} from '../shared/ledger-processor-v2-utils.js';

import { assembleNearLedgerDraft, type NearLedgerDraft, type NearProcessorV2Context } from './journal-assembler.js';
import {
  compareBalanceChanges,
  correlateTransactionData,
  deriveBalanceChangeDeltasFromAbsolutes,
  groupNearEventsByTransaction,
  validateTransactionGroup,
} from './near-transaction-correlation.js';

const logger = getLogger('near-processor-v2');

function buildNearEventComparisonMaterial(event: NearStreamEvent): string {
  return JSON.stringify(event);
}

function dedupeNearEventsByEventId(events: readonly NearStreamEvent[]): Result<NearStreamEvent[], Error> {
  const eventsByEventId = new Map<string, { event: NearStreamEvent; material: string }>();

  for (const event of events) {
    const material = buildNearEventComparisonMaterial(event);
    const existing = eventsByEventId.get(event.eventId);
    if (!existing) {
      eventsByEventId.set(event.eventId, { event, material });
      continue;
    }

    if (existing.material !== material) {
      return err(new Error(`NEAR v2 received conflicting normalized payloads for event ${event.eventId}`));
    }
  }

  return ok([...eventsByEventId.values()].map((entry) => entry.event));
}

function findBalanceChanges(events: readonly NearStreamEvent[]): NearBalanceChange[] {
  return events.filter((event): event is NearBalanceChange => event.streamType === 'balance-changes');
}

function findTokenTransfers(events: readonly NearStreamEvent[]): NearTokenTransfer[] {
  return events.filter((event): event is NearTokenTransfer => event.streamType === 'token-transfers');
}

function applyDerivedBalanceDeltas(
  events: readonly NearStreamEvent[],
  derivedDeltas: ReadonlyMap<string, string>
): NearStreamEvent[] {
  if (derivedDeltas.size === 0) {
    return [...events];
  }

  return events.map((event) => {
    if (event.streamType !== 'balance-changes' || event.deltaAmountYocto) {
      return event;
    }

    const derivedDelta = derivedDeltas.get(event.eventId);
    return derivedDelta === undefined ? event : { ...event, deltaAmountYocto: derivedDelta };
  });
}

export class NearProcessorV2 {
  constructor(
    private readonly providerRuntime: IBlockchainProviderRuntime,
    private readonly nearBatchSource?: INearBatchSource | undefined
  ) {}

  async process(normalizedData: unknown[], context: NearProcessorV2Context): Promise<Result<NearLedgerDraft[], Error>> {
    const parsedEvents = parseLedgerProcessorItems({
      inputLabel: 'near v2',
      normalizedData,
      schema: NearStreamEventSchema,
    });
    if (parsedEvents.isErr()) {
      return err(parsedEvents.error);
    }

    const uniqueEvents = dedupeNearEventsByEventId(parsedEvents.value);
    if (uniqueEvents.isErr()) {
      return err(uniqueEvents.error);
    }

    const withDerivedDeltas = await this.deriveMissingBalanceDeltas(uniqueEvents.value, context);
    if (withDerivedDeltas.isErr()) {
      return err(withDerivedDeltas.error);
    }

    const enrichedEvents = await this.enrichTokenMetadata(withDerivedDeltas.value);
    if (enrichedEvents.isErr()) {
      return err(enrichedEvents.error);
    }

    const transactionGroups = groupNearEventsByTransaction(enrichedEvents.value);
    if (transactionGroups.isErr()) {
      return err(transactionGroups.error);
    }

    const drafts: NearLedgerDraft[] = [];
    for (const [transactionHash, group] of transactionGroups.value) {
      const validationResult = validateTransactionGroup(transactionHash, group);
      if (validationResult.isErr()) {
        return err(new Error(`NEAR v2 validation failed for ${transactionHash}: ${validationResult.error.message}`));
      }

      const correlated = correlateTransactionData(group);
      if (correlated.isErr()) {
        return err(correlated.error);
      }

      const draft = assembleNearLedgerDraft(correlated.value, context);
      if (draft.isErr()) {
        return err(draft.error);
      }
      if (draft.value.journals.length === 0) {
        continue;
      }

      const journalValidation = validateLedgerProcessorDraftJournals({
        draft: draft.value,
        processorLabel: 'NEAR v2',
        transaction: { id: transactionHash },
      });
      if (journalValidation.isErr()) {
        return err(journalValidation.error);
      }

      drafts.push(draft.value);
    }

    return ok(drafts);
  }

  private async deriveMissingBalanceDeltas(
    events: readonly NearStreamEvent[],
    context: NearProcessorV2Context
  ): Promise<Result<NearStreamEvent[], Error>> {
    const balanceChanges = findBalanceChanges(events);
    if (!balanceChanges.some((change) => !change.deltaAmountYocto)) {
      return ok([...events]);
    }

    const previousBalancesResult = await this.loadPreviousBalances(balanceChanges, context.account.id);
    if (previousBalancesResult.isErr()) {
      return err(previousBalancesResult.error);
    }

    const derivedResult = deriveBalanceChangeDeltasFromAbsolutes(balanceChanges, previousBalancesResult.value);
    for (const warning of derivedResult.warnings) {
      logger.warn({ warning }, 'NEAR v2 balance delta derivation warning');
    }

    return ok(applyDerivedBalanceDeltas(events, derivedResult.derivedDeltas));
  }

  private async loadPreviousBalances(
    balanceChanges: readonly NearBalanceChange[],
    accountId: number
  ): Promise<Result<Map<string, string>, Error>> {
    if (!this.nearBatchSource) {
      logger.warn({ accountId }, 'NEAR v2 missing nearBatchSource; deriving balance deltas without prior balances');
      return ok(new Map());
    }

    const earliestByAccount = new Map<string, NearBalanceChange>();
    for (const change of balanceChanges) {
      const existing = earliestByAccount.get(change.affectedAccountId);
      if (!existing || compareBalanceChanges(change, existing) < 0) {
        earliestByAccount.set(change.affectedAccountId, change);
      }
    }

    if (earliestByAccount.size === 0) {
      return ok(new Map());
    }

    const maxTimestamp = Math.max(...Array.from(earliestByAccount.values(), (change) => change.timestamp));
    const processedResult = await this.nearBatchSource.findProcessedBalanceChanges(
      accountId,
      Array.from(earliestByAccount.keys()),
      maxTimestamp
    );
    if (processedResult.isErr()) {
      return err(new Error(`Failed to load previous NEAR v2 balances: ${processedResult.error.message}`));
    }

    const processedByAccount = new Map<string, NearBalanceChange[]>();
    for (const row of processedResult.value) {
      const parsed = NearStreamEventSchema.safeParse(row.normalizedData);
      if (!parsed.success || parsed.data.streamType !== 'balance-changes') {
        logger.warn(
          { accountId: row.accountId, eventId: row.eventId },
          'Skipping malformed processed NEAR balance change for v2 delta derivation'
        );
        continue;
      }

      const existing = processedByAccount.get(parsed.data.affectedAccountId) ?? [];
      processedByAccount.set(parsed.data.affectedAccountId, [...existing, parsed.data]);
    }

    const previousBalances = new Map<string, string>();
    for (const [affectedAccountId, earliest] of earliestByAccount.entries()) {
      const candidates = processedByAccount.get(affectedAccountId);
      if (!candidates || candidates.length === 0) {
        continue;
      }

      let latest: NearBalanceChange | undefined;
      for (const candidate of candidates) {
        if (compareBalanceChanges(candidate, earliest) >= 0) {
          continue;
        }
        if (!latest || compareBalanceChanges(candidate, latest) > 0) {
          latest = candidate;
        }
      }

      if (latest) {
        previousBalances.set(affectedAccountId, latest.absoluteNonstakedAmount);
      }
    }

    return ok(previousBalances);
  }

  private async enrichTokenMetadata(events: readonly NearStreamEvent[]): Promise<Result<NearStreamEvent[], Error>> {
    const tokenTransfers = findTokenTransfers(events);
    if (tokenTransfers.length === 0) {
      return ok([...events]);
    }

    const contractAddresses = [...new Set(tokenTransfers.map((transfer) => transfer.contractAddress))];
    const metadataResult = await this.providerRuntime.getTokenMetadata('near', contractAddresses);
    if (metadataResult.isErr()) {
      return err(new Error(`NEAR v2 token metadata enrichment failed: ${metadataResult.error.message}`));
    }

    return ok(
      events.map((event) => {
        if (event.streamType !== 'token-transfers') {
          return event;
        }

        const metadata =
          metadataResult.value.get(event.contractAddress) ??
          metadataResult.value.get(event.contractAddress.toLowerCase());
        if (!metadata) {
          return event;
        }

        return {
          ...event,
          ...(metadata.symbol ? { symbol: metadata.symbol } : {}),
          ...(metadata.decimals !== undefined ? { decimals: metadata.decimals } : {}),
        };
      })
    );
  }
}
