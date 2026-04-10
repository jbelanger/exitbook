// Best-effort override writers for review flows.
// The primary DB mutation already succeeded, so failures here are only logged.

import type { OverrideStore } from '@exitbook/data/overrides';
import { getLogger } from '@exitbook/logger';

import { appendLinkOverrideEvent, appendUnlinkOverrideEvent } from './links-override-append.js';
import type { LinkOverrideIdentity, TransactionFingerprintReader } from './links-override-append.js';

const logger = getLogger('LinkOverrideUtils');

export async function writeLinkOverrideEvent(
  txRepo: TransactionFingerprintReader,
  overrideStore: OverrideStore,
  profileKey: string,
  link: LinkOverrideIdentity
): Promise<void> {
  const appendResult = await appendLinkOverrideEvent(txRepo, overrideStore, profileKey, link);
  if (appendResult.isErr()) {
    logger.warn({ error: appendResult.error }, 'Failed to write link override event');
  }
}

export async function writeUnlinkOverrideEvent(
  txRepo: TransactionFingerprintReader,
  overrideStore: OverrideStore,
  profileKey: string,
  link: LinkOverrideIdentity
): Promise<void> {
  const appendResult = await appendUnlinkOverrideEvent(txRepo, overrideStore, profileKey, link);
  if (appendResult.isErr()) {
    logger.warn({ error: appendResult.error }, 'Failed to write unlink override event');
  }
}
