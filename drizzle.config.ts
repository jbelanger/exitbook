import type { Config } from 'drizzle-kit';

export default {
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://crypto_user:crypto_pass@localhost:5432/crypto_tx_import',
  },
  dialect: 'postgresql',
  out: './libs/database/src/migrations',
  schema: './libs/database/src/schema/*.ts',
} satisfies Config;
