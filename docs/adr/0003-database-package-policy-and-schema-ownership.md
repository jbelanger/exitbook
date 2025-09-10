# ADR‑0003 — Database Package Policy (Infra‑Only) & Schema Ownership

**Status:** Accepted **Date:** 2025‑09‑09 **Owner:** Platform Architecture
**Supersedes/Relates:** ADR‑0001 (Monorepo Structure & Boundaries), ADR‑0002
(Event Sourcing & Messaging)

---

## 1) Problem & Goals

Our monorepo currently has (or proposes) a `packages/platform/database` package.
Without strict boundaries, such a package can turn into a catch‑all for schemas,
DAOs, and domain SQL — encouraging teams to bypass platform boundaries
(especially the Event Store in ADR‑0002).

**Goal:** Define a clear policy so `platform/database` remains **thin and
infrastructural only**, while **each owning package** ships its own schemas and
migrations next to its code.

**Non‑Goals:**

- Designing domain schemas for every package.
- Choosing a specific migration framework (we support any that can emit SQL
  strings or function steps).

---

## 2) Decision (High Level)

- Keep `packages/platform/database` **infra‑only**: connection pool/config,
  transaction helper, healthchecks, tracing, and a **migration runner shell**.
- **Prohibit** any domain/platform **DDL or ORM models** inside
  `platform/database`.
- **Require** every storage owner to ship **its own migrations** colocated with
  the package:
  - `event‑store` → owns `events` + `outbox` tables.
  - `projections` → owns its read‑model tables.
  - `messaging` adapters (rare) → own any tiny offset/lease tables they need.
  - contexts that own private read stores → own their tables under the context
    package.

- Provide a **migration aggregation runner** that collects providers from
  packages and applies them in a single operation.

---

## 3) Monorepo Layout (relevant slices)

```
packages/platform/
├─ events/
│  ├─ event-store/               # owns events & outbox DDL/migrations
│  ├─ projections/               # owns projection DDL/migrations
│  └─ ...
├─ messaging/                    # may own its adapter-specific storage
├─ database/                     # infra-only: connection, tx helper, migration runner shell
└─ ...
apps/
├─ tools/migrate/                # small CLI that calls the runner with providers
└─ ...
```

---

## 4) Contracts & Code (TypeScript / Effect)

### 4.1 Database package (infra-only)

**Exports:**

- `DatabaseConnection` — Effect tag for pooled client
- `DatabaseDefault` — Layer creating the client from env
- `withTransaction<A>(fa: Effect<A>): Effect<A>` — tx helper
- **Migration runner shell** (no migrations inside this package)

```ts name=packages/platform/database/src/index.ts
import { Context, Layer, Effect } from 'effect';

export interface SqlClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export const DatabaseConnection = Context.GenericTag<SqlClient>(
  '@platform/DatabaseConnection',
);
export const DatabaseDefault = Layer.effect(
  DatabaseConnection,
  makePgClientFromEnv(),
); // impl private

export const withTransaction = <A>(fa: Effect.Effect<A>) =>
  Effect.gen(function* () {
    const db = yield* DatabaseConnection;
    try {
      yield* Effect.tryPromise(() => db.begin());
      const a = yield* fa;
      yield* Effect.tryPromise(() => db.commit());
      return a;
    } catch (e) {
      yield* Effect.tryPromise(() => db.rollback());
      throw e;
    }
  });
```

```ts name=packages/platform/database/src/runner.ts
export type Migration = { id: string; up: string; down?: string };
export type MigrationProvider = () => Promise<Migration[]>; // packages implement

export async function runMigrations(
  providers: MigrationProvider[],
  apply: (m: Migration) => Promise<void>,
) {
  const batches = await Promise.all(providers.map((p) => p()));
  const migrations = batches.flat();
  // naive sort by id (recommend prefix numbers yyyyMMddHHmm)
  migrations.sort((a, b) => a.id.localeCompare(b.id));
  for (const m of migrations) await apply(m);
}
```

> **Note:** The actual `apply` function can use a meta table (e.g.,
> `schema_migrations`) in the target DB to record applied IDs and make the
> operation idempotent.

### 4.2 Owner package ships its migrations

```ts name=packages/platform/events/event-store/src/migrations/index.ts
import { readFile } from 'node:fs/promises';
export const eventStoreMigrations = async () => [
  {
    id: '20250909_001_events_outbox',
    up: await readFile(
      new URL('./001_events_outbox_up.sql', import.meta.url),
      'utf8',
    ),
    down: await readFile(
      new URL('./001_events_outbox_down.sql', import.meta.url),
      'utf8',
    ),
  },
];
```

```sql name=packages/platform/events/event-store/src/migrations/001_events_outbox_up.sql
-- events & outbox tables (see ADR-0002 DDL)
```

### 4.3 Aggregating migrations in a tool app

```ts name=apps/tools/migrate/src/main.ts
import { runMigrations } from '@exitbook/platform-database/runner';
import { eventStoreMigrations } from '@exitbook/platform-event-store/migrations';
import { projectionsMigrations } from '@exitbook/platform-projections/migrations';

await runMigrations(
  [eventStoreMigrations, projectionsMigrations],
  async (m) => {
    // Example apply: use DatabaseConnection to run SQL if not applied yet
    // (implementation omitted for brevity)
  },
);
```

---

## 5) Policy (Allowed vs Forbidden)

### Allowed in `platform/database` (infra only)

- Connection factory/pool configuration, TLS, timeouts, healthchecks
- Transaction helper utilities
- Tracing/logging middlewares
- Migration **runner infrastructure** (no actual DDL)

### Forbidden in `platform/database`

- ❌ Any **DDL** (tables, indexes) for domains or platform features
- ❌ ORM entities/models, DAOs, repositories
- ❌ Event schemas/codecs
- ❌ Seed data for domains

### Schema ownership

- **Event Store** owns `events` & `outbox` DDL/migrations (ADR‑0002)
- **Projections** owns its read‑model DDL/migrations
- **Messaging adapters** (if needed) own their tiny tables
- **Contexts** may own private read stores (colocated)

---

## 6) Enforcement

- **ESLint boundaries** — forbid `@platform/database` imports from `apps/*` and
  `packages/contexts/*`.
- **CODEOWNERS** — `platform/database` owned by Platform Core; DDL in owner
  packages owned by those teams.
- **CI check** — migration scanner ensures no `.sql` resides under
  `packages/platform/database/**`.

**ESLint sample**

```json
{
  "overrides": [
    {
      "files": ["**/*.ts"],
      "rules": {
        "no-restricted-imports": [
          "error",
          {
            "paths": [
              {
                "name": "@exitbook/platform-database",
                "message": "Only platform adapters may import database. Apps/contexts must not."
              }
            ]
          }
        ]
      }
    }
  ]
}
```

---

## 7) Operations & Runbooks

- **Provisioning:** `platform/database` exposes a single Layer to create the
  pool from env; each owner package documents its required roles/privileges.
- **Migrations:** The tool app aggregates providers; meta table guards
  idempotency; rollbacks are package‑scoped.
- **Observability:** Connection metrics and slow query logs are centralized in
  `platform/database`; schema‑specific metrics live with owning packages.

---

## 8) Risks & Trade‑offs

- **Many migration folders:** spread across packages — mitigated by the
  aggregator tool.
- **Discoverability:** developers must look in the owning package; mitigated
  with docs links and ADR references.
- **Runner drift:** ensure common meta table format and ordering rule
  (timestamped IDs).

---

## 9) Migration Plan (if we previously stored DDL centrally)

1. Identify all DDL under `platform/database` and move each script to its owning
   package.
2. Add re‑numbered IDs following `YYYYMMDD_HHMM_<name>` in the new locations.
3. Update the **migrate tool** to import from new providers.
4. Lock `platform/database` with CI checks and ESLint rule.
5. Announce policy; update developer handbook.

---

## 10) PR Checklist

- [ ] No DDL/ORM entities added under `packages/platform/database`.
- [ ] New tables/indexes live next to the **owning package**.
- [ ] Migrations exported via a provider `() => Promise<Migration[]>`.
- [ ] Migrate tool updated with the provider.
- [ ] ESLint boundary passes; CI migration scanner passes.
- [ ] Docs updated (link ADR‑0003 from owner package README).

---

## 11) FAQ

**Q: Where do I put a new index for a projection table?** A: In
`packages/platform/events/projections/src/migrations/*` — the projections
package owns it.

**Q: My messaging adapter needs a lease table. Where does it go?** A: Inside
`packages/platform/messaging/src/migrations/*` for that adapter.

**Q: Can a context own a read store?** A: Yes. Colocate its migrations under the
context package; contexts/apps still must not import `platform/database`
directly.

---

## 12) References

- ADR‑0001 — Monorepo Structure & Boundaries
- ADR‑0002 — Event Sourcing & Messaging
