# Provider Configuration and Setup Guide

## 1. Overview

This guide provides a comprehensive walkthrough for configuring the Universal Blockchain Provider Architecture. The system is designed to work out-of-the-box with zero configuration by auto-discovering all registered providers. However, for production use, this configuration file allows you to precisely control which providers are used, set their priorities, and manage their settings.

## 2. Quick Start

### A. The Configuration File

All provider configuration is managed in a single file:

**File Location:** `packages/import/config/blockchain-explorers.json`

If this file does not exist, the system will automatically use all registered providers with their default settings. To customize, create the file with the following structure.

#### Basic Configuration Structure:

```json
{
  "bitcoin": {
    "defaultEnabled": ["mempool.space", "blockstream.info"],
    "overrides": {
      "mempool.space": {
        "priority": 1
      },
      "blockstream.info": {
        "priority": 2
      }
    }
  },
  "ethereum": {
    "defaultEnabled": ["alchemy", "moralis"],
    "overrides": {
      "alchemy": {
        "priority": 1,
        "rateLimit": {
          "requestsPerSecond": 10
        }
      }
    }
  }
}
```

### B. Environment Variables for API Keys

Create a `.env` file in the **root of the monorepo**. The system uses `dotenv` to load these variables.

```env
# Root .env file

# --- BITCOIN PROVIDERS ---
# mempool.space, blockstream.info, and blockchain.com are free.
# BLOCKCYPHER_API_KEY=your_blockcypher_api_key
# TATUM_API_KEY=your_tatum_api_key

# --- ETHEREUM & EVM PROVIDERS ---
ALCHEMY_API_KEY=your_alchemy_api_key
# MORALIS_API_KEY=your_moralis_api_key
# SNOWTRACE_API_KEY=your_snowtrace_api_key (for Avalanche)

# --- OTHER BLOCKCHAINS ---
# TAOSTATS_API_KEY=your_taostats_api_key (for Bittensor)
# HELIUS_API_KEY=your_helius_api_key (for Solana)
```

**Note:** To find the correct environment variable name for any provider, run `pnpm --filter @crypto/import run providers:list`.

### C. Verify Your Setup

Use the built-in CLI tools to validate your configuration.

```bash
# 1. Check that all registered providers are listed in your config
pnpm --filter @crypto/import run providers:sync

# 2. Validate the config file for typos and correctness
pnpm --filter @crypto/import run config:validate
```

## 3. Configuration Schema Explained

The `blockchain-explorers.json` file has a simple but powerful structure.

| Key | Type | Description |
|---|---|---|
| **`<blockchain>`** | `object` | A top-level key for each blockchain (e.g., "bitcoin", "ethereum"). |
| ┝ **`defaultEnabled`** | `string[]` | **Required.** An array of provider `name` strings. Only providers listed here will be used for this blockchain. The order in this array does **not** determine priority. |
| ┝ **`overrides`** | `object` | Optional. An object where you can customize the settings for any provider listed in `defaultEnabled`. The keys of this object must be the provider `name`. |
| &nbsp;&nbsp; ┝ `priority` | `number` | Optional. Sets the failover priority. **Lower numbers are tried first** (e.g., priority 1 is tried before priority 2). If omitted, priority is based on the order in `defaultEnabled`. |
| &nbsp;&nbsp; ┝ `enabled` | `boolean` | Optional. Explicitly set to `false` to disable a provider, even if it's listed in `defaultEnabled`. |
| &nbsp;&nbsp; ┝ `timeout` | `number` | Optional. Overrides the provider's default request timeout in milliseconds. |
| &nbsp;&nbsp; ┝ `retries` | `number` | Optional. Overrides the provider's default number of retry attempts. |
| &nbsp;&nbsp; ┝ `rateLimit` | `object` | Optional. Overrides the provider's default rate limit settings. You can override `requestsPerSecond`, `burstLimit`, etc. |

## 4. Blockchain-Specific Examples

### Bitcoin: High-Reliability Setup

This configuration prioritizes `mempool.space` but will automatically fail over to `blockstream.info` if it's down. `tatum` is registered but will not be used because it is not in `defaultEnabled`.

```json
{
  "bitcoin": {
    "defaultEnabled": ["mempool.space", "blockstream.info", "blockcypher"],
    "overrides": {
      "mempool.space": {
        "priority": 1
      },
      "blockstream.info": {
        "priority": 2
      },
      "blockcypher": {
        "priority": 3,
        "enabled": true // Requires BLOCKCYPHER_API_KEY in .env
      }
    }
  }
}
```

### Ethereum: Performance-Tiered Setup

This setup prioritizes a paid provider (`alchemy`) for performance and uses a free-tier provider (`moralis`) as a backup.

```json
{
  "ethereum": {
    "defaultEnabled": ["alchemy", "moralis"],
    "overrides": {
      "alchemy": {
        "priority": 1,
        "rateLimit": { "requestsPerSecond": 10 } // Custom rate limit for a paid plan
      },
      "moralis": {
        "priority": 2
      }
    }
  }
}
```

### Solana: Single Preferred Provider

This configuration forces the system to *only* use Helius for Solana, ignoring any other registered Solana providers.

```json
{
  "solana": {
    "defaultEnabled": ["helius"],
    "overrides": {}
  }
}
```

## 5. Environment Variable Management

The system **never** stores secret API keys directly in the configuration file. It uses a reference-by-name convention.

*   **How it Works:** The `ProviderRegistry` holds the recommended environment variable name for each provider (e.g., `ALCHEMY_API_KEY`). The `BaseRegistryProvider` class automatically reads `process.env[apiKeyEnvVar]` during initialization. You do not need to specify `env:VAR_NAME` in the JSON file.
*   **Validation:** If a provider is enabled and its `requiresApiKey` flag is `true`, the system will throw an error at startup if the corresponding environment variable is not set.

## 6. Command-Line Tools for Configuration

The `packages/import` package contains several scripts to help you manage and validate your setup.

### `pnpm run providers:list`
Lists all providers that have been registered via the `@RegisterApiClient` decorator. Use this to find the correct `name` for your configuration file.

**Example Output:**
```
📋 polkadot
──────────────────────────────────────────────────
  ✓ subscan
    Name: Polkadot Networks Provider
    API Key Required: No
    ...

📋 bittensor
──────────────────────────────────────────────────
  ✓ taostats
    Name: Bittensor Network Provider
    API Key Required: Yes
    Environment Variable: TAOSTATS_API_KEY
    ...
```

### `pnpm run providers:sync --fix`
Compares the registered providers with your `blockchain-explorers.json` file. The `--fix` flag automatically adds any missing (but registered) providers to the `defaultEnabled` array for their respective blockchain, ensuring your configuration is never stale.

### `pnpm run config:validate`
Validates your `blockchain-explorers.json` file. It checks for:
*   Typos in blockchain or provider names.
*   References to providers that are not registered in the system.
*   Schema correctness.

## 7. Troubleshooting Common Configuration Issues

#### Issue: Provider is not being used, even though it's configured.
*   **Cause 1:** The provider's `name` in `blockchain-explorers.json` has a typo.
    *   **Solution:** Run `pnpm run providers:list` to get the exact name and correct the JSON file.
*   **Cause 2:** The provider requires an API key, but the corresponding environment variable is not set in `.env`. The system will log a warning at startup and skip the provider.
    *   **Solution:** Add the correct environment variable to your root `.env` file.
*   **Cause 3:** The provider's circuit breaker is `OPEN` due to recent failures.
    *   **Solution:** Check the application logs for failure messages. The circuit will reset automatically after 5 minutes. For development, restarting the application will reset the circuit breaker's state.

#### Issue: `Error: Missing required environment variable: ...`
*   **Cause:** A provider with `requiresApiKey: true` is enabled in your configuration, but the environment variable specified in its decorator (`apiKeyEnvVar`) is missing from `.env`.
*   **Solution:** Add the required API key to your root `.env` file or disable the provider in `blockchain-explorers.json` by setting `"enabled": false` in its override or removing it from `defaultEnabled`.

#### Issue: "Provider 'xyz' not found for blockchain 'abc'"
*   **Cause:** The provider's `ApiClient` file has not been imported into the application, so its `@RegisterApiClient` decorator never ran.
*   **Solution:** Ensure the provider's file is imported in the relevant `packages/import/src/blockchains/<chain>/api/index.ts` file.