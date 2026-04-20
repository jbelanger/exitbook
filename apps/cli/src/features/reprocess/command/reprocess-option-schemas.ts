import { JsonFlagSchema } from '../../../cli/option-schema-primitives.js';
import { OptionalBareAccountSelectorSchema } from '../../accounts/account-selector.js';

export const ReprocessCommandOptionsSchema = OptionalBareAccountSelectorSchema.extend(JsonFlagSchema.shape);
