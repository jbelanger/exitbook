import { OptionalBareAccountSelectorSchema } from '../../accounts/account-selector.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';

export const ReprocessCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend(JsonFlagSchema.shape);
