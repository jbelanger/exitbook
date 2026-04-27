import {
  buildLedgerBalancesFromPostings,
  diffLedgerBalancesAgainstReferences,
  type LedgerBalancePostingInput,
  type LedgerBalanceReferenceInput,
} from '@exitbook/accounting/ledger-balance';
import type { IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import { buildTransactionBalanceImpact, type Account, type RawTransaction, type Transaction } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, parseDecimal, tryParseDecimal, type Result } from '@exitbook/foundation';
import type { AdapterRegistry } from '@exitbook/ingestion/adapters';
import {
  computeAccountingJournalFingerprint,
  computeAccountingPostingFingerprint,
  type AccountingLedgerDraft,
  type BlockchainLedgerProcessorContext,
} from '@exitbook/ingestion/process';
import { z } from 'zod';

import type {
  LedgerStressAccountSummary,
  LedgerStressDiff,
  LedgerStressExpectedDiff,
  LedgerStressResult,
  LedgerStressScopeResult,
  LedgerStressStaleExpectedDiff,
} from './ledger-stress-types.js';

export const LEDGER_STRESS_DEFAULT_TOLERANCE = '0.00000001';

const ExpectedDiffSchema = z.object({
  accountFingerprint: z.string().min(1),
  assetId: z.string().min(1),
  balanceCategory: z.string().min(1),
  delta: z.string().min(1),
  reason: z.string().min(1),
});

export interface LedgerStressRunOptions {
  chains: readonly string[];
  expectedDiffs?: readonly LedgerStressExpectedDiff[] | undefined;
  tolerance?: string | undefined;
}

export interface LedgerStressRunnerDeps {
  adapterRegistry: AdapterRegistry;
  db: DataSession;
  providerRuntime: IBlockchainProviderRuntime;
}

export interface LedgerStressRunnerConfig {
  expectedDiffDuplicateLabel: string;
  processorLabel: string;
}

interface ExpectedDiffIndexEntry {
  diff: LedgerStressExpectedDiff;
  observed: boolean;
}

export class LedgerStressRunnerCore {
  constructor(
    private readonly deps: LedgerStressRunnerDeps,
    private readonly config: LedgerStressRunnerConfig
  ) {}

  async run(accounts: readonly Account[], options: LedgerStressRunOptions): Promise<Result<LedgerStressResult, Error>> {
    const expectedDiffsResult = buildExpectedDiffIndex(
      options.expectedDiffs ?? [],
      this.config.expectedDiffDuplicateLabel
    );
    if (expectedDiffsResult.isErr()) {
      return err(expectedDiffsResult.error);
    }

    const selectedChains = [...new Set(options.chains)].sort();
    const expectedDiffs = expectedDiffsResult.value;
    const scopes: LedgerStressScopeResult[] = [];
    for (const account of accounts) {
      const scopeResult = await this.runScope(account, selectedChains, expectedDiffs, options);
      if (scopeResult.isErr()) {
        return err(scopeResult.error);
      }

      scopes.push(scopeResult.value);
    }

    const staleExpectedDiffs = collectStaleExpectedDiffs(expectedDiffs);
    return ok({
      chains: selectedChains,
      scopes,
      staleExpectedDiffs,
      status: summarizeStatus(scopes, staleExpectedDiffs),
      summary: summarizeScopes(scopes, staleExpectedDiffs),
    });
  }

  private async runScope(
    account: Account,
    chains: readonly string[],
    expectedDiffs: Map<string, ExpectedDiffIndexEntry>,
    options: LedgerStressRunOptions
  ): Promise<Result<LedgerStressScopeResult, Error>> {
    if (!chains.includes(account.platformKey)) {
      return ok(buildUnavailableScope(account, `Account chain ${account.platformKey} is outside selected chains.`));
    }

    const rawRowsResult = await this.deps.db.rawTransactions.findAll({ accountId: account.id });
    if (rawRowsResult.isErr()) {
      return err(new Error(`Failed to load raw rows for account #${account.id}: ${rawRowsResult.error.message}`));
    }

    const rawRows = sortRawRows(rawRowsResult.value);
    if (rawRows.length === 0) {
      return ok(buildUnavailableScope(account, 'No persisted raw rows exist for this account.'));
    }

    const legacyTransactionsResult = await this.deps.db.transactions.findAll({ accountId: account.id });
    if (legacyTransactionsResult.isErr()) {
      return err(
        new Error(
          `Failed to load legacy processed transactions for account #${account.id}: ${legacyTransactionsResult.error.message}`
        )
      );
    }

    const legacyTransactions = legacyTransactionsResult.value;
    if (legacyTransactions.length === 0) {
      return ok(
        buildUnavailableScope(account, 'No persisted legacy processed transactions exist for this account.', {
          rawRows: rawRows.length,
        })
      );
    }

    const ledgerDraftsResult = await this.runLedgerProcessor(account, rawRows);
    if (ledgerDraftsResult.isErr()) {
      return err(ledgerDraftsResult.error);
    }

    const ledgerRowsResult = buildLedgerPostingInputs(ledgerDraftsResult.value);
    if (ledgerRowsResult.isErr()) {
      return err(ledgerRowsResult.error);
    }

    const ledgerBalancesResult = buildLedgerBalancesFromPostings(ledgerRowsResult.value);
    if (ledgerBalancesResult.isErr()) {
      return err(ledgerBalancesResult.error);
    }

    const referenceRows = buildLegacyReferenceRows(legacyTransactions);
    const diffResult = diffLedgerBalancesAgainstReferences({
      ledgerBalances: ledgerBalancesResult.value.balances,
      referenceBalances: referenceRows,
      tolerance: options.tolerance ?? LEDGER_STRESS_DEFAULT_TOLERANCE,
    });
    if (diffResult.isErr()) {
      return err(diffResult.error);
    }

    const accountSummary = toAccountSummary(account);
    const diffs = diffResult.value.map((diff): LedgerStressDiff => {
      const diffKey = buildObservedDiffKey(accountSummary.accountFingerprint, diff.assetId, diff.balanceCategory);
      const expectedDiff = expectedDiffs.get(diffKey);
      const delta = diff.delta.toFixed();
      const expectedMatches = expectedDiff !== undefined && parseDecimal(expectedDiff.diff.delta).eq(delta);
      if (expectedMatches) {
        expectedDiff.observed = true;
      }

      return {
        account: accountSummary,
        assetId: diff.assetId,
        assetSymbol: diff.assetSymbol,
        balanceCategory: diff.balanceCategory,
        delta,
        ...(expectedMatches ? { expectedReason: expectedDiff.diff.reason } : {}),
        journalFingerprints: diff.journalFingerprints,
        ledgerQuantity: diff.ledgerQuantity.toFixed(),
        postingFingerprints: diff.postingFingerprints,
        referenceQuantity: diff.referenceQuantity.toFixed(),
        sourceActivityFingerprints: diff.sourceActivityFingerprints,
        status: expectedMatches ? 'accepted_diff' : 'unexpected_diff',
      };
    });

    const unexpectedDiffs = diffs.filter((diff) => diff.status === 'unexpected_diff').length;
    const acceptedDiffs = diffs.filter((diff) => diff.status === 'accepted_diff').length;

    return ok({
      account: accountSummary,
      diagnostics: {
        rawRows: rawRows.length,
        legacyTransactions: legacyTransactions.length,
        ledgerSourceActivities: ledgerDraftsResult.value.length,
        ledgerJournals: ledgerDraftsResult.value.reduce((total, draft) => total + draft.journals.length, 0),
        ledgerPostings: ledgerRowsResult.value.length,
      },
      diffs,
      status: unexpectedDiffs > 0 ? 'failed' : acceptedDiffs > 0 ? 'accepted_diffs' : 'passed',
    });
  }

  private async runLedgerProcessor(
    account: Account,
    rawRows: readonly RawTransaction[]
  ): Promise<Result<AccountingLedgerDraft[], Error>> {
    const adapterResult = this.deps.adapterRegistry.getBlockchain(account.platformKey);
    if (adapterResult.isErr()) {
      return err(adapterResult.error);
    }

    const createLedgerProcessor = adapterResult.value.createLedgerProcessor;
    if (!createLedgerProcessor) {
      return err(new Error(`Blockchain ${account.platformKey} does not expose a ledger-v2 processor.`));
    }

    const processorInputsResult = unpackRawRowsForProcessor(rawRows);
    if (processorInputsResult.isErr()) {
      return err(processorInputsResult.error);
    }

    const userAddressesResult = await this.deps.db.accounts.findAll({
      accountType: 'blockchain',
      platformKey: account.platformKey,
      profileId: account.profileId,
    });
    if (userAddressesResult.isErr()) {
      return err(
        new Error(
          `Failed to load ${account.platformKey} addresses for account #${account.id}: ${userAddressesResult.error.message}`
        )
      );
    }

    const context: BlockchainLedgerProcessorContext = {
      account: {
        fingerprint: account.accountFingerprint,
        id: account.id,
      },
      primaryAddress: account.identifier,
      userAddresses: [...new Set(userAddressesResult.value.map((item) => item.identifier))],
      walletAddresses: [account.identifier],
    };

    const ledgerProcessor = createLedgerProcessor({ providerRuntime: this.deps.providerRuntime });
    const ledgerDraftsResult = await ledgerProcessor.process(processorInputsResult.value, context);
    if (ledgerDraftsResult.isErr()) {
      return err(
        new Error(
          `${this.config.processorLabel} stress processing failed for account #${account.id}: ${ledgerDraftsResult.error.message}`
        )
      );
    }

    return ok(ledgerDraftsResult.value);
  }
}

export function parseLedgerStressExpectedDiffFile(
  value: unknown,
  params: { expectedDiffsSchema: string; label: string }
): Result<LedgerStressExpectedDiff[], Error> {
  const parseResult = z
    .object({
      schema: z.literal(params.expectedDiffsSchema),
      diffs: z.array(ExpectedDiffSchema),
    })
    .safeParse(value);
  if (!parseResult.success) {
    return err(new Error(`Invalid ${params.label} expected-diffs file: ${parseResult.error.message}`));
  }

  const indexResult = buildExpectedDiffIndex(parseResult.data.diffs, params.label);
  if (indexResult.isErr()) {
    return err(indexResult.error);
  }

  return ok(parseResult.data.diffs);
}

function buildExpectedDiffIndex(
  expectedDiffs: readonly LedgerStressExpectedDiff[],
  duplicateLabel: string
): Result<Map<string, ExpectedDiffIndexEntry>, Error> {
  const expectedDiffsByKey = new Map<string, ExpectedDiffIndexEntry>();

  for (const diff of expectedDiffs) {
    if (diff.reason.trim().length === 0) {
      return err(new Error(`Expected diff ${diff.assetId} is missing a reason.`));
    }

    if (!tryParseDecimal(diff.delta)) {
      return err(new Error(`Expected diff ${diff.assetId} has invalid delta ${diff.delta}.`));
    }

    const key = buildObservedDiffKey(diff.accountFingerprint, diff.assetId, diff.balanceCategory);
    if (expectedDiffsByKey.has(key)) {
      return err(new Error(`Duplicate expected ${duplicateLabel} diff: ${key}`));
    }

    expectedDiffsByKey.set(key, { diff, observed: false });
  }

  return ok(expectedDiffsByKey);
}

function buildObservedDiffKey(accountFingerprint: string, assetId: string, balanceCategory: string): string {
  return `${accountFingerprint}\u0000${assetId}\u0000${balanceCategory}`;
}

function collectStaleExpectedDiffs(
  expectedDiffsByKey: ReadonlyMap<string, ExpectedDiffIndexEntry>
): LedgerStressStaleExpectedDiff[] {
  return [...expectedDiffsByKey.entries()]
    .filter(([, entry]) => !entry.observed)
    .map(([diffKey, entry]) => ({
      ...entry.diff,
      diffKey,
    }));
}

function buildUnavailableScope(
  account: Account,
  reason: string,
  diagnostics: Partial<LedgerStressScopeResult['diagnostics']> = {}
): LedgerStressScopeResult {
  return {
    account: toAccountSummary(account),
    diagnostics: {
      reason,
      rawRows: diagnostics.rawRows ?? 0,
      legacyTransactions: diagnostics.legacyTransactions ?? 0,
      ledgerSourceActivities: diagnostics.ledgerSourceActivities ?? 0,
      ledgerJournals: diagnostics.ledgerJournals ?? 0,
      ledgerPostings: diagnostics.ledgerPostings ?? 0,
    },
    diffs: [],
    status: 'unavailable',
  };
}

function unpackRawRowsForProcessor(rawRows: readonly RawTransaction[]): Result<unknown[], Error> {
  const inputs: unknown[] = [];
  for (const rawRow of rawRows) {
    const normalizedData = rawRow.normalizedData;
    if (!hasUsableNormalizedData(normalizedData)) {
      return err(
        new Error(`Raw transaction ${rawRow.id} is missing normalized_data for ledger stress. Reimport is required.`)
      );
    }

    inputs.push(normalizedData);
  }

  return ok(inputs);
}

function hasUsableNormalizedData(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  return !(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

function sortRawRows(rawRows: readonly RawTransaction[]): RawTransaction[] {
  return [...rawRows].sort(
    (left, right) =>
      (left.blockchainTransactionHash ?? '').localeCompare(right.blockchainTransactionHash ?? '') ||
      left.timestamp - right.timestamp ||
      left.id - right.id
  );
}

function buildLedgerPostingInputs(
  ledgerDrafts: readonly AccountingLedgerDraft[]
): Result<LedgerBalancePostingInput[], Error> {
  const postings: LedgerBalancePostingInput[] = [];

  for (const draft of ledgerDrafts) {
    for (const journal of draft.journals) {
      const journalFingerprintResult = computeAccountingJournalFingerprint(journal);
      if (journalFingerprintResult.isErr()) {
        return err(journalFingerprintResult.error);
      }
      const journalFingerprint = journalFingerprintResult.value;

      for (const posting of journal.postings) {
        const postingFingerprintResult = computeAccountingPostingFingerprint(journalFingerprint, posting);
        if (postingFingerprintResult.isErr()) {
          return err(postingFingerprintResult.error);
        }

        postings.push({
          ownerAccountId: draft.sourceActivity.ownerAccountId,
          assetId: posting.assetId,
          assetSymbol: posting.assetSymbol,
          balanceCategory: posting.balanceCategory,
          quantity: posting.quantity,
          journalFingerprint,
          postingFingerprint: postingFingerprintResult.value,
          sourceActivityFingerprint: draft.sourceActivity.sourceActivityFingerprint,
        });
      }
    }
  }

  return ok(postings);
}

function buildLegacyReferenceRows(transactions: readonly Transaction[]): LedgerBalanceReferenceInput[] {
  const rows: LedgerBalanceReferenceInput[] = [];

  for (const transaction of transactions) {
    const impact = buildTransactionBalanceImpact(transaction);
    for (const asset of impact.assets) {
      if (asset.netBalanceDelta.isZero()) {
        continue;
      }

      rows.push({
        ownerAccountId: transaction.accountId,
        assetId: asset.assetId,
        assetSymbol: asset.assetSymbol,
        balanceCategory: 'liquid',
        quantity: asset.netBalanceDelta,
      });
    }
  }

  return rows;
}

function summarizeStatus(
  scopes: readonly LedgerStressScopeResult[],
  staleExpectedDiffs: readonly LedgerStressStaleExpectedDiff[]
): LedgerStressResult['status'] {
  if (
    staleExpectedDiffs.length > 0 ||
    scopes.some((scope) => scope.status === 'failed' || scope.status === 'unavailable')
  ) {
    return 'failed';
  }

  return 'passed';
}

function summarizeScopes(
  scopes: readonly LedgerStressScopeResult[],
  staleExpectedDiffs: readonly LedgerStressStaleExpectedDiff[]
): LedgerStressResult['summary'] {
  return {
    acceptedDiffs: scopes.reduce(
      (total, scope) => total + scope.diffs.filter((diff) => diff.status === 'accepted_diff').length,
      0
    ),
    checkedAccounts: scopes.length,
    failedAccounts: scopes.filter((scope) => scope.status === 'failed').length,
    legacyTransactions: scopes.reduce((total, scope) => total + scope.diagnostics.legacyTransactions, 0),
    ledgerJournals: scopes.reduce((total, scope) => total + scope.diagnostics.ledgerJournals, 0),
    ledgerPostings: scopes.reduce((total, scope) => total + scope.diagnostics.ledgerPostings, 0),
    ledgerSourceActivities: scopes.reduce((total, scope) => total + scope.diagnostics.ledgerSourceActivities, 0),
    passedAccounts: scopes.filter((scope) => scope.status === 'passed' || scope.status === 'accepted_diffs').length,
    rawRows: scopes.reduce((total, scope) => total + scope.diagnostics.rawRows, 0),
    staleExpectedDiffs: staleExpectedDiffs.length,
    unavailableAccounts: scopes.filter((scope) => scope.status === 'unavailable').length,
    unexpectedDiffs: scopes.reduce(
      (total, scope) => total + scope.diffs.filter((diff) => diff.status === 'unexpected_diff').length,
      0
    ),
  };
}

function toAccountSummary(account: Account): LedgerStressAccountSummary {
  return {
    id: account.id,
    accountFingerprint: account.accountFingerprint,
    identifier: account.identifier,
    ...(account.name !== undefined ? { name: account.name } : {}),
    platformKey: account.platformKey,
    type: account.accountType,
  };
}
