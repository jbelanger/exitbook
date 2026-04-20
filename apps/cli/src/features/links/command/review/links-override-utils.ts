import type { OverrideEvent } from '@exitbook/core';
import type { OverrideStore } from '@exitbook/data/overrides';
import { type Result } from '@exitbook/foundation';

import { appendLinkOverrideEvents, appendUnlinkOverrideEvents } from './links-override-append.js';
import type { LinkOverrideIdentity, TransactionFingerprintReader } from './links-override-append.js';

export async function appendTransferProposalOverrideEvents(
  txRepo: TransactionFingerprintReader,
  overrideStore: OverrideStore,
  profileKey: string,
  links: LinkOverrideIdentity[],
  targetStatus: 'confirmed' | 'rejected'
): Promise<Result<OverrideEvent[], Error>> {
  if (targetStatus === 'confirmed') {
    return appendLinkOverrideEvents(txRepo, overrideStore, profileKey, links);
  }

  return appendUnlinkOverrideEvents(txRepo, overrideStore, profileKey, links);
}
