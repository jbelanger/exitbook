import { OptionalBareAccountSelectorSchema } from '../../accounts/account-selector.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';

export const BalanceViewCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend(JsonFlagSchema.shape);

export const BalanceRefreshCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend(JsonFlagSchema.shape);
