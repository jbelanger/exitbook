#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
if [ "$ROOT" != "." ]; then
  mkdir -p "$ROOT"
fi

say() { printf "• %s\n" "$*"; }

mkcontext() {
  local ctx="$1"
  mkdir -p "$ROOT/packages/contexts/$ctx/core/value-objects"
  mkdir -p "$ROOT/packages/contexts/$ctx/core/events"
  mkdir -p "$ROOT/packages/contexts/$ctx/core/aggregates"
  mkdir -p "$ROOT/packages/contexts/$ctx/core/services"
  mkdir -p "$ROOT/packages/contexts/$ctx/ports"
  mkdir -p "$ROOT/packages/contexts/$ctx/adapters/repositories"
  mkdir -p "$ROOT/packages/contexts/$ctx/adapters/integrations"
  mkdir -p "$ROOT/packages/contexts/$ctx/adapters/projections"
  mkdir -p "$ROOT/packages/contexts/$ctx/app/commands"
  mkdir -p "$ROOT/packages/contexts/$ctx/app/queries"
  mkdir -p "$ROOT/packages/contexts/$ctx/app/sagas"

  # minimal index files so TS path aliases compile cleanly
  cat > "$ROOT/packages/contexts/$ctx/core/index.ts" <<'EOF'
// Pure domain for this context: exports from aggregates, events, VOs, policies.
// No framework or I/O imports here.
export * from "./value-objects";
export * from "./events";
export * from "./aggregates";
export * from "./services";
EOF

  cat > "$ROOT/packages/contexts/$ctx/ports/index.ts" <<'EOF'
// Effect "ports" (service tags/interfaces) the app/core depend on.
// Implementations live under adapters/.
export interface RepositoryPort { /* define methods */ }
export interface MessageBusPort { /* define methods */ }
// export const RepositoryTag = Symbol.for("RepositoryPort") as unique symbol;
EOF

  cat > "$ROOT/packages/contexts/$ctx/app/index.ts" <<'EOF'
// Thin orchestration (commands/queries/sagas) that composes core with ports.
// Keep logic here minimal; push rules into core/services.
export * from "./commands";
export * from "./queries";
export * from "./sagas";
EOF
}

say "Scaffolding monorepo at: $ROOT"

# Top-level
mkdir -p "$ROOT/apps/api/src/shell/controllers"
mkdir -p "$ROOT/apps/api/src/shell/dto"
mkdir -p "$ROOT/apps/api/src/shell/filters"
mkdir -p "$ROOT/apps/api/src/shell/interceptors"
mkdir -p "$ROOT/apps/api/src/modules"
mkdir -p "$ROOT/apps/api/src/boot"
mkdir -p "$ROOT/apps/api/test"

mkdir -p "$ROOT/apps/workers/src"
mkdir -p "$ROOT/apps/cli/src"
mkdir -p "$ROOT/apps/web/src"
mkdir -p "$ROOT/apps/web/test"

mkdir -p "$ROOT/packages/core/domain/base"
mkdir -p "$ROOT/packages/core/domain/common-types"
mkdir -p "$ROOT/packages/core/domain/common-errors"
mkdir -p "$ROOT/packages/core/effect"
mkdir -p "$ROOT/packages/core/utils"

# Contexts
mkcontext "trading"
mkcontext "portfolio"
mkcontext "taxation"
mkcontext "reconciliation"

# Platform (cross-cutting infra)
mkdir -p "$ROOT/packages/platform/event-store"
mkdir -p "$ROOT/packages/platform/database"
mkdir -p "$ROOT/packages/platform/messaging"
mkdir -p "$ROOT/packages/platform/cache"
mkdir -p "$ROOT/packages/platform/monitoring"
mkdir -p "$ROOT/packages/platform/security"

# Shared contracts + clients + UI + tooling
mkdir -p "$ROOT/packages/contracts/api"
mkdir -p "$ROOT/packages/contracts/messages"
mkdir -p "$ROOT/packages/api-client/src"
mkdir -p "$ROOT/packages/ui/src"
mkdir -p "$ROOT/packages/config"
mkdir -p "$ROOT/packages/tooling"

# Infra + docs + CI
mkdir -p "$ROOT/infra/docker"
mkdir -p "$ROOT/infra/k8s"
mkdir -p "$ROOT/infra/terraform"
mkdir -p "$ROOT/infra/migrations"
mkdir -p "$ROOT/infra/scripts"

mkdir -p "$ROOT/docs/adr"
mkdir -p "$ROOT/docs/domain"
mkdir -p "$ROOT/docs/architecture"
mkdir -p "$ROOT/docs/runbooks"
mkdir -p "$ROOT/docs/openapi"
mkdir -p "$ROOT/docs/handbook"

mkdir -p "$ROOT/.github/workflows"
mkdir -p "$ROOT/.changeset"

# --- Root files -------------------------------------------------------------
cat > "$ROOT/.gitignore" <<'EOF'
# Node / TypeScript
node_modules/
dist/
build/
coverage/
*.tsbuildinfo

# Env
.env
.env.local

# Turborepo / Nx
.out/
.turbo/
nx-cache/
EOF

cat > "$ROOT/README.md" <<'EOF'
# Monorepo

Apps in `apps/*`, reusable libraries in `packages/*`.
- **apps/api**: NestJS Imperative Shell (controllers, DTOs, modules)
- **apps/web**: Frontend (Remix/Next)
- **packages/contexts/**: Functional core per bounded context (core/ports/adapters/app)
- **packages/platform**: Cross-cutting infra (event-store, db, cache, messaging, monitoring)
- **packages/contracts**: OpenAPI/Zod schemas shared FE/BE
- **infra**: docker/k8s/terraform/migrations/scripts
- **docs**: ADRs, domain maps, architecture, runbooks, OpenAPI

Golden import rules: apps → packages only; core is pure; adapters implement ports; no cross-context leakage.
EOF

cat > "$ROOT/pnpm-workspace.yaml" <<'EOF'
packages:
  - "apps/*"
  - "packages/*"
  - "packages/contexts/*"
EOF

cat > "$ROOT/tsconfig.base.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "baseUrl": ".",
    "paths": {
      "@core/*": ["packages/core/*"],
      "@contracts/*": ["packages/contracts/*"],
      "@platform/*": ["packages/platform/*"],
      "@ctx/*": ["packages/contexts/*"],
      "@ui/*": ["packages/ui/*"]
    }
  }
}
EOF

cat > "$ROOT/turbo.json" <<'EOF'
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "lint": { "outputs": [] },
    "typecheck": { "outputs": [] },
    "build": { "outputs": ["dist/**", "build/**"] },
    "test": { "outputs": ["coverage/**"] },
    "dev": { "cache": false }
  }
}
EOF

cat > "$ROOT/package.json" <<'EOF'
{
  "name": "monorepo",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "lint": "echo \"(stub) add eslint/biome here\"",
    "typecheck": "tsc -b",
    "build": "turbo run build",
    "test": "turbo run test",
    "dev": "turbo run dev --parallel"
  }
}
EOF

cat > "$ROOT/.env.example" <<'EOF'
# API
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/app

# Redis
REDIS_URL=redis://localhost:6379
EOF

# --- apps/api (Nest shell) --------------------------------------------------
cat > "$ROOT/apps/api/package.json" <<'EOF'
{
  "name": "@apps/api",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/main.ts",
    "start": "node dist/src/main.js",
    "test": "vitest run"
  }
}
EOF

cat > "$ROOT/apps/api/tsconfig.json" <<'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
EOF

cat > "$ROOT/apps/api/src/main.ts" <<'EOF'
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
  console.log(`API listening on :${process.env.PORT ?? 3000}`);
}
bootstrap();
EOF

cat > "$ROOT/apps/api/src/modules/app.module.ts" <<'EOF'
import { Module } from '@nestjs/common';

// Bridge Nest providers to Effect layers here (adapters in packages/contexts/*/adapters)
@Module({
  imports: [],
  providers: [],
})
export class AppModule {}
EOF

cat > "$ROOT/apps/api/src/shell/controllers/health.controller.ts" <<'EOF'
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get() ok() { return { status: 'ok' }; }
}
EOF

# --- apps/web (frontend placeholder) ---------------------------------------
cat > "$ROOT/apps/web/package.json" <<'EOF'
{
  "name": "@apps/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "echo \"(stub) add your Remix/Next dev script\"",
    "build": "echo \"(stub) add your Remix/Next build script\"",
    "test": "vitest run"
  }
}
EOF

# --- apps/workers & cli (placeholders) -------------------------------------
cat > "$ROOT/apps/workers/package.json" <<'EOF'
{
  "name": "@apps/workers",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json"
  }
}
EOF

cat > "$ROOT/apps/cli/package.json" <<'EOF'
{
  "name": "@apps/cli",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json"
  }
}
EOF

# --- packages/core ----------------------------------------------------------
cat > "$ROOT/packages/core/package.json" <<'EOF'
{
  "name": "@core/root",
  "private": true,
  "type": "module",
  "exports": "./index.ts"
}
EOF

cat > "$ROOT/packages/core/index.ts" <<'EOF'
export * from "./domain";
export * from "./effect";
export * from "./utils";
EOF

cat > "$ROOT/packages/core/domain/index.ts" <<'EOF'
export * from "./base";
export * from "./common-types";
export * from "./common-errors";
EOF

cat > "$ROOT/packages/core/domain/base/index.ts" <<'EOF'
// Minimal domain base primitives (extend to your liking)
export type UUID = string;

export abstract class Entity<TProps> {
  constructor(public readonly id: UUID, public readonly props: Readonly<TProps>) {}
}

export abstract class AggregateRoot<TProps> extends Entity<TProps> {
  private _events: unknown[] = [];
  protected raise(event: unknown) { this._events.push(event); }
  pullEvents(): unknown[] { const e = this._events; this._events = []; return e; }
}
EOF

cat > "$ROOT/packages/core/effect/index.ts" <<'EOF'
// Central place to expose Effect runtime/layers (Clock, Config, UUID, etc.)
// Keep imports framework-free; adapters provide concrete implementations.
export interface Clock { now(): Date }
export const DefaultClock: Clock = { now: () => new Date() };
EOF

cat > "$ROOT/packages/core/utils/index.ts" <<'EOF'
export const never = (_: never): never => { throw new Error("unreachable"); };
EOF

# --- one context has stubs already; add minimal exports for others ----------
for ctx in portfolio taxation reconciliation; do
  cat > "$ROOT/packages/contexts/$ctx/index.ts" <<EOF
export * as Core from "./core";
export * as Ports from "./ports";
export * as App from "./app";
EOF
done

cat > "$ROOT/packages/contexts/trading/index.ts" <<'EOF'
export * as Core from "./core";
export * as Ports from "./ports";
export * as App from "./app";
EOF

# --- platform ---------------------------------------------------------------
cat > "$ROOT/packages/platform/index.ts" <<'EOF'
// Cross-cutting infra: event-store, db, cache, messaging, monitoring, security
export * as EventStore from "./event-store";
export * as Database from "./database";
export * as Cache from "./cache";
export * as Messaging from "./messaging";
export * as Monitoring from "./monitoring";
export * as Security from "./security";
EOF

cat > "$ROOT/packages/platform/event-store/index.ts" <<'EOF'
// EventStore facade (append/read, snapshots, outbox, idempotency)
export interface EventRecord { streamId: string; version: number; type: string; data: unknown; }
export interface EventStore {
  read(streamId: string): Promise<EventRecord[]>;
  append(streamId: string, expectedVersion: number, events: EventRecord[]): Promise<void>;
}
EOF

# --- contracts + api-client + ui -------------------------------------------
cat > "$ROOT/packages/contracts/api/index.ts" <<'EOF'
// Place Zod/OpenAPI-derived runtime schemas and exported types here.
export const placeholder = true;
EOF

cat > "$ROOT/packages/contracts/messages/index.ts" <<'EOF'
// Message payload schemas shared across producers/consumers.
export const placeholder = true;
EOF

cat > "$ROOT/packages/api-client/src/index.ts" <<'EOF'
// Generated API client (wire OpenAPI codegen here in CI)
export const placeholder = true;
EOF

cat > "$ROOT/packages/ui/src/index.ts" <<'EOF'
// Design system entrypoint (tokens + shadcn/tailwind components)
export const placeholder = true;
EOF

# --- infra ------------------------------------------------------------------
cat > "$ROOT/infra/docker/compose.dev.yml" <<'EOF'
version: "3.9"
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
    ports: ["5432:5432"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
EOF

cat > "$ROOT/infra/scripts/dev.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
pnpm -w dev
EOF
chmod +x "$ROOT/infra/scripts/dev.sh"

# --- docs -------------------------------------------------------------------
cat > "$ROOT/docs/adr/0000-record-architecture-decisions.md" <<'EOF'
# ADR-0000: Record architecture decisions
We use ADRs to capture context and consequences of significant decisions.
EOF

cat > "$ROOT/docs/openapi/openapi.yaml" <<'EOF'
openapi: 3.0.3
info:
  title: API
  version: 0.1.0
paths:
  /health:
    get:
      operationId: getHealth
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  status: { type: string }
EOF

# --- CI (GitHub Actions) ----------------------------------------------------
cat > "$ROOT/.github/workflows/ci.yml" <<'EOF'
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -w lint
      - run: pnpm -w typecheck || true   # loosen until tsconfig per pkg is added
      - run: pnpm -w build
EOF

say "Done."
say "Next steps:"
say "  1) pnpm install (root), then add deps to each app/package as needed"
say "  2) Wire Nest providers to your Effect ports (apps/api/src/modules/*)"
say "  3) Hook OpenAPI → packages/api-client generation in CI"
