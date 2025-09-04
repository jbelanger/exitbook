# `@exitbook/shared-config`

A robust, type-safe, and environment-aware configuration module for the ExitBook platform.

This module provides a centralized and validated source of configuration for all applications within the monorepo. It is designed to be the **single source of truth** for all environment-dependent variables, ensuring that applications start only with a complete and valid configuration, thus preventing a wide class of runtime errors.

## Core Concepts

The design of this module is guided by several key principles:

1.  **Type-Safety First:** Configuration is not just a collection of strings. This module uses **Zod** to define a strong schema, transforming raw environment variables into a fully-typed `Configuration` object that can be safely used throughout the application with full IntelliSense support.

2.  **Fail-Fast Validation:** Configuration errors should be detected at startup, not in the middle of a request. This module uses **`neverthrow`** to provide a `Result` from its validation function. At startup, the module will `unwrap` this result, causing the application to crash immediately with a clear, detailed error message if the configuration is invalid.

3.  **Separation of Concerns:** Simple key-value pairs (like a port or database URL) belong in `.env` files. Complex, nested objects (like provider settings) are difficult to manage as environment variables. This module supports loading complex configurations from dedicated `.json` files, keeping your `.env` clean and readable.

4.  **Flexible & Environment-Aware:** The module automatically loads the correct configuration files based on the current `NODE_ENV`, and supports local developer overrides without requiring changes to committed files.

## Features

- ✅ **Strongly-Typed:** Guarantees that all configuration values have the correct type at runtime.
- ✅ **Zod-Powered Schema:** A single, readable schema (`config.schema.ts`) acts as the source of truth for all configuration variables.
- ✅ **Fail-Fast Startup:** The application will not start if any required configuration is missing or malformed.
- ✅ **Cascading File Strategy:** Intelligently loads configuration from multiple sources, allowing for easy environment-specific and local overrides.
- ✅ **Centralized & Global:** Provided as a global NestJS module, making the validated configuration available anywhere via dependency injection.

## Installation & Setup

This module is intended for internal use within the ExitBook monorepo. To use it in a NestJS application (e.g., `api` or `cli`), import `TypedConfigModule`.

**File: `apps/api/src/app.module.ts`**

```typescript
import { TypedConfigModule } from '@exitbook/shared-config';
import { LoggerModule } from '@exitbook/shared-logger';
import { Module } from '@nestjs/common';
// ... other modules

@Module({
  imports: [
    // Import TypedConfigModule at the top. It is global and handles
    // the underlying NestJS ConfigModule setup for you.
    TypedConfigModule,

    // Other modules can now safely assume that configuration is loaded and valid.
    LoggerModule.forRoot({ serviceName: 'exitbook-api' }),
    // ...
  ],
})
export class AppModule {}
```

## Configuration Loading Strategy

The module loads configuration from multiple sources in a cascading order of precedence. This allows for a flexible setup with defaults, environment-specific settings, and local developer overrides.

The configuration is loaded from the following files in order (the first one found is used):

1.  **Explicit Path:** The file path specified in the `PROVIDERS_CONFIG_PATH` environment variable. This is the ultimate override, useful for specific deployment scenarios.

    ```env
    PROVIDERS_CONFIG_PATH=./config/custom-staging-providers.json
    ```

2.  **Local Override:** `config/providers.local.json`. This file is intended for developer-specific overrides and **should be added to `.gitignore`**. It allows you to test changes locally without affecting the rest of the team.

3.  **Environment-Specific Config:** `config/providers.${NODE_ENV}.json`. For example, if `NODE_ENV=staging`, it will look for `config/providers.staging.json`. This is the standard way to manage differences between environments.

4.  **Default Config:** `config/providers.json`. This is the base configuration file that should be committed to the repository and contain the default settings for the application.

All key-value pairs from the `.env` file are loaded and merged with the contents of the loaded JSON file.

## Usage

Once the `TypedConfigModule` is imported, you can inject the validated and typed configuration object anywhere in your application using a custom injection token.

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { Configuration } from '@exitbook/shared-config';
import { LoggerService } from '@exitbook/shared-logger';

@Injectable()
export class DatabaseService {
  private readonly poolSize: number;

  constructor(
    @Inject('TYPED_CONFIG') private readonly config: Configuration,
    private readonly logger: LoggerService
  ) {
    // The 'config' object is fully typed and validated.
    this.poolSize = this.config.DATABASE_POOL_SIZE;

    this.logger.log(`Database pool size set to: ${this.poolSize}`, 'DatabaseService');
  }

  connect() {
    // You can safely use any property from the config object.
    const dbUrl = this.config.DATABASE_URL;
    // ... connection logic
  }
}
```

## Adding New Configuration Variables

To add a new configuration variable, follow these steps:

1.  **Update the Schema:** Add the new property and its Zod validation rule to the appropriate schema in `libs/shared/config/src/config.schema.ts`.
2.  **Update Example Files:**
    - If it's a simple key-value pair, add it to the root `.env.example` file.
    - If it's part of a complex object, add it to the `config/providers.json` file.
3.  **Use It:** The new variable will now be validated at startup and available on the injected `Configuration` object.

## Example Files

Here are examples of the configuration files this module uses.

#### **`.env.example`**

(Located at the project root)

```dotenv
# Application Configuration
NODE_ENV=development
PORT=3000

# Database Configuration
DATABASE_URL="postgresql://user:password@localhost:5432/exitbook"
DATABASE_POOL_SIZE=15

# Path to the JSON file containing complex provider configuration.
# This is optional and will default to the cascading lookup strategy if not set.
# PROVIDERS_CONFIG_PATH=./config/providers.json
```

#### **`config/providers.json`**

(Located in a `config` directory at the project root)

```json
{
  "providers": {
    "bitcoin": {
      "enabled": true,
      "providers": ["mempool.space"],
      "priority": ["mempool.space"]
    },
    "ethereum": {
      "enabled": true,
      "providers": ["etherscan", "alchemy"],
      "priority": ["alchemy", "etherscan"]
    }
  }
}
```
