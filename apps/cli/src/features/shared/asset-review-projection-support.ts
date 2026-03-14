import { createAssetReviewProviderSupport } from '@exitbook/blockchain-providers';
import { err, ok, type Result } from '@exitbook/core';
import { OverrideStore, readAssetReviewDecisions } from '@exitbook/data';
import type { AssetReviewReferenceResolver, AssetReviewTokenMetadataReader } from '@exitbook/ingestion';

interface AssetReviewProjectionSupport {
  loadReviewDecisions: () => ReturnType<typeof readAssetReviewDecisions>;
  referenceResolver?: AssetReviewReferenceResolver | undefined;
  tokenMetadataReader?: AssetReviewTokenMetadataReader | undefined;
  close(): Promise<void>;
}

export async function openAssetReviewProjectionSupport(
  dataDir: string
): Promise<Result<AssetReviewProjectionSupport, Error>> {
  const overrideStore = new OverrideStore(dataDir);
  const providerSupportResult = await createAssetReviewProviderSupport(dataDir);
  if (providerSupportResult.isErr()) {
    return err(providerSupportResult.error);
  }

  const providerSupport = providerSupportResult.value;

  return ok({
    loadReviewDecisions: () => readAssetReviewDecisions(overrideStore),
    tokenMetadataReader: providerSupport.tokenMetadataReader,
    referenceResolver: providerSupport.referenceResolver,
    async close() {
      await providerSupport.cleanup();
    },
  });
}
