import { OptionalAccountSelectorSchema } from '../../accounts/account-selector.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';

export const ReprocessCommandOptionsSchema = OptionalAccountSelectorSchema.extend(JsonFlagSchema.shape);
