import type { ImportSession, ExternalTransactionData } from '@exitbook/core';

import type { LoadRawDataFilters } from '../types/repositories.js';

/**
 * Session data prepared for processing
 */
export interface SessionProcessingData {
  session: ImportSession;
  rawDataItems: ExternalTransactionData[];
}

/**
 * Group raw transaction data by session (import session) ID.
 * Creates a map where keys are session IDs and values are arrays of raw data items.
 *
 * @param rawData - Array of raw transaction data items
 * @returns Map of session ID to raw data items
 */
export function groupRawDataBySession(rawData: ExternalTransactionData[]): Map<number, ExternalTransactionData[]> {
  const rawDataBySessionId = new Map<number, ExternalTransactionData[]>();

  for (const rawDataItem of rawData) {
    if (rawDataItem.importSessionId) {
      const sessionRawData = rawDataBySessionId.get(rawDataItem.importSessionId) || [];
      sessionRawData.push(rawDataItem);
      rawDataBySessionId.set(rawDataItem.importSessionId, sessionRawData);
    }
  }

  return rawDataBySessionId;
}

/**
 * Filter sessions to only those with pending raw data that matches the filters.
 * Combines session metadata with their corresponding raw data items.
 *
 * @param sessions - All available sessions
 * @param rawDataBySession - Raw data grouped by session ID
 * @param filters - Optional filters to apply (e.g., specific import session ID)
 * @returns Array of sessions with their pending raw data items
 */
export function filterSessionsWithPendingData(
  sessions: ImportSession[],
  rawDataBySession: Map<number, ExternalTransactionData[]>,
  filters?: LoadRawDataFilters
): SessionProcessingData[] {
  return sessions
    .filter((session) => rawDataBySession.has(session.id))
    .map((session) => ({
      rawDataItems: rawDataBySession.get(session.id) || [],
      session,
    }))
    .filter((sessionData) =>
      sessionData.rawDataItems.some(
        (item) =>
          item.processingStatus === 'pending' &&
          (!filters?.importSessionId || item.importSessionId === filters.importSessionId)
      )
    );
}

/**
 * Build a processing queue from session data.
 * Validates that sessions have pending items and returns them ready for processing.
 *
 * @param sessions - Sessions with their raw data items
 * @returns Validated processing queue (same as input, but semantically represents a queue)
 */
export function buildSessionProcessingQueue(sessions: SessionProcessingData[]): SessionProcessingData[] {
  // Currently this is a pass-through function that validates the queue is ready
  // In the future, this could apply priority sorting, batching, or other queue management logic
  return sessions.filter((sessionData) => sessionData.rawDataItems.length > 0);
}

/**
 * Extract unique import session IDs from raw data items.
 * Filters out null values and returns unique IDs.
 *
 * @param rawData - Array of raw transaction data items
 * @returns Array of unique import session IDs
 */
export function extractUniqueDataSourceIds(rawData: ExternalTransactionData[]): number[] {
  return [
    ...new Set(
      rawData.map((item) => item.importSessionId).filter((id): id is number => id !== null && id !== undefined)
    ),
  ];
}
