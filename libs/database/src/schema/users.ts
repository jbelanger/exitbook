import type { InferSelectModel } from 'drizzle-orm';
import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  id: uuid('id').primaryKey().defaultRandom(),
  isActive: boolean('is_active').default(true).notNull(),
  name: varchar('name', { length: 255 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type User = InferSelectModel<typeof users>;
