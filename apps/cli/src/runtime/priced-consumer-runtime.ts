import type { AccountingExclusionPolicy } from '@exitbook/accounting/cost-basis';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import type { CliOutputFormat } from '../features/shared/cli-output-format.js';

import { loadAccountingExclusionPolicy } from './accounting-exclusion-policy.js';
import type { CommandRuntime } from './command-runtime.js';
import { ensureConsumerInputsReady } from './consumer-input-readiness.js';
import type { PricePrereqConfig } from './price-readiness.js';

type PricedConsumerTarget = 'cost-basis' | 'portfolio';

interface PreparedPricedConsumerRuntime {
  accountingExclusionPolicy: AccountingExclusionPolicy;
  priceRuntime: IPriceProviderRuntime;
}

export async function preparePricedConsumerRuntime(
  ctx: CommandRuntime,
  options: {
    format: CliOutputFormat;
    priceConfig: PricePrereqConfig;
    profileId: number;
    profileKey: string;
    target: PricedConsumerTarget;
  }
): Promise<Result<PreparedPricedConsumerRuntime, Error>> {
  try {
    let prereqAbort: (() => void) | undefined;
    if (options.format !== 'json') {
      ctx.onAbort(() => {
        prereqAbort?.();
      });
    }

    const accountingExclusionPolicyResult = await loadAccountingExclusionPolicy(ctx.dataDir, options.profileKey);
    if (accountingExclusionPolicyResult.isErr()) {
      return err(accountingExclusionPolicyResult.error);
    }

    const readyResult = await ensureConsumerInputsReady(ctx, options.target, {
      format: options.format,
      profileId: options.profileId,
      profileKey: options.profileKey,
      priceConfig: options.priceConfig,
      accountingExclusionPolicy: accountingExclusionPolicyResult.value,
      setAbort: (abort) => {
        prereqAbort = abort;
      },
    });
    if (readyResult.isErr()) {
      return err(readyResult.error);
    }

    prereqAbort = undefined;
    const priceRuntime = await ctx.openPriceProviderRuntime();

    return ok({
      accountingExclusionPolicy: accountingExclusionPolicyResult.value,
      priceRuntime,
    });
  } catch (error) {
    return wrapError(error, `Failed to prepare ${options.target} runtime`);
  }
}
