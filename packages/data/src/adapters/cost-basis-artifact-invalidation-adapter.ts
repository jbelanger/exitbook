import { ok, type Result } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

interface CostBasisArtifactInvalidationPorts {
  bumpPricesVersion(): Promise<Result<{ version: number }, Error>>;
}

export function buildCostBasisArtifactInvalidationPorts(db: DataContext): CostBasisArtifactInvalidationPorts {
  return {
    async bumpPricesVersion() {
      const result = await db.costBasisDependencyVersions.bumpVersion('prices');
      if (result.isErr()) {
        return result;
      }

      return ok({ version: result.value.version });
    },
  };
}
