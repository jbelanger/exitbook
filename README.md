# <img src="./docs/assets/images/exitbook-brand.png" alt="ExitBook" width="50" align="middle"/><span>&nbsp;&nbsp;</span>ExitBook

**Track, log, and analyze your crypto journey.**

_Your personal book of crypto decisions — from entry to cash-out._

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/your-org/exitbook/ci.yml?branch=main)](https://github.com/your-org/exitbook/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D23-blue.svg)](https://nodejs.org)
[![NestJS](https://img.shields.io/badge/built%20with-NestJS-red.svg)](https://nestjs.com)

## 🚀 Overview

ExitBook is a **NestJS-based double-entry ledger system** for cryptocurrency.
It’s designed from the ground up using **CQRS**, **Drizzle ORM**, and a modular architecture.

- 📊 **Double-entry ledger** → balance-safe accounting for every crypto transaction
- 🔗 **Import pipelines** → exchange & blockchain integrations
- 🧩 **CQRS pattern** → small, focused handlers, no monolithic services
- ⚡ **NestJS monorepo** → API, CLI, and shared libraries in one place
- 🔒 **Local-first security** → your data, your control

---

## 🏗 Project Structure

```
exitbook/
├── apps/
│   ├── api/        # REST API (NestJS)
│   └── cli/        # CLI application (NestJS Commander)
├── libs/
│   ├── core/       # Entities, types, validation
│   ├── database/   # Drizzle ORM schema & repos
│   ├── ledger/     # Ledger & account services
│   ├── import/     # Importers & processors
│   ├── providers/  # Provider registry & managers
│   └── shared/     # Logging, errors, utils
```

👉 Full architecture and strategy are detailed in the [Project Strategy Doc](docs/architecture/future-v2/project-strategy.md).

---

## ⚡ Quickstart

```bash
# Clone the repo
git clone https://github.com/your-org/exitbook.git
cd exitbook

# Install dependencies
pnpm install

# Run migrations (requires PostgreSQL running)
pnpm db:migrate

# Start API server
pnpm start:api

# Run CLI
pnpm start:cli
```

API runs at `http://localhost:3000` by default.

---

## 📚 Features (Current Implementation Status)

### ✅ Phase 1: Foundation (COMPLETED)
- [x] **NestJS Monorepo Structure** - Apps (api, cli) and libs (@exitbook/core, database, etc.)
- [x] **Complete Database Schema** - All 7 tables with proper foreign keys, indexes, and constraints
- [x] **Drizzle ORM Integration** - Schema definitions, migrations, and database services
- [x] **Currency Management** - Automatic seeding of default currencies (BTC, ETH, USDC, SOL, USD)
- [x] **Database Health Checks** - Connection validation and seeding verification
- [x] **TypeScript Configuration** - Proper path mapping and monorepo compilation
- [x] **Build System** - Working NestJS compilation for API and CLI apps

### 🚧 Phase 2: Core Services (IN PROGRESS)
- [ ] Ledger service with balance validation and transaction recording
- [ ] Account service with hierarchy support for DeFi LP positions  
- [ ] Universal-to-Ledger transformation service
- [ ] Multi-currency precision handling with BigInt support

### 📋 Phase 3: Import Services (PLANNED)
- [ ] Import orchestration for exchanges (Kraken, Binance, etc.)
- [ ] Provider registry with circuit breakers and failover
- [ ] Transaction processors and Universal transaction format

### 🎯 Phase 4: Applications (PLANNED)
- [ ] REST API with OpenAPI documentation
- [ ] CLI commands for imports & balance snapshots  
- [ ] Health monitoring and metrics endpoints

---

## 🛠 Development

### Available Scripts

```bash
# Database operations
pnpm db:generate    # Generate new migration from schema changes  
pnpm db:migrate     # Run pending migrations
pnpm db:studio      # Launch Drizzle Studio (database GUI)

# Build and start
pnpm build:api      # Build API application
pnpm build:cli      # Build CLI application  
pnpm start:api      # Start API in production mode
pnpm start:cli      # Start CLI in production mode
pnpm start:dev      # Start API in development mode with watch

# Development tools
pnpm typecheck      # Run TypeScript compilation check across all packages
pnpm lint           # Run ESLint across all packages
pnpm lint:fix       # Auto-fix ESLint issues (including perfectionist sorting)
pnpm prettier:fix   # Auto-fix code formatting
```

### Prerequisites

- **Node.js** >= 23.0.0 (specified in package.json engines)
- **pnpm** >= 10.6.2 (package manager)
- **PostgreSQL** (for database, connection string in .env)

### Environment Setup

Copy `.env.example` to `.env` and adjust the database URL:

```bash
cp .env.example .env
# Edit .env with your PostgreSQL connection string
```

---

## 🧪 Testing

```bash
pnpm test
```

Includes:

- Unit tests for services
- Integration tests with Postgres test container
- End-to-end tests for API endpoints

---

## 📜 License

MIT © 2025 — Built with ❤️ for crypto builders and traders.
