import type { CursorState, PaginationCursor } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderOperation } from '../index.js';
import { createDeduplicationWindow, deduplicateTransactions } from '../provider-manager-utils.js';
import type { StreamingBatchResult, TransactionWithRawData } from '../types/index.js';
import { buildCursorState } from '../utils/cursor-utils.js';

/**
 * Generic shape for a provider page.
 * - items: raw items to be mapped later by mapItem
 * - nextPageToken: opaque token when the provider offers one
 * - isComplete: explicit signal that no further pages exist (even if the
 *   provider does not return a nextPageToken). Prefer setting this for APIs
 *   that return a final empty page or signal completion via HTTP status.
 */
export interface StreamingPage<Raw> {
  items: Raw[];
  nextPageToken?: string | null | undefined;
  isComplete?: boolean | undefined;
  /**
   * Optional provider-specific metadata to attach to the cursor
   * (e.g., NEAR balance snapshots for delta computation across batches)
   */
  customMetadata?: Record<string, unknown> | undefined;
}

/**
 * Context passed into fetchPage on every iteration. Use this to express your
 * pagination dialect:
 * - pageToken: opaque token from previous page
 * - replayedCursor: primary cursor after replay window was applied (block,
 *   timestamp, slot, signature, etc.)
 * - resumeCursor: full persisted cursor if you need alternatives/metadata
 * - pageNumber: zero-based index (convenient for page-numbered APIs like
 *   Subscan or NearBlocks, and for logging/backoff decisions)
 */
export interface StreamingPageContext {
  pageToken?: string | undefined;
  replayedCursor?: PaginationCursor | undefined;
  resumeCursor?: CursorState | undefined;
  pageNumber: number;
}

/**
 * Configuration for the streaming adapter. Supply only provider-specific
 * pieces; the adapter owns the loop, dedup, cursor-state building, and replay.
 *
 * Key hooks for complex providers:
 * - fetchPage: perform the HTTP/RPC call; read ctx.replayedCursor/pageToken to
 *   build params (e.g., Solana `before`=signature, EVM `from_block`, NEAR
 *   `page`). Return raw items plus nextPageToken/isComplete.
 * - derivePageParams: translate persisted CursorState into your pagination
 *   dialect (page numbers from timestamp cursor, Solana signature from slot or
 *   timestamp). The return merges into the context before fetchPage runs.
 * - applyReplayWindow: adjust primary cursor before use (block-5, slot-2,
 *   timestamp-5min). Optional if replay is meaningless for the cursor type.
 */
export interface StreamingAdapterOptions<Raw, Tx> {
  providerName: string;
  operation: ProviderOperation;
  resumeCursor?: CursorState | undefined;
  fetchPage: (ctx: StreamingPageContext) => Promise<Result<StreamingPage<Raw>, Error>>;
  mapItem: (raw: Raw) => Result<TransactionWithRawData<Tx>, Error>;
  extractCursors: (tx: Tx) => PaginationCursor[];
  applyReplayWindow?: ((cursor: PaginationCursor) => PaginationCursor) | undefined;
  dedupWindowSize?: number | undefined;
  /**
   * Optional hook to transform resume cursor into provider-specific
   * parameters (e.g., Solana signatures, NEAR page numbers). The result
   * is merged into the context passed to `fetchPage`.
   */
  derivePageParams?:
    | ((ctx: {
        pageToken?: string | undefined;
        replayedCursor?: PaginationCursor | undefined;
        resumeCursor?: CursorState | undefined;
      }) => Partial<StreamingPageContext>)
    | undefined;
  /**
   * Optional logger for diagnostics; must match the BaseApiClient logger API.
   */
  logger?: { debug: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void } | undefined;
}

export function createStreamingIterator<Raw, Tx extends { id: string }>(
  opts: StreamingAdapterOptions<Raw, Tx>
): AsyncIterableIterator<Result<StreamingBatchResult<Tx>, Error>> {
  const {
    providerName,
    resumeCursor,
    fetchPage,
    mapItem,
    extractCursors,
    applyReplayWindow,
    dedupWindowSize,
    derivePageParams,
    logger,
  } = opts;

  const initialPageToken =
    resumeCursor?.primary.type === 'pageToken' && resumeCursor.primary.providerName === providerName
      ? resumeCursor.primary.value
      : undefined;

  const replayedCursor =
    resumeCursor?.primary && applyReplayWindow ? applyReplayWindow(resumeCursor.primary) : undefined;

  const dedupWindow = createDeduplicationWindow(
    resumeCursor?.lastTransactionId ? [resumeCursor.lastTransactionId] : []
  );
  const dedupLimit = dedupWindowSize ?? 500;

  return (async function* streamingGenerator() {
    let pageToken = initialPageToken;
    let pageNumber = 0;
    let totalFetched = resumeCursor?.totalFetched || 0;

    while (true) {
      const derivedParams = derivePageParams?.({ resumeCursor, replayedCursor, pageToken });
      const pageCtx: StreamingPageContext = {
        pageToken,
        replayedCursor,
        resumeCursor,
        pageNumber,
        ...(derivedParams || {}),
      };

      const pageResult = await fetchPage(pageCtx);
      if (pageResult.isErr()) {
        yield err(pageResult.error);
        return;
      }

      const page = pageResult.value;
      const rawItems = page.items || [];

      if (rawItems.length === 0) {
        if (!page.nextPageToken && page.isComplete) {
          logger?.debug?.('Streaming adapter reached explicit completion with empty page', { providerName });
        }
        break;
      }

      const mappedBatch: TransactionWithRawData<Tx>[] = [];
      for (const raw of rawItems) {
        const mapped = mapItem(raw);
        if (mapped.isErr()) {
          yield err(mapped.error);
          return;
        }
        mappedBatch.push(mapped.value);
      }

      const deduped = deduplicateTransactions(mappedBatch, dedupWindow, dedupLimit);

      // If everything was deduped but this is the terminal page, still emit a completion cursor
      if (deduped.length === 0) {
        pageToken = page.nextPageToken || undefined;
        if (!pageToken) {
          const cursorState = buildCursorState({
            transactions: mappedBatch,
            extractCursors: (tx) => extractCursors(tx),
            totalFetched,
            providerName,
            pageToken,
            isComplete: true,
            customMetadata: page.customMetadata,
          });

          yield ok({ data: [], cursor: cursorState });
          return;
        }

        logger?.debug?.('Streaming adapter skipped fully-deduped page', { providerName, pageNumber });
        pageNumber += 1;
        continue;
      }

      totalFetched += deduped.length;

      const cursorState = buildCursorState({
        transactions: deduped,
        extractCursors: (tx) => extractCursors(tx),
        totalFetched,
        providerName,
        pageToken: page.nextPageToken || undefined,
        isComplete: page.isComplete ?? !page.nextPageToken,
        customMetadata: page.customMetadata,
      });

      yield ok({ data: deduped, cursor: cursorState });

      pageToken = page.nextPageToken || undefined;
      pageNumber += 1;

      if (!pageToken || page.isComplete) {
        return;
      }
    }
  })();
}
