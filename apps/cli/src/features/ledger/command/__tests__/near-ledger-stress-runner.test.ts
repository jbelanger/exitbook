import type { IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { Account } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { assertErr } from '@exitbook/foundation/test-utils';
import type { AdapterRegistry } from '@exitbook/ingestion/adapters';
import { describe, expect, it } from 'vitest';

import { NearLedgerStressRunner, parseNearLedgerStressExpectedDiffFile } from '../near-ledger-stress-runner.js';
import { NEAR_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA } from '../near-ledger-stress-types.js';

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? 1,
    profileId: overrides.profileId ?? 1,
    name: overrides.name ?? 'alice.near',
    accountType: overrides.accountType ?? 'blockchain',
    platformKey: overrides.platformKey ?? 'near',
    identifier: overrides.identifier ?? 'alice.near',
    accountFingerprint: overrides.accountFingerprint ?? 'account-fingerprint-1',
    createdAt: overrides.createdAt ?? new Date('2026-04-27T00:00:00.000Z'),
  };
}

function createRunner(): NearLedgerStressRunner {
  return new NearLedgerStressRunner({
    adapterRegistry: {} as AdapterRegistry,
    db: {} as DataSession,
    providerRuntime: {} as IBlockchainProviderRuntime,
  });
}

describe('NearLedgerStressRunner', () => {
  it('rejects non-NEAR accounts before opening stress dependencies', async () => {
    const runner = createRunner();
    const error = assertErr(await runner.run([createAccount({ platformKey: 'ethereum', identifier: '0x1' })]));

    expect(error.message).toContain('not NEAR');
  });

  it('rejects malformed expected-diffs files instead of treating invalid decimals as zero', () => {
    const error = assertErr(
      parseNearLedgerStressExpectedDiffFile({
        schema: NEAR_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA,
        diffs: [
          {
            accountFingerprint: 'account-fingerprint-1',
            assetId: 'blockchain:near:native',
            balanceCategory: 'liquid',
            delta: 'not-a-decimal',
            reason: 'Invalid fixture.',
          },
        ],
      })
    );

    expect(error.message).toContain('invalid delta not-a-decimal');
  });
});
