/* eslint-disable @typescript-eslint/unbound-method -- ok for tests */
import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import type { AssetReviewProjectionWorkflowPorts } from '../../../ports/asset-review-projection-ports.js';
import { AssetReviewProjectionWorkflow } from '../asset-review-projection-workflow.js';

function createPorts(): AssetReviewProjectionWorkflowPorts {
  return {
    markAssetReviewBuilding: vi.fn().mockResolvedValue(ok(undefined)),
    listTransactions: vi.fn().mockResolvedValue(ok([])),
    loadReviewDecisions: vi.fn().mockResolvedValue(ok(new Map())),
    replaceAssetReviewProjection: vi.fn().mockResolvedValue(ok(undefined)),
    markAssetReviewFailed: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

describe('AssetReviewProjectionWorkflow', () => {
  it('loads transactions and decisions before replacing the projection', async () => {
    const ports = createPorts();
    const workflow = new AssetReviewProjectionWorkflow(ports);

    assertOk(await workflow.rebuild());

    expect(ports.markAssetReviewBuilding).toHaveBeenCalledTimes(1);
    expect(ports.listTransactions).toHaveBeenCalledTimes(1);
    expect(ports.loadReviewDecisions).toHaveBeenCalledTimes(1);
    expect(ports.replaceAssetReviewProjection).toHaveBeenCalledTimes(1);
    expect(ports.markAssetReviewFailed).not.toHaveBeenCalled();

    const firstCall = vi.mocked(ports.replaceAssetReviewProjection).mock.calls[0];
    expect(firstCall).toBeDefined();
    const [summaries, metadata] = firstCall!;
    expect(Array.from(summaries)).toEqual([]);
    expect(metadata).toEqual({ assetCount: 0 });
  });

  it('marks the projection failed when transaction loading fails', async () => {
    const ports = createPorts();
    vi.mocked(ports.listTransactions).mockResolvedValue(err(new Error('db unavailable')));
    const workflow = new AssetReviewProjectionWorkflow(ports);

    const error = assertErr(await workflow.rebuild());

    expect(error.message).toBe('Failed to load transactions for asset review projection: db unavailable');
    expect(ports.loadReviewDecisions).not.toHaveBeenCalled();
    expect(ports.replaceAssetReviewProjection).not.toHaveBeenCalled();
    expect(ports.markAssetReviewFailed).toHaveBeenCalledTimes(1);
  });

  it('marks the projection failed when review decisions cannot be loaded', async () => {
    const ports = createPorts();
    vi.mocked(ports.loadReviewDecisions).mockResolvedValue(err(new Error('override read failed')));
    const workflow = new AssetReviewProjectionWorkflow(ports);

    const error = assertErr(await workflow.rebuild());

    expect(error.message).toBe('override read failed');
    expect(ports.replaceAssetReviewProjection).not.toHaveBeenCalled();
    expect(ports.markAssetReviewFailed).toHaveBeenCalledTimes(1);
  });
});
