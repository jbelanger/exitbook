import { z } from 'zod';

import { ExchangeClientCredentialsSchema } from '../../contracts/exchange-credentials.js';

export const KuCoinCredentialsSchema = ExchangeClientCredentialsSchema.extend({
  apiPassphrase: z.string().min(1),
});

export type KuCoinCredentials = z.infer<typeof KuCoinCredentialsSchema>;
