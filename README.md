# <img src="./docs/assets/images/exitbook-brand.png" alt="ExitBook" width="50" align="middle"/><span>&nbsp;&nbsp;</span>ExitBook

**Track, log, and analyze your crypto journey.**
_Your personal book of crypto decisions — from entry to cash-out._

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/your-org/exitbook/ci.yml?branch=main)](https://github.com/your-org/exitbook/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-blue.svg)](https://nodejs.org)
[![NestJS](https://img.shields.io/badge/built%20with-NestJS-red.svg)](https://nestjs.com)

---

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

👉 Full architecture and strategy are detailed in the [Greenfield Strategy Doc](docs/greenfield-strategy.md).

---

## ⚡ Quickstart

```bash
# Clone the repo
git clone https://github.com/your-org/exitbook.git
cd exitbook

# Install dependencies
pnpm install

# Run migrations
pnpm drizzle-kit migrate

# Start API server
pnpm start api

# Run CLI
pnpm start cli
```

API runs at `http://localhost:3000` by default.

---

## 📚 Features (MVP)

- [x] Database schema with currencies, accounts, ledger, entries
- [x] Drizzle migrations & currency seeding
- [x] Ledger service with balance validation
- [ ] Import orchestration for exchanges (Kraken, Binance, etc.)
- [ ] CLI commands for imports & balance snapshots
- [ ] REST endpoints for accounts, balances, transactions

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
