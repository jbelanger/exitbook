import type { RawTransactionMetadata, ImportSessionMetadata } from '@exitbook/data';
import { beforeAll, describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import type { SolanaTransaction } from '../../types.ts';
import { lamportsToSol } from '../../utils.ts';
import { HeliusApiClient } from '../helius.api-client.ts';
import { HeliusTransactionMapper } from '../helius.mapper.ts';
import type { HeliusTransaction } from '../helius.types.ts';

describe('HeliusTransactionMapper E2E', () => {
  const mapper = new HeliusTransactionMapper();
  const config = ProviderRegistry.createDefaultConfig('solana', 'helius');
  const apiClient = new HeliusApiClient(config);
  const addressCandidates = [
    'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm', // original fixture address
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint (high activity)
    'So11111111111111111111111111111111111111112', // Wrapped SOL mint
    'Vote111111111111111111111111111111111111111', // Vote program (steady traffic)
  ];

  let testAddress = addressCandidates[0];

  let cachedTransactions: HeliusTransaction[] = [];
  let mappedTransactions: { normalized: SolanaTransaction; raw: HeliusTransaction }[] = [];
  const mappingErrors: string[] = [];

  const createMetadata = (): RawTransactionMetadata => ({
    providerId: 'helius',
  });

  const createSessionContext = (): ImportSessionMetadata => ({
    address: testAddress,
  });

  beforeAll(async () => {
    try {
      for (const candidate of addressCandidates) {
        try {
          const transactions = await apiClient.execute<HeliusTransaction[]>({
            address: candidate,
            type: 'getRawAddressTransactions',
          });

          if (transactions.length > 0) {
            testAddress = candidate;
            cachedTransactions = transactions;
            console.log(`✓ Fetched ${cachedTransactions.length} Helius transactions for ${candidate}`);
            break;
          }

          console.warn(`No transactions returned for candidate ${candidate}`);
        } catch (candidateError) {
          console.warn(`Candidate ${candidate} failed with error:`, candidateError);
        }
      }

      if (cachedTransactions.length === 0) {
        throw new Error('No transactions available for any test address candidate');
      }

      mappedTransactions = cachedTransactions
        .map((raw) => {
          const result = mapper.map(raw, createMetadata(), createSessionContext());
          if (result.isErr()) {
            const message =
              typeof result.error === 'object' && result.error ? JSON.stringify(result.error) : String(result.error);
            mappingErrors.push(message);
            console.error('Failed to map transaction:', message);
            return;
          }
          return { normalized: result.value, raw };
        })
        .filter((entry): entry is { normalized: SolanaTransaction; raw: HeliusTransaction } => Boolean(entry));
      console.log(`✓ Successfully mapped ${mappedTransactions.length} transactions`);
    } catch (error) {
      console.error('❌ Failed to fetch Helius transactions:', error);
      throw error;
    }
  }, 120000);

  const findMappedTransaction = (
    predicate: (entry: { normalized: SolanaTransaction; raw: HeliusTransaction }) => boolean
  ) => mappedTransactions.find(predicate);

  it('should map real transaction data from API', () => {
    expect(cachedTransactions.length).toBeGreaterThan(0);
    expect(mappingErrors.length).toBeLessThan(cachedTransactions.length);
    expect(mappedTransactions.length, `Mapping errors: ${mappingErrors.join('; ')}`).toBeGreaterThan(0);

    const { raw, normalized } = mappedTransactions[0]!;
    const expectedSignature = raw.transaction.signatures?.[0] ?? raw.signature;

    expect(normalized.id).toBe(expectedSignature);
    expect(normalized.providerId).toBe('helius');
    expect(['success', 'failed']).toContain(normalized.status);
    expect(typeof normalized.amount).toBe('string');
    expect(normalized.amount.length).toBeGreaterThan(0);
    expect(typeof normalized.currency).toBe('string');
    expect(normalized.currency.length).toBeGreaterThan(0);
    expect(normalized.blockHeight).toBe(raw.slot);
    expect(normalized.slot).toBe(raw.slot);
    expect(normalized.timestamp).toBe(raw.blockTime?.getTime() || 0);
  });

  it('should capture SOL balance changes including fee payer debits', () => {
    const mappedWithBalanceChange = findMappedTransaction(
      (entry) => entry.normalized.accountChanges?.some((change) => change.preBalance !== change.postBalance) ?? false
    );

    if (!mappedWithBalanceChange) {
      console.warn('No transactions with SOL balance changes were found, skipping test');
      return;
    }

    const { raw, normalized } = mappedWithBalanceChange;
    expect(Array.isArray(normalized.accountChanges)).toBe(true);
    const feePayer = raw.transaction.message.accountKeys?.[0];
    if (feePayer) {
      const feeChange = normalized.accountChanges!.find((change) => change.account === feePayer);
      expect(feeChange).toBeDefined();
      if (feeChange) {
        expect(feeChange.preBalance).not.toBe(feeChange.postBalance);
      }
    }
  });

  it('should expose SPL token balance changes when present', () => {
    const mappedWithTokenChanges = findMappedTransaction((entry) => (entry.normalized.tokenChanges?.length ?? 0) > 0);

    if (!mappedWithTokenChanges) {
      console.warn('No transactions with token balance changes were found, skipping test');
      return;
    }

    const { normalized } = mappedWithTokenChanges;
    expect(Array.isArray(normalized.tokenChanges)).toBe(true);
    expect(normalized.tokenChanges!.length).toBeGreaterThan(0);

    const tokenChange = normalized.tokenChanges![0]!;
    expect(typeof tokenChange.mint).toBe('string');
    expect(tokenChange.mint.length).toBeGreaterThan(0);
    expect(tokenChange.preAmount).not.toBe(tokenChange.postAmount);
    expect(typeof tokenChange.decimals).toBe('number');
    expect(normalized.currency).not.toBe('SOL');
  });

  it('should convert network fees from lamports to SOL', () => {
    const entry = mappedTransactions[0];
    if (!entry) {
      console.warn('No mapped transactions available to verify fee conversion, skipping test');
      return;
    }

    const { raw, normalized } = entry;
    expect(normalized.feeCurrency).toBe('SOL');
    expect(normalized.feeAmount).toBe(lamportsToSol(raw.meta.fee).toString());
  });
});
