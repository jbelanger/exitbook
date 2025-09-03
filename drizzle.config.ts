import type { Config } from 'drizzle-kit';

export default {
  schema: './libs/database/src/schema/*.ts',
  out: './libs/database/src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://crypto_user:crypto_pass@localhost:5432/crypto_tx_import',
  },
} satisfies Config;