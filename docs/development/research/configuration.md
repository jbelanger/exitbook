# Provider Configuration and Setup Guide

> **📋 Open Source Notice**  
> This guide covers configuring the Universal Blockchain Provider Architecture.
> The core system is open source, but some third-party APIs mentioned require
> paid subscriptions. Always verify provider pricing and terms before production
> deployment.

## Quick Start

### 1. Basic Configuration Structure

The provider system extends your existing `config/exchanges.json` with
multi-provider support:

```json
{
  "bitcoin": {
    "enabled": true,
    "adapterType": "blockchain",
    "options": {
      "blockchain": "bitcoin",
      "providers": [
        {
          "name": "mempool.space",
          "priority": 1,
          "enabled": true,
          "rateLimit": {
            "requestsPerSecond": 0.25
          }
        }
      ]
    }
  }
}
```

### 2. Environment Variables

Create a `.env` file in your project root:

```bash
# Bitcoin providers (mempool.space is free, others may require keys)
# BLOCKCYPHER_API_KEY=your_blockcypher_token

# Ethereum providers
ETHERSCAN_API_KEY=your_etherscan_api_key
# ALCHEMY_API_KEY=your_alchemy_api_key
# MORALIS_API_KEY=your_moralis_api_key

# Injective providers (current indexer is free)
# COSMOS_RPC_URL=your_cosmos_rpc_endpoint
```

### 3. Install and Test

```bash
# Install dependencies
pnpm install

# Test provider connections
pnpm run test:providers

# Run with provider architecture
pnpm run import --verify
```

## Complete Configuration Reference

### Provider Configuration Schema

Each provider in the `providers` array supports these options:

```typescript
interface ProviderConfig {
  name: string; // Unique provider identifier
  priority: number; // 1 = highest priority (try first)
  enabled: boolean; // Enable/disable without removing config

  // API Configuration
  apiKey?: string; // API key (use "env:VAR_NAME" format)
  baseUrl?: string; // Custom API endpoint
  rateLimit: RateLimitConfig; // Rate limiting configuration

  // Advanced Options
  timeout?: number; // Request timeout in milliseconds
  retries?: number; // Retry attempts for failed requests
  circuitBreaker?: CircuitBreakerConfig; // Custom circuit breaker settings

  // Provider-specific options
  options?: Record<string, any>; // Provider-specific configuration
}
```

### Rate Limit Configuration

```typescript
interface RateLimitConfig {
  requestsPerSecond: number; // Maximum requests per second
  burstLimit?: number; // Allow bursts up to this limit
  backoffMs?: number; // Backoff time when rate limited
}
```

### Circuit Breaker Configuration

```typescript
interface CircuitBreakerConfig {
  maxFailures: number; // Failures before opening circuit (default: 3)
  timeoutMs: number; // Recovery timeout in milliseconds (default: 5 minutes)
  enabled: boolean; // Enable/disable circuit breaker (default: true)
}
```

## Blockchain-Specific Setup

### Bitcoin Configuration

#### Free Providers

```json
{
  "bitcoin": {
    "enabled": true,
    "adapterType": "blockchain",
    "options": {
      "blockchain": "bitcoin",
      "providers": [
        {
          "name": "mempool.space",
          "priority": 1,
          "enabled": true,
          "rateLimit": { "requestsPerSecond": 0.25 },
          "baseUrl": "https://mempool.space"
        },
        {
          "name": "blockstream.info",
          "priority": 2,
          "enabled": true,
          "rateLimit": { "requestsPerSecond": 1.0 },
          "baseUrl": "https://blockstream.info"
        }
      ]
    }
  }
}
```

#### With Paid API Keys

```json
{
  "name": "blockcypher",
  "priority": 3,
  "enabled": true,
  "apiKey": "env:BLOCKCYPHER_API_KEY",
  "rateLimit": { "requestsPerSecond": 3.0 },
  "baseUrl": "https://api.blockcypher.com/v1/btc/main"
}
```

### Ethereum Configuration

#### Basic Setup with Etherscan

```json
{
  "ethereum": {
    "enabled": true,
    "adapterType": "blockchain",
    "options": {
      "blockchain": "ethereum",
      "providers": [
        {
          "name": "etherscan",
          "priority": 1,
          "enabled": true,
          "apiKey": "env:ETHERSCAN_API_KEY",
          "rateLimit": { "requestsPerSecond": 1.0 },
          "baseUrl": "https://api.etherscan.io/api"
        }
      ]
    }
  }
}
```

#### Multi-Provider Ethereum Setup

```json
{
  "providers": [
    {
      "name": "etherscan",
      "priority": 1,
      "enabled": true,
      "apiKey": "env:ETHERSCAN_API_KEY",
      "rateLimit": { "requestsPerSecond": 1.0 }
    },
    {
      "name": "alchemy",
      "priority": 2,
      "enabled": true,
      "apiKey": "env:ALCHEMY_API_KEY",
      "rateLimit": { "requestsPerSecond": 5.0 }
    },
    {
      "name": "moralis",
      "priority": 3,
      "enabled": true,
      "apiKey": "env:MORALIS_API_KEY",
      "rateLimit": { "requestsPerSecond": 10.0 }
    }
  ]
}
```

### Injective Configuration

```json
{
  "injective": {
    "enabled": true,
    "adapterType": "blockchain",
    "options": {
      "blockchain": "injective",
      "providers": [
        {
          "name": "injective-indexer",
          "priority": 1,
          "enabled": true,
          "rateLimit": { "requestsPerSecond": 2.0 },
          "baseUrl": "https://k8s.mainnet.lcd.injective.network"
        },
        {
          "name": "cosmos-api",
          "priority": 2,
          "enabled": true,
          "rateLimit": { "requestsPerSecond": 1.0 },
          "baseUrl": "https://cosmos.api.injective.network"
        }
      ]
    }
  }
}
```

## Environment Variable Management

### Using Environment Variables

Reference environment variables in configuration using the `env:` prefix:

```json
{
  "apiKey": "env:ETHERSCAN_API_KEY",
  "baseUrl": "env:CUSTOM_ETHEREUM_RPC_URL"
}
```

### Environment Variable Validation

The system validates environment variables at startup:

```typescript
// Automatic validation
if (config.apiKey?.startsWith('env:')) {
  const envVar = config.apiKey.replace('env:', '');
  const value = process.env[envVar];

  if (!value) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}
```

### Development vs Production

#### Development (`.env.development`)

```bash
# Use free tiers and test networks
ETHERSCAN_API_KEY=free_tier_key
BITCOIN_NETWORK=testnet
```

#### Production (`.env.production`)

```bash
# Use paid tiers for reliability
ETHERSCAN_API_KEY=paid_tier_key
ALCHEMY_API_KEY=production_key
BITCOIN_NETWORK=mainnet
```

## Advanced Configuration

### Custom Circuit Breaker Settings

```json
{
  "name": "high-reliability-provider",
  "priority": 1,
  "circuitBreaker": {
    "maxFailures": 5, // Allow more failures before opening
    "timeoutMs": 120000, // 2 minute recovery timeout
    "enabled": true
  }
}
```

### Provider Health Check Configuration

```json
{
  "name": "custom-provider",
  "healthCheck": {
    "intervalMs": 30000, // Check every 30 seconds
    "timeoutMs": 5000, // 5 second timeout for health checks
    "endpoint": "/health" // Custom health check endpoint
  }
}
```

### Request Caching Configuration

```json
{
  "name": "cached-provider",
  "caching": {
    "enabled": true,
    "ttlMs": 60000, // 1 minute cache TTL
    "maxEntries": 1000 // Maximum cached entries
  }
}
```

## Provider-Specific Setup Guides

### BlockCypher Setup

1. **Sign up**: Visit [blockcypher.com](https://www.blockcypher.com/)
2. **Get API key**: Create account and generate token
3. **Configure**:

```json
{
  "name": "blockcypher",
  "apiKey": "env:BLOCKCYPHER_API_KEY",
  "rateLimit": { "requestsPerSecond": 3.0 },
  "options": {
    "network": "main", // or "test3" for testnet
    "includeUnconfirmed": false
  }
}
```

4. **Set environment**: `BLOCKCYPHER_API_KEY=your_token_here`

### Alchemy Setup

1. **Sign up**: Visit [alchemy.com](https://www.alchemy.com/)
2. **Create app**: Select Ethereum mainnet
3. **Configure**:

```json
{
  "name": "alchemy",
  "apiKey": "env:ALCHEMY_API_KEY",
  "rateLimit": { "requestsPerSecond": 5.0 },
  "options": {
    "network": "eth-mainnet",
    "webhookEnabled": false
  }
}
```

4. **Set environment**: `ALCHEMY_API_KEY=your_api_key_here`

### Moralis Setup

1. **Sign up**: Visit [moralis.io](https://moralis.io/)
2. **Get API key**: From dashboard
3. **Configure**:

```json
{
  "name": "moralis",
  "apiKey": "env:MORALIS_API_KEY",
  "rateLimit": { "requestsPerSecond": 10.0 },
  "options": {
    "chain": "eth",
    "format": "decimal"
  }
}
```

4. **Set environment**: `MORALIS_API_KEY=your_api_key_here`

## Testing Configuration

### Test Individual Providers

```bash
# Test specific provider
pnpm run test:provider bitcoin mempool.space

# Test all providers for a blockchain
pnpm run test:providers bitcoin

# Test all providers across all blockchains
pnpm run test:providers
```

### Validation Commands

```bash
# Validate configuration file
pnpm run validate:config

# Check environment variables
pnpm run check:env

# Test provider connections
pnpm run test:connections
```

### Health Check Endpoints

Access real-time provider health:

```bash
# Get health status
curl http://localhost:3000/api/health/providers

# Get health for specific blockchain
curl http://localhost:3000/api/health/providers/bitcoin

# Get circuit breaker status
curl http://localhost:3000/api/health/circuit-breakers
```

## Troubleshooting Configuration

### Common Issues

#### 1. Missing Environment Variables

```
Error: Missing required environment variable: ETHERSCAN_API_KEY
```

**Solution**: Add the variable to your `.env` file

#### 2. Invalid API Keys

```
Error: Authentication failed for provider 'etherscan'
```

**Solution**: Verify API key is correct and has required permissions

#### 3. Rate Limit Exceeded

```
Error: Rate limit exceeded for provider 'etherscan'
```

**Solution**: Reduce `requestsPerSecond` or upgrade API plan

#### 4. Provider Connection Failed

```
Error: Connection failed for provider 'custom-provider'
```

**Solution**: Check `baseUrl` and network connectivity

### Configuration Validation

The system performs automatic validation on startup:

```typescript
// Example validation output
Provider Configuration Validation:
✅ bitcoin/mempool.space: Connected successfully
✅ bitcoin/blockstream.info: Connected successfully
❌ bitcoin/blockcypher: Missing API key (BLOCKCYPHER_API_KEY)
✅ ethereum/etherscan: Connected successfully
⚠️  ethereum/alchemy: Rate limit detected, using conservative settings
```

### Debug Mode

Enable detailed logging for troubleshooting:

```bash
# Enable debug logging
DEBUG=provider:* pnpm run import

# Enable circuit breaker logging
DEBUG=circuit-breaker:* pnpm run import

# Enable all provider debugging
DEBUG=provider:*,circuit-breaker:*,cache:* pnpm run import
```

## Performance Tuning

### Rate Limit Optimization

```json
{
  "rateLimit": {
    "requestsPerSecond": 2.0, // Conservative baseline
    "burstLimit": 10, // Allow occasional bursts
    "backoffMs": 1000 // Wait 1s when rate limited
  }
}
```

### Priority Optimization

```json
{
  "providers": [
    {
      "name": "fast-paid-provider",
      "priority": 1, // Try first - fastest
      "rateLimit": { "requestsPerSecond": 10.0 }
    },
    {
      "name": "reliable-free-provider",
      "priority": 2, // Fallback - reliable
      "rateLimit": { "requestsPerSecond": 1.0 }
    },
    {
      "name": "backup-provider",
      "priority": 3, // Last resort
      "rateLimit": { "requestsPerSecond": 0.5 }
    }
  ]
}
```

### Cache Tuning

```json
{
  "caching": {
    "ttlMs": 30000, // 30 second cache for balance queries
    "maxEntries": 500, // Limit memory usage
    "enabled": true
  }
}
```

## Migration Guide

### From Single Provider to Multi-Provider

#### Step 1: Current Configuration

```json
{
  "bitcoin": {
    "enabled": true,
    "adapterType": "blockchain",
    "options": {
      "baseUrl": "https://mempool.space"
    }
  }
}
```

#### Step 2: Add Provider Structure

```json
{
  "bitcoin": {
    "enabled": true,
    "adapterType": "blockchain",
    "options": {
      "blockchain": "bitcoin",
      "providers": [
        {
          "name": "mempool.space",
          "priority": 1,
          "enabled": true,
          "baseUrl": "https://mempool.space",
          "rateLimit": { "requestsPerSecond": 0.25 }
        }
      ]
    }
  }
}
```

#### Step 3: Add Backup Providers

```json
{
  "providers": [
    {
      "name": "mempool.space",
      "priority": 1,
      "enabled": true,
      "rateLimit": { "requestsPerSecond": 0.25 }
    },
    {
      "name": "blockstream.info",
      "priority": 2,
      "enabled": true,
      "rateLimit": { "requestsPerSecond": 1.0 }
    }
  ]
}
```

### Gradual Rollout

1. **Week 1**: Deploy with existing provider as priority 1, new providers
   disabled
2. **Week 2**: Enable backup providers for testing
3. **Week 3**: Monitor failover events and performance
4. **Week 4**: Optimize priority and rate limits based on real data

## Security Considerations

### API Key Protection

```bash
# ✅ Good: Use environment variables
ETHERSCAN_API_KEY=your_secret_key

# ❌ Bad: Never commit keys to git
# "apiKey": "your_secret_key_here"
```

### Rate Limit Safety

```json
{
  "rateLimit": {
    "requestsPerSecond": 0.8, // 20% below provider limit
    "burstLimit": 3, // Conservative burst allowance
    "backoffMs": 2000 // Generous backoff time
  }
}
```

### Network Security

```json
{
  "options": {
    "timeout": 10000, // 10 second timeout
    "retries": 2, // Limited retry attempts
    "userAgent": "YourApp/1.0" // Identify your application
  }
}
```
