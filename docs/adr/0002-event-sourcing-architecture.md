# ADR‑0002 — Event Sourcing & Messaging (Initial Decision)

**Status:** Accepted **Date:** 2025‑09‑09 **Owner:** Platform Architecture
**Scope:** Event store, durable outbox, messaging, unified facade, checkpoints,
projections engine, worker, and app integration

---

## 1) Problem & Goals

We need a production‑grade way to:

- Record domain changes with an immutable **audit trail** (append‑only events).
- Reliably **notify external systems** (at‑least‑once), with retries and DLQ.
- **Rebuild read models** and run backfills.
- Offer **simple APIs** to application teams while keeping infra modular and
  swappable.

**Goals**

- Strong write guarantees: **single DB transaction**, **idempotency**,
  **per‑stream ordering**.
- Broker‑agnostic messaging with clear **headers/keys**, batching, and **DLQ**.
- Persisted **subscription checkpoints** (position/version) for safe resume.
- Optional **Projections Engine** for orchestrating read models.

**Non‑Goals**

- Exactly‑once delivery across boundaries.
- Building a message broker.

---

## 2) Decision (High Level)

Adopt a modular **Event Sourcing** architecture comprised of:

- **Event Store** (authoritative persistence, schema/codec registry).
- **Durable Outbox** rows written in the **same transaction** as events.
- **Outbox Worker** (daemon) to publish outbox rows via **Messaging**.
- **Messaging** package: producer/consumer, adapters
  (Kafka/Rabbit/SQS/SNS/NATS), headers, partitions, DLQ.
- **Unified Event Bus (facade)** composing store + messaging: `append`, `read`,
  `subscribeAll/Category/Stream`, `subscribeLive`, `publishExternal`.
- **Checkpoint Store** for persisted cursors.
- **Projections Engine** (optional until needed) orchestrating read models with
  checkpoints.

---

## 3) Architecture Overview

```
Request → Domain Logic → Append
                      │
                      ▼
            ┌──────────────────────┐
            │     EVENT STORE      │  ← single transaction
            │  events + outbox     │
            └─────────┬────────────┘
                      │ durable outbox rows
                      ▼
              OUTBOX WORKER (daemon)
            (poll→publish→ack/retry)
                      │
                      ▼
               MESSAGING (adapters)
            Kafka / Rabbit / SQS/SNS / NATS
                      │
                      ▼
                External Consumers
                      ▲
                      │  (for app DX)
         ┌────────────────────────────────┐
         │   UNIFIED EVENT BUS (facade)   │
         │ append / read / subscribe* /   │
         │ live (best‑effort) / publish   │
         └────────────────────────────────┘
                      │
                      ▼
             PROJECTIONS ENGINE (opt)
        register / rebuild / changes() / checkpoints
```

**Invariants**

- `append` is atomic with idempotency and `(stream,version)` uniqueness.
- Outbox rows are durable; Outbox Worker provides **at‑least‑once** publish with
  backoff & DLQ.
- Persisted subscriptions use **position** (all/category) or **version**
  (per‑stream) with checkpoints.
- Live pub/sub is **best‑effort** only.

---

## 4) Monorepo Layout (events subdir + meta)

```
packages/platform/
├─ events/
│  ├─ event-store/             # core store (ports + postgres + codecs + outbox writes)
│  ├─ event-bus/               # facade, checkpoint store, live pubsub
│  ├─ projections/             # projections engine (register/get/rebuild/changes)
│  ├─ outbox-worker/           # worker library (daemon logic)
│  └─ events/                  # meta-package (re-exports for app DX)
├─ messaging/                  # broker adapters (producer/consumer)
├─ database/
└─ monitoring/
```

### Package names

- `@exitbook/platform-event-store`
- `@exitbook/platform-event-bus`
- `@exitbook/platform-projections`
- `@exitbook/platform-outbox-worker`
- `@exitbook/platform-events` (meta)
- `@exitbook/platform-messaging`

### Dependency guardrails

- **event-store** → database only.
- **outbox-worker** → event-store + messaging.
- **event-bus** → event-store + messaging (+ checkpoint store).
- **projections** → event-store (+ optional checkpoint store).
- **messaging** → no event-store imports.
- Meta **events** → re-export surface only.

---

## 5) Data Model (DDL reference)

### 5.1 `events`

```sql
CREATE TABLE IF NOT EXISTS events (
  position      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stream_name   TEXT    NOT NULL,
  version       INT     NOT NULL,
  type          TEXT    NOT NULL,
  payload       JSONB   NOT NULL,
  metadata      JSONB   DEFAULT '{}'::jsonb,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_events_stream_version ON events(stream_name, version);
```

### 5.2 `outbox`

```sql
CREATE TABLE IF NOT EXISTS outbox (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_position  BIGINT  NOT NULL REFERENCES events(position),
  topic           TEXT    NOT NULL,
  payload         JSONB   NOT NULL,
  headers         JSONB   NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT    NOT NULL DEFAULT 'PENDING', -- PENDING|PROCESSING|PROCESSED|FAILED
  attempts        INT     NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_outbox_status_due ON outbox(status, next_attempt_at);
```

### 5.3 `subscription_checkpoints`

```sql
CREATE TABLE IF NOT EXISTS subscription_checkpoints (
  subscription_id   TEXT PRIMARY KEY,
  position          TEXT NOT NULL,      -- store bigint as text; parse in code
  events_processed  BIGINT DEFAULT 0,
  last_processed    TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6) Core Contracts

### 6.1 Event Store (TypeScript)

- **Types**: `DomainEvent` (decoded),
  `PositionedEvent = DomainEvent & { position: bigint; streamName: string }`.
- **Port:**

```ts
appendAndReturn(stream, events, expectedVersion, { idempotencyKey?, metadata? })
  => { appended: PositionedEvent[]; lastPosition: bigint; lastVersion: number }
readStream(stream, fromVersion): Effect<DomainEvent[]>
readAll(fromPosition, batchSize): Effect<PositionedEvent[]>
readCategory(category, fromPosition, batchSize): Effect<PositionedEvent[]>
```

- **Guarantees:** single‑tx append; unique `(stream,version)`; idempotency key;
  writes **outbox** rows in same tx.

### 6.2 Messaging

- **Producer:**

```ts
interface PublishOptions {
  key?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}
interface MessageBusProducer {
  publish(
    topic: string,
    payload: unknown,
    opts?: PublishOptions,
  ): Effect.Effect<void, PublishError>;
  publishBatch(
    topic: string,
    items: readonly { payload: unknown; opts?: PublishOptions }[],
  ): Effect.Effect<void, PublishError>;
}
```

- **Consumer:**

```ts
interface IncomingMessage<T = unknown> {
  key?: string;
  headers: Record<string, string>;
  payload: T;
  offset?: unknown;
}
interface Subscription {
  stop(): Effect.Effect<void, never>;
}
interface MessageBusConsumer {
  subscribe(
    topic: string,
    groupId: string,
    handler: (m: IncomingMessage) => Effect.Effect<void, never>,
  ): Effect.Effect<Subscription, SubscribeError>;
}
```

- **Conventions:** topic `domain.action.v1`; key = `event_position` (default) or
  business key; headers: `x-correlation-id`, `x-causation-id`, `x-user-id`,
  `x-service`, `x-service-version`, `content-type`, `schema-version`.

### 6.3 Unified Event Bus (facade)

```ts
append(stream, events, expectedVersion, { idempotencyKey?, metadata? })
  => { appended: PositionedEvent[]; lastPosition: bigint; lastVersion: number }
read(stream, fromVersion): Stream<DomainEvent>
subscribeAll(subscriptionId, fromPosition): Stream<PositionedEvent>
subscribeCategory(subscriptionId, category, fromPosition): Stream<PositionedEvent>
subscribeStream(subscriptionId, stream, fromVersion): Stream<DomainEvent>
subscribeLive(pattern: string | { stream?: string; category?: string; type?: DomainEvent['_tag'] }): Stream<DomainEvent>
publishExternal(topic, event, opts): Effect<void, PublishError>
```

- **Notes:** persisted tails use **position** for all/category, **version** for
  streams; live is best‑effort.

### 6.4 Projections Engine

- **Use‑case:** manage read models at scale (register/read/rebuild), handle
  backfills safely.
- **Port:**

```ts
interface Projection<State> {
  id: string;
  init: State;
  evolve(state: State, event: DomainEvent): State;
  filter?: (event: DomainEvent) => boolean;
}
interface ProjectionEngine {
  register<S>(p: Projection<S>): Effect.Effect<void>;
  get<S>(id: string): Effect.Effect<S, ProjectionNotFound>;
  rebuild(id: string, fromPosition?: bigint): Effect.Effect<void>;
  changes<S>(id: string): Stream.Stream<S, never>;
}
```

- **Backed by:** `subscribeAll/Category` + **Checkpoint Store**; checkpoints per
  projection id; periodic snapshotting optional.

### 6.5 Outbox Worker (library)

- Poll selector:

```sql
SELECT * FROM outbox
 WHERE status IN ('PENDING','FAILED')
   AND next_attempt_at <= NOW()
 ORDER BY id
 FOR UPDATE SKIP LOCKED
 LIMIT $BATCH;
```

- Steps: mark `PROCESSING` → publish via producer → on success `PROCESSED`, else
  `FAILED` with `attempts++` and `next_attempt_at = NOW() + backoff(attempts)`.
- **Backoff:** exponential with jitter; cap 5m; max attempts → DLQ/alert.
- **Scale:** multiple workers safe via `SKIP LOCKED`.

### 6.6 Checkpoint Store

```ts
save(key: string, position: bigint): Effect<void, CheckpointError>
load(key: string): Effect<bigint | undefined, CheckpointError>
```

- **Keys:** `all:<id>`, `cat:<category>:<id>`, `stream:<name>:<id>`.

---

## 7) Operational Runbook

**Deploy order**

1. Apply DDLs (events, outbox, subscription_checkpoints).
2. Deploy **event-store**, **messaging**.
3. Deploy **event-bus** (facade) for app usage.
4. Start **outbox-worker** (scale horizontally as needed).
5. (Optional) Deploy **projections** service using the engine.

**Metrics & alarms**

- Store: append latency, lock conflicts, idempotency conflicts, read latency.
- Outbox: depth, oldest age, attempts, publish latency, failure rate.
- Messaging: acks, DLQ size, consumer lag.
- Facade: subscription throughput, checkpoint staleness, live buffer.
- Projections: rebuild duration, snapshot interval, lag vs head.

**Backup/restore**

- Restore DB → tail from position `0n` to rebuild projections.
- Partition/retention policies for large `events` tables.

---

## 8) Testing Strategy

- **Unit:** schema/codec roundtrips; stream naming; expectedVersion logic.
- **Integration (DB):** single‑tx append → events + outbox; `(stream,version)`
  uniqueness; `readAll` ordering.
- **Integration (Worker+Broker):** success/failure, retries, DLQ; idempotent
  consumer behavior.
- **Contract:** facade API with in‑memory test layers.
- **Property‑based:** monotonic per‑stream versions; monotonic global positions.
- **Projection tests:** evolve logic, rebuild correctness from a seed position.

---

## 9) Security & Compliance

- Avoid logging PII; redact sensitive fields.
- Encrypt payload fields at rest when mandated.
- Sign/verify cross‑boundary messages; include service identity in headers.
- Least‑privilege DB roles; rotate credentials.

---

## 10) Risks & Trade‑offs

- **Complexity:** multiple packages and a daemon. _Mitigation:_ meta package,
  strong boundaries, runbooks.
- **Duplicates (at‑least‑once):** consumers must be idempotent keyed by
  `eventId`/`position`.
- **Rebuild cost:** replaying large logs. _Mitigation:_ projection snapshots,
  batch windows, archiving.

---

## 11) Alternatives Considered

- **CRUD + audit table only:** simplest but no replay/fan‑out guarantees.
- **Unified store+messaging package:** simpler surface but poor isolation/ops.
- **ES‑Lite (single package):** good for a single app; we choose full model to
  support multiple consumers.

---

## 12) Migration & Getting Started

**Step 1 — Migrations**

- Apply the DDLs above.

**Step 2 — Wire layers (dev)**

```ts
import { Layer, Effect } from 'effect';
import {
  UnifiedEventBusDefault,
  UnifiedEventBus,
} from '@exitbook/platform-event-bus/compose/default';

const program = Effect.gen(function* () {
  const bus = yield* UnifiedEventBus;
  const { appended } = yield* bus.append(
    'trade-42',
    [TradeExecuted(/* payload */)],
    0,
    {
      idempotencyKey: 'req-1234',
      metadata: { userId: 'u-1' },
    },
  );
});

Effect.runFork(Effect.provide(program, UnifiedEventBusDefault));
```

**Step 3 — Start outbox worker**

```ts
import { runOutboxDaemon } from '@exitbook/platform-outbox-worker';
Effect.runFork(runOutboxDaemon({ batchSize: 100, maxAttempts: 10 }));
```

**Step 4 — Projections (optional)**

```ts
import { ProjectionEngine } from '@exitbook/platform-projections';
const engine = yield * ProjectionEngine;
yield *
  engine.register({
    id: 'portfolio',
    init: {
      /* ... */
    },
    evolve,
    filter,
  });
```

**App DX — Meta package**

```ts
import {
  UnifiedEventBus,
  UnifiedEventBusDefault,
} from '@exitbook/platform-events';
```

---

## 13) PR Checklist (enforce this ADR)

- [ ] Writes use `appendAndReturn` with idempotency keys for retriable commands.
- [ ] Outbox rows are written in the same transaction as events.
- [ ] Consumers are idempotent (keyed by `eventId`/`position`); DLQ path tested.
- [ ] Subscriptions use persisted tails (position/version) with checkpoints;
      live only for UIs.
- [ ] No SQL/broker code inside the facade; facade composes ports only.
- [ ] Messaging adapters set headers (`x-correlation-id`, `x-causation-id`,
      `x-user-id`, service & version).
- [ ] Projections store checkpoints and can rebuild from `0n`.
- [ ] Package boundaries respect the dependency guardrails.

---

## 14) Glossary

- **Event Store:** append‑only log with per‑stream versions and a global
  position.
- **Outbox:** durable integration messages, written in the same tx as events.
- **Facade:** unified API that composes store + messaging for app DX.
- **Checkpoint:** persisted cursor (position/version) for subscriptions.
- **Projection:** read model derived from events, maintained by tailing the log.

---

## 15) Projects Structure & Scaffolding (Monorepo)

This section complements ADR‑0001 and specifies a concrete file/folder layout
for this ADR.

### 15.1 Repository layout

```
.
├─ apps/
│  ├─ api/                      # HTTP/gRPC shell(s) (Nest/Fastify/etc.)
│  ├─ workers/
│  │  └─ outbox/               # Deployable process using @platform-outbox-worker
│  └─ ui/                       # Optional web UI/console
│
├─ packages/
│  ├─ core/                     # Domain primitives, schemas, shared types
│  ├─ contexts/                 # Business contexts (pure app code)
│  │  ├─ trading/
│  │  │  ├─ src/
│  │  │  │  ├─ domain/         # aggregates, commands, events (typed)
│  │  │  │  ├─ services/
│  │  │  │  ├─ compose/        # effect layers wiring UnifiedEventBus for this context
│  │  │  │  └─ projections/    # optional per-context projections (using engine)
│  │  │  └─ package.json
│  │  └─ ...
│  │
│  └─ platform/
│     ├─ events/
│     │  ├─ event-store/
│     │  │  ├─ src/
│     │  │  │  ├─ index.ts            # clean exports (port/types/errors/helpers)
│     │  │  │  ├─ port.ts             # EventStore interface
│     │  │  │  ├─ types.ts            # DomainEvent, PositionedEvent, StreamName
│     │  │  │  ├─ errors.ts
│     │  │  │  ├─ adapters/postgres/  # SQL + codecs + impl
│     │  │  │  ├─ compose/            # Layer default/test
│     │  │  │  └─ internal/           # non-exported impl details
│     │  │  └─ package.json
│     │  │
│     │  ├─ event-bus/
│     │  │  ├─ src/
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ unified-event-bus.ts
│     │  │  │  ├─ checkpoint-store.ts
│     │  │  │  ├─ pattern.ts          # live matcher helper
│     │  │  │  ├─ errors.ts
│     │  │  │  └─ compose/
│     │  │  └─ package.json
│     │  │
│     │  ├─ projections/
│     │  │  ├─ src/
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ projection-engine.ts
│     │  │  │  └─ compose/
│     │  │  └─ package.json
│     │  │
│     │  ├─ outbox-worker/
│     │  │  ├─ src/
│     │  │  │  ├─ index.ts            # runOutboxDaemon(config)
│     │  │  │  ├─ backoff.ts
│     │  │  │  └─ compose/
│     │  │  └─ package.json
│     │  │
│     │  └─ events/                    # meta package (re-exports)
│     │     ├─ src/
│     │     │  ├─ index.ts
│     │     │  └─ compose/
│     │     └─ package.json
│     │
│     ├─ messaging/
│     │  ├─ src/
│     │  │  ├─ producer.ts             # MessageBusProducer
│     │  │  ├─ consumer.ts             # MessageBusConsumer
│     │  │  ├─ adapters/               # kafka/rabbit/sns-sqs/nats
│     │  │  └─ compose/
│     │  └─ package.json
│     │
│     ├─ database/
│     │  ├─ migrations/                # SQL migrations per package
│     │  └─ package.json
│     └─ monitoring/
│        └─ package.json
│
├─ docs/
│  ├─ adr/
│  │  ├─ ADR-0001-monorepo-structure.md
│  │  └─ ADR-0002-event-sourcing-and-messaging.md
│  ├─ runbooks/
│  │  ├─ outbox-worker.md
│  │  └─ projections.md
│  └─ handbook/architecture.md
│
├─ tools/                            # scripts, generators, devops helpers
├─ turbo.json (or nx.json)
├─ package.json (workspaces)
└─ tsconfig.base.json
```

### 15.2 App deployables

- **`apps/api`**: HTTP/gRPC boundary (controllers, DTOs). Depends on
  **contexts** packages and `@platform/events` (facade) via context compose
  layers.
- **`apps/workers/outbox`**: small binary that calls `runOutboxDaemon()` from
  `@platform-outbox-worker` and reads config from env.
- **`apps/ui`**: optional UI consuming live streams (best‑effort) and read APIs.

### 15.3 Lint boundaries (ESLint)

Prevent illegal couplings and keep the direction of dependencies:

```json
{
  "overrides": [
    {
      "files": ["packages/**/*.ts"],
      "rules": {
        "no-restricted-imports": [
          "error",
          {
            "paths": [
              {
                "name": "@exitbook/platform-event-store",
                "message": "Only platform may import store; apps go via contexts/event-bus"
              },
              {
                "name": "@exitbook/platform-messaging",
                "message": "Apps/contexts should not import messaging directly"
              }
            ],
            "patterns": [
              {
                "group": ["packages/contexts/**/src/internal/**"],
                "message": "Do not import context internals"
              }
            ]
          }
        ]
      }
    }
  ]
}
```

### 15.4 Example scaffolds

**apps/workers/outbox/src/main.ts**

```ts
import { Effect } from 'effect';
import { runOutboxDaemon } from '@exitbook/platform-outbox-worker';
import { UnifiedEventBusDefault } from '@exitbook/platform-event-bus/compose/default';

const program = runOutboxDaemon({ batchSize: 100, maxAttempts: 10 });
Effect.runFork(Effect.provide(program, UnifiedEventBusDefault));
```

**packages/platform/events/event-bus/src/compose/default.ts**

```ts
export { UnifiedEventBusDefault } from './generated-default-layer';
```

**apps/api/src/main.ts**

```ts
// Shell depends on contexts; contexts wire UnifiedEventBus internally via compose layers.
```

### 15.5 Ownership & CODEOWNERS

```
/packages/platform/events/event-store/   @platform-core
/packages/platform/events/event-bus/     @platform-core
/packages/platform/events/projections/   @data-eng @platform-core
/packages/platform/events/outbox-worker/ @platform-core @reliability
/packages/platform/messaging/            @platform-core @reliability
/apps/workers/outbox/                    @reliability
/apps/api/                               @app-shell
/packages/contexts/**                    @domain-teams
```

### 15.6 Environments & config

- Use `.env` per app (`apps/*/.env`) for shell concerns; platform packages read
  from effect layers/providers.
- Secrets via your standard secret manager (not in repo).
- DB migrations folder sits under `packages/platform/database/migrations` and is
  referenced by `event-store` adapter.

---

## 16 References & Links

- ADR‑0001 Monorepo Structure & Boundaries (root `docs/adr`).
- This ADR (ADR‑0002) is the authoritative reference for all event‑sourcing
  components.
