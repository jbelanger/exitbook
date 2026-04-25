import type { CursorState, CursorType, PaginationCursor } from '@exitbook/foundation';

import type { IBlockchainProvider } from '../../contracts/index.js';

function isEmptyCompletionCursor(cursor: CursorState | undefined): boolean {
  if (!cursor) {
    return false;
  }

  const metadata = cursor.metadata;
  if (metadata?.['isEmptyCompletion'] === true) {
    return true;
  }

  return cursor.totalFetched === 0 && cursor.lastTransactionId.endsWith(':empty');
}

/**
 * Check if provider can resume from cursor.
 */
export function canProviderResume(provider: IBlockchainProvider, cursor: CursorState): boolean {
  if (isEmptyCompletionCursor(cursor)) {
    return true;
  }

  const supportedTypes = provider.capabilities.supportedCursorTypes;

  // If provider doesn't declare cursor support, assume it can't resume
  if (!supportedTypes || supportedTypes.length === 0) {
    return false;
  }

  // Check primary cursor
  if (supportedTypes.includes(cursor.primary.type)) {
    // If it's a pageToken, must match provider name
    if (cursor.primary.type === 'pageToken') {
      if (cursor.primary.providerName === provider.name) {
        return true;
      }
    } else {
      return true;
    }
  }

  // Check alternatives
  return (
    cursor.alternatives?.some(
      (alternative) =>
        supportedTypes.includes(alternative.type) &&
        (alternative.type !== 'pageToken' || alternative.providerName === provider.name)
    ) || false
  );
}

/**
 * Configuration for cursor resolution.
 */
export interface CursorResolutionConfig {
  providerName: string;
  supportedCursorTypes: CursorType[];
  isFailover: boolean;
  applyReplayWindow: (cursor: PaginationCursor) => PaginationCursor;
}

interface ResolvedCursor {
  pageToken?: string | undefined;
  fromBlock?: number | undefined;
  fromTimestamp?: number | undefined;
}

/**
 * Resolve cursor for resumption with cross-provider failover support.
 */
export function resolveCursorForResumption(
  resumeCursor: CursorState | undefined,
  config: CursorResolutionConfig,
  logger: { info: (msg: string) => void; warn: (msg: string) => void }
): ResolvedCursor {
  const resolved: ResolvedCursor = {};

  if (!resumeCursor) {
    return resolved;
  }

  if (isEmptyCompletionCursor(resumeCursor)) {
    logger.info(`Empty completion cursor detected for ${config.providerName}; restarting from beginning`);
    return resolved;
  }

  if (resumeCursor.primary.type === 'pageToken' && resumeCursor.primary.providerName === config.providerName) {
    resolved.pageToken = resumeCursor.primary.value;
    logger.info(`Resuming from ${config.providerName} pageToken`);
    return resolved;
  }

  const blockCursor =
    resumeCursor.primary.type === 'blockNumber'
      ? resumeCursor.primary
      : resumeCursor.alternatives?.find((cursor) => cursor.type === 'blockNumber');

  if (blockCursor && blockCursor.type === 'blockNumber' && config.supportedCursorTypes.includes('blockNumber')) {
    const adjusted = config.isFailover ? config.applyReplayWindow(blockCursor) : blockCursor;
    resolved.fromBlock = typeof adjusted.value === 'number' ? adjusted.value : Number(adjusted.value);
    logger.info(
      `Resuming from block ${adjusted.value}${config.isFailover ? ' (with replay window)' : ' (exact cursor)'}`
    );
    return resolved;
  }

  const timestampCursor =
    resumeCursor.primary.type === 'timestamp'
      ? resumeCursor.primary
      : resumeCursor.alternatives?.find((cursor) => cursor.type === 'timestamp');

  if (timestampCursor && timestampCursor.type === 'timestamp' && config.supportedCursorTypes.includes('timestamp')) {
    const adjusted = config.isFailover ? config.applyReplayWindow(timestampCursor) : timestampCursor;
    resolved.fromTimestamp = typeof adjusted.value === 'number' ? adjusted.value : Number(adjusted.value);
    logger.info(
      `Resuming from timestamp ${adjusted.value}${config.isFailover ? ' (with replay window)' : ' (exact cursor)'}`
    );
    return resolved;
  }

  logger.warn('No compatible cursor found, starting from beginning');
  return resolved;
}

/**
 * Resolve and wrap cursor for a specific provider.
 */
export function resolveCursorStateForProvider(
  currentCursor: CursorState | undefined,
  provider: IBlockchainProvider,
  isFailover: boolean,
  logger: { info: (msg: string) => void; warn: (msg: string) => void }
): CursorState | undefined {
  if (!currentCursor) return undefined;

  if (isEmptyCompletionCursor(currentCursor)) {
    logger.info(`Empty completion cursor detected for ${provider.name}; restarting from beginning`);
    return undefined;
  }

  const resolved = resolveCursorForResumption(
    currentCursor,
    {
      providerName: provider.name,
      supportedCursorTypes: provider.capabilities.supportedCursorTypes || [],
      isFailover,
      applyReplayWindow: (cursor) => provider.applyReplayWindow(cursor),
    },
    logger
  );

  if (resolved.pageToken) {
    return {
      ...currentCursor,
      primary: { type: 'pageToken' as const, value: resolved.pageToken, providerName: provider.name },
    };
  }

  if (resolved.fromBlock !== undefined) {
    return {
      ...currentCursor,
      primary: { type: 'blockNumber' as const, value: resolved.fromBlock },
    };
  }

  if (resolved.fromTimestamp !== undefined) {
    return {
      ...currentCursor,
      primary: { type: 'timestamp' as const, value: resolved.fromTimestamp },
    };
  }

  return currentCursor;
}
