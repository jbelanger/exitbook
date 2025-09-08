# Troubleshooting Guide: Common Issues and Solutions

> **📋 Open Source Notice**  
> This troubleshooting guide covers common issues with the Universal Blockchain
> Provider Architecture. The core system is open source, but some third-party
> APIs mentioned may require commercial licenses or have service-specific
> limitations.

## Quick Diagnostic Commands

Before diving into specific issues, run these diagnostic commands to get system
status:

```bash
# Check overall provider health
pnpm run status --providers

# Test all provider connections
pnpm run test:providers

# Validate configuration
pnpm run validate:config

# Check environment variables
pnpm run check:env

# Get detailed provider status
DEBUG=provider:* pnpm run import --dry-run
```

## Provider Connection Issues

### Issue: "Provider connection failed"

#### Symptoms

```
Error: Connection failed for provider 'etherscan'
Provider health check: FAILED
Circuit breaker state: OPEN
```

#### Common Causes and Solutions

**Cause 1: Missing or Invalid API Key**

```bash
# Check if environment variable is set
echo $ETHERSCAN_API_KEY

# Verify API key format (should be 34 characters for Etherscan)
echo $ETHERSCAN_API_KEY | wc -c
```

**Solution:**

```bash
# Set the correct API key
export ETHERSCAN_API_KEY=YourValidApiKeyHere

# Or add to .env file
echo "ETHERSCAN_API_KEY=YourValidApiKeyHere" >> .env
```

**Cause 2: Incorrect Base URL**

```json
{
  "name": "etherscan",
  "baseUrl": "https://api.etherscan.io/api/v1" // ❌ Wrong - has /v1
}
```

**Solution:**

```json
{
  "name": "etherscan",
  "baseUrl": "https://api.etherscan.io/api" // ✅ Correct
}
```

**Cause 3: Network/Firewall Issues**

```bash
# Test connectivity manually
curl -s "https://api.etherscan.io/api?module=account&action=balance&address=0x123&apikey=$ETHERSCAN_API_KEY"

# Check if corporate firewall is blocking
ping api.etherscan.io
```

**Solution:**

- Configure corporate proxy settings
- Whitelist blockchain API domains
- Use alternative provider endpoints

### Issue: "All providers failed"

#### Symptoms

```
Error: All providers failed for blockchain 'bitcoin'
Last error: Circuit breaker OPEN for all providers
```

#### Diagnostic Steps

**Step 1: Check Provider Status**

```bash
# Get detailed provider health
node -e "
const manager = require('./src/providers/BlockchainProviderManager');
const health = manager.getProviderHealth('bitcoin');
console.log(JSON.stringify(health, null, 2));
"
```

**Step 2: Check Circuit Breaker Status**

```typescript
// Check circuit breaker states
const circuitBreakers = providerManager.getCircuitBreakerStatus('bitcoin');
for (const [provider, status] of circuitBreakers) {
  console.log(`${provider}: ${status.state} (failures: ${status.failures})`);
}
```

**Step 3: Manual Provider Testing**

```bash
# Test each provider individually
pnpm run test:provider bitcoin mempool.space
pnpm run test:provider bitcoin blockstream.info
pnpm run test:provider bitcoin blockcypher
```

#### Solutions

**Solution 1: Reset Circuit Breakers**

```typescript
// Emergency reset for all providers
const providerManager = new BlockchainProviderManager();
providerManager.resetAllCircuitBreakers('bitcoin');
```

**Solution 2: Temporary Provider Disable/Enable**

```json
{
  "providers": [
    {
      "name": "mempool.space",
      "enabled": false, // Temporarily disable problematic provider
      "priority": 1
    },
    {
      "name": "blockstream.info",
      "enabled": true, // Keep working provider enabled
      "priority": 1 // Promote to primary
    }
  ]
}
```

**Solution 3: Add Emergency Backup Provider**

```json
{
  "name": "emergency-backup",
  "priority": 999,
  "enabled": true,
  "baseUrl": "https://backup-api.example.com",
  "rateLimit": { "requestsPerSecond": 0.1 }
}
```

## Rate Limiting Issues

### Issue: "Rate limit exceeded"

#### Symptoms

```
Error: Rate limit exceeded for provider 'etherscan'
HTTP 429: Too Many Requests
Retry-After: 300 seconds
```

#### Understanding Rate Limits

Common API rate limits:

- **Etherscan Free**: 1 req/5 seconds (0.2 req/sec)
- **Etherscan Pro**: 5 req/second
- **mempool.space**: 1 req/4 seconds (0.25 req/sec)
- **BlockCypher Free**: 3 req/second, 200 req/hour

#### Solutions

**Solution 1: Reduce Request Rate**

```json
{
  "name": "etherscan",
  "rateLimit": {
    "requestsPerSecond": 0.15, // 25% below actual limit for safety
    "burstLimit": 1, // No bursts on free tier
    "backoffMs": 6000 // 6 second backoff
  }
}
```

**Solution 2: Upgrade API Plan**

```bash
# Check current usage
curl -s "https://api.etherscan.io/api?module=stats&action=tokensupply&contractaddress=0x123&apikey=$ETHERSCAN_API_KEY"

# Response includes rate limit headers:
# X-RateLimit-Remaining: 2
# X-RateLimit-Reset: 1640995200
```

**Solution 3: Implement Request Queuing**

```typescript
class QueuedProvider extends BaseProvider {
  private requestQueue: Array<() => Promise<any>> = [];
  private processing = false;

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await super.execute(operation);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.requestQueue.length === 0) return;

    this.processing = true;
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift()!;
      await request();
      await this.delay(1000 / this.rateLimit.requestsPerSecond);
    }
    this.processing = false;
  }
}
```

### Issue: "Rate limit headers not respected"

#### Symptoms

```
Provider continues making requests despite 429 responses
Rate limiting backoff not working properly
```

#### Solution: Enhanced Rate Limit Detection

```typescript
class SmartRateLimitProvider extends BaseProvider {
  private async makeRequest(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    const response = await fetch(url, options);

    // Check multiple rate limit indicators
    if (this.isRateLimited(response)) {
      const retryAfter = this.getRetryAfter(response);
      await this.delay(retryAfter * 1000);
      return this.makeRequest(url, options); // Retry after delay
    }

    return response;
  }

  private isRateLimited(response: Response): boolean {
    // Check HTTP status
    if (response.status === 429) return true;

    // Check rate limit headers
    const remaining = response.headers.get('X-RateLimit-Remaining');
    if (remaining && parseInt(remaining) === 0) return true;

    // Check provider-specific indicators
    const resetTime = response.headers.get('X-RateLimit-Reset');
    if (resetTime && parseInt(resetTime) > Date.now() / 1000) return true;

    return false;
  }

  private getRetryAfter(response: Response): number {
    // Standard Retry-After header
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) return parseInt(retryAfter);

    // Rate limit reset time
    const resetTime = response.headers.get('X-RateLimit-Reset');
    if (resetTime) {
      const resetTimestamp = parseInt(resetTime);
      const currentTime = Math.floor(Date.now() / 1000);
      return Math.max(0, resetTimestamp - currentTime);
    }

    // Default backoff
    return 60;
  }
}
```

## Authentication Issues

### Issue: "Invalid API key"

#### Symptoms

```
Error: Authentication failed for provider 'blockcypher'
HTTP 401: Unauthorized
Invalid API key format
```

#### Diagnostic Steps

**Step 1: Verify API Key Format**

```bash
# Different providers have different key formats
echo "Etherscan key length: $(echo $ETHERSCAN_API_KEY | wc -c)"      # Should be 35 (34 + newline)
echo "Alchemy key format: $(echo $ALCHEMY_API_KEY | cut -c1-8)"       # Should start with specific prefix
echo "Moralis key format: $(echo $MORALIS_API_KEY | grep -E '^[A-Za-z0-9]{64}$')" # Should be 64 alphanumeric
```

**Step 2: Test API Key Manually**

```bash
# Test Etherscan key
curl -s "https://api.etherscan.io/api?module=account&action=balance&address=0x123&apikey=$ETHERSCAN_API_KEY" | jq .

# Test Alchemy key
curl -s -X POST "https://eth-mainnet.alchemyapi.io/v2/$ALCHEMY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

**Step 3: Check Key Permissions**

```bash
# Some APIs require specific permissions
curl -s "https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=0x123&address=0x456&tag=latest&apikey=$ETHERSCAN_API_KEY"
```

#### Solutions

**Solution 1: Regenerate API Keys**

1. Log into provider dashboard
2. Revoke old API key
3. Generate new API key
4. Update environment variables
5. Test new key

**Solution 2: Configure Key Rotation**

```typescript
class RotatingKeyProvider extends BaseProvider {
  private apiKeys: string[];
  private currentKeyIndex = 0;

  constructor(config: { apiKeys: string[] }) {
    this.apiKeys = config.apiKeys;
  }

  private getCurrentApiKey(): string {
    return this.apiKeys[this.currentKeyIndex];
  }

  private rotateApiKey(): void {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    console.log(
      `Rotated to API key ${this.currentKeyIndex + 1}/${this.apiKeys.length}`,
    );
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    try {
      return await super.execute(operation);
    } catch (error) {
      if (error instanceof AuthenticationError && this.apiKeys.length > 1) {
        this.rotateApiKey();
        return await super.execute(operation); // Retry with new key
      }
      throw error;
    }
  }
}
```

### Issue: "API key quota exceeded"

#### Symptoms

```
Error: Monthly quota exceeded for API key
HTTP 403: Forbidden
Upgrade your plan message
```

#### Solutions

**Solution 1: Monitor Usage**

```typescript
class QuotaAwareProvider extends BaseProvider {
  private requestCount = 0;
  private dailyLimit: number;

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    if (this.requestCount >= this.dailyLimit * 0.9) {
      console.warn(
        `Approaching daily limit: ${this.requestCount}/${this.dailyLimit}`,
      );
    }

    const result = await super.execute(operation);
    this.requestCount++;

    return result;
  }

  resetDailyCount(): void {
    this.requestCount = 0;
  }
}

// Reset daily count at midnight
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    provider.resetDailyCount();
  }
}, 60000);
```

**Solution 2: Implement Usage-Based Fallback**

```json
{
  "providers": [
    {
      "name": "etherscan-premium",
      "priority": 1,
      "apiKey": "env:ETHERSCAN_PREMIUM_KEY",
      "dailyLimit": 100000
    },
    {
      "name": "etherscan-free",
      "priority": 2,
      "apiKey": "env:ETHERSCAN_FREE_KEY",
      "dailyLimit": 10000
    },
    {
      "name": "alchemy-backup",
      "priority": 3,
      "apiKey": "env:ALCHEMY_API_KEY",
      "dailyLimit": 300
    }
  ]
}
```

## Data Consistency Issues

### Issue: "Transaction data mismatch between providers"

#### Symptoms

```
Provider A returns: { value: "1.5", timestamp: 1640995200 }
Provider B returns: { value: "1500000000000000000", timestamp: 1640995200000 }
Inconsistent decimal places and timestamp formats
```

#### Solution: Standardized Data Transformation

```typescript
class StandardizedProvider extends BaseProvider {
  protected normalizeAmount(
    amount: string | number,
    decimals: number = 18,
  ): string {
    if (typeof amount === 'number') {
      amount = amount.toString();
    }

    // Handle different input formats
    if (amount.includes('.')) {
      // Already in decimal format (e.g., "1.5")
      return new Decimal(amount).toFixed();
    } else {
      // Wei/smallest unit format (e.g., "1500000000000000000")
      return new Decimal(amount).div(new Decimal(10).pow(decimals)).toFixed();
    }
  }

  protected normalizeTimestamp(timestamp: string | number): number {
    const ts = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp;

    // Convert milliseconds to seconds if needed
    if (ts > 1e12) {
      return Math.floor(ts / 1000);
    }

    return ts;
  }

  protected normalizeAddress(address: string): string {
    // Ensure consistent address format
    return address.toLowerCase().trim();
  }

  protected normalizeStatus(status: any): 'confirmed' | 'failed' | 'pending' {
    if (typeof status === 'boolean') {
      return status ? 'confirmed' : 'failed';
    }

    if (typeof status === 'number') {
      return status === 1 ? 'confirmed' : 'failed';
    }

    if (typeof status === 'string') {
      const normalized = status.toLowerCase();
      if (['success', 'confirmed', 'mined', '1', 'true'].includes(normalized)) {
        return 'confirmed';
      }
      if (['failed', 'error', 'reverted', '0', 'false'].includes(normalized)) {
        return 'failed';
      }
    }

    return 'pending';
  }
}
```

### Issue: "Missing transactions from some providers"

#### Symptoms

```
Provider A: 15 transactions found
Provider B: 12 transactions found
Provider C: 18 transactions found
```

#### Diagnostic Steps

**Step 1: Compare Transaction Lists**

```typescript
async function compareProviders(address: string) {
  const providers = ['mempool.space', 'blockstream.info', 'blockcypher'];
  const results = new Map<string, any[]>();

  for (const provider of providers) {
    try {
      const txs = await getTransactions(provider, address);
      results.set(provider, txs);
      console.log(`${provider}: ${txs.length} transactions`);
    } catch (error) {
      console.error(`${provider} failed: ${error.message}`);
    }
  }

  // Find unique transaction hashes across all providers
  const allHashes = new Set<string>();
  for (const txs of results.values()) {
    txs.forEach((tx) => allHashes.add(tx.hash));
  }

  console.log(`Total unique transactions: ${allHashes.size}`);

  // Check which transactions are missing from each provider
  for (const [provider, txs] of results) {
    const hashes = new Set(txs.map((tx) => tx.hash));
    const missing = Array.from(allHashes).filter((hash) => !hashes.has(hash));
    if (missing.length > 0) {
      console.log(
        `${provider} missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`,
      );
    }
  }
}
```

**Step 2: Check Provider Capabilities**

```typescript
// Verify each provider supports the required operation type
for (const provider of providers) {
  const capabilities = provider.capabilities;
  console.log(`${provider.name}:`);
  console.log(`  Historical data: ${capabilities.providesHistoricalData}`);
  console.log(`  Pagination: ${capabilities.supportsPagination}`);
  console.log(
    `  Lookback days: ${capabilities.maxLookbackDays || 'unlimited'}`,
  );
}
```

#### Solutions

**Solution 1: Implement Transaction Merging**

```typescript
class MergingProviderManager extends BlockchainProviderManager {
  async getAllTransactions(
    blockchain: string,
    address: string,
  ): Promise<BlockchainTransaction[]> {
    const providers = this.getProviders(blockchain);
    const allTransactions = new Map<string, BlockchainTransaction>();

    // Collect transactions from all healthy providers
    for (const provider of providers) {
      if (this.getCircuitBreaker(provider.name).isOpen()) {
        continue;
      }

      try {
        const txs = await provider.execute({
          type: 'getAddressTransactions',
          params: { address },
        });

        // Merge transactions, preferring more detailed data
        for (const tx of txs) {
          const existing = allTransactions.get(tx.hash);
          if (!existing || this.isMoreDetailed(tx, existing)) {
            allTransactions.set(tx.hash, tx);
          }
        }
      } catch (error) {
        console.warn(`Provider ${provider.name} failed: ${error.message}`);
      }
    }

    return Array.from(allTransactions.values()).sort(
      (a, b) => b.timestamp - a.timestamp,
    );
  }

  private isMoreDetailed(
    tx1: BlockchainTransaction,
    tx2: BlockchainTransaction,
  ): boolean {
    // Prefer transaction with more complete data
    const score1 = this.getDetailScore(tx1);
    const score2 = this.getDetailScore(tx2);
    return score1 > score2;
  }

  private getDetailScore(tx: BlockchainTransaction): number {
    let score = 0;
    if (tx.blockNumber) score++;
    if (tx.fee) score++;
    if (tx.gasUsed) score++;
    if (tx.raw && Object.keys(tx.raw).length > 5) score++;
    return score;
  }
}
```

**Solution 2: Provider-Specific Pagination**

```typescript
class PaginationAwareProvider extends BaseProvider {
  async getAllTransactions(address: string): Promise<BlockchainTransaction[]> {
    const allTxs: BlockchainTransaction[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && allTxs.length < 10000) {
      // Safety limit
      const batch = await this.getTransactionPage(address, page);

      if (batch.length === 0) {
        hasMore = false;
      } else {
        allTxs.push(...batch);
        page++;

        // Rate limiting between pages
        await this.delay(this.rateLimit.backoffMs || 1000);
      }
    }

    return allTxs;
  }

  private async getTransactionPage(
    address: string,
    page: number,
  ): Promise<BlockchainTransaction[]> {
    // Provider-specific pagination implementation
    const response = await this.makeRequest({
      endpoint: '/transactions',
      params: { address, page, limit: 50 },
    });

    return response.data.map((tx) => this.transformTransaction(tx));
  }
}
```

## Performance Issues

### Issue: "Slow response times"

#### Symptoms

```
Average response time: 15 seconds
Request timeouts increasing
Circuit breakers opening due to timeouts
```

#### Diagnostic Steps

**Step 1: Measure Response Times**

```typescript
class PerformanceMonitoringProvider extends BaseProvider {
  private responseTimes: number[] = [];

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await super.execute(operation);
      const responseTime = Date.now() - startTime;

      this.responseTimes.push(responseTime);
      this.logPerformanceMetrics();

      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      console.error(`Request failed after ${responseTime}ms: ${error.message}`);
      throw error;
    }
  }

  private logPerformanceMetrics(): void {
    const recent = this.responseTimes.slice(-10);
    const average = recent.reduce((a, b) => a + b, 0) / recent.length;
    const max = Math.max(...recent);
    const min = Math.min(...recent);

    console.log(
      `Performance - Avg: ${average.toFixed(0)}ms, Max: ${max}ms, Min: ${min}ms`,
    );
  }
}
```

**Step 2: Identify Bottlenecks**

```typescript
// Check what's taking time
DEBUG=provider:timing pnpm run import

// Profile specific operations
console.time('getAddressTransactions');
const result = await provider.execute(operation);
console.timeEnd('getAddressTransactions');
```

#### Solutions

**Solution 1: Implement Request Concurrency**

```typescript
class ConcurrentProvider extends BaseProvider {
  private maxConcurrency = 3;
  private activeRequests = 0;
  private requestQueue: Array<() => Promise<any>> = [];

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    if (this.activeRequests < this.maxConcurrency) {
      return this.executeImmediately(operation);
    } else {
      return this.enqueueRequest(operation);
    }
  }

  private async executeImmediately<T>(
    operation: ProviderOperation<T>,
  ): Promise<T> {
    this.activeRequests++;
    try {
      return await super.execute(operation);
    } finally {
      this.activeRequests--;
      this.processQueue();
    }
  }

  private enqueueRequest<T>(operation: ProviderOperation<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await this.executeImmediately(operation);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private processQueue(): void {
    if (
      this.requestQueue.length > 0 &&
      this.activeRequests < this.maxConcurrency
    ) {
      const request = this.requestQueue.shift()!;
      request();
    }
  }
}
```

**Solution 2: Implement Response Caching**

```typescript
class CachedProvider extends BaseProvider {
  private cache = new Map<string, { data: any; expiry: number }>();

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    const cacheKey = this.getCacheKey(operation);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      console.log(`Cache hit for ${cacheKey}`);
      return cached.data;
    }

    // Execute request
    const result = await super.execute(operation);

    // Cache result
    this.cache.set(cacheKey, {
      data: result,
      expiry: Date.now() + this.getCacheTTL(operation.type),
    });

    return result;
  }

  private getCacheKey(operation: ProviderOperation<any>): string {
    return `${operation.type}:${JSON.stringify(operation.params)}`;
  }

  private getCacheTTL(operationType: string): number {
    switch (operationType) {
      case 'getAddressBalance':
        return 30000; // 30 seconds
      case 'getAddressTransactions':
        return 60000; // 1 minute
      default:
        return 30000;
    }
  }
}
```

### Issue: "Memory leaks"

#### Symptoms

```
Memory usage constantly increasing
Node.js process running out of memory
Garbage collection taking longer
```

#### Solutions

**Solution 1: Implement Proper Cleanup**

```typescript
class ResourceManagedProvider extends BaseProvider {
  private abortControllers = new Set<AbortController>();
  private cache = new Map<string, any>();
  private cleanupInterval: NodeJS.Timeout;

  constructor(config: any) {
    super(config);

    // Cleanup every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup();
      },
      5 * 60 * 1000,
    );
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    const controller = new AbortController();
    this.abortControllers.add(controller);

    try {
      const result = await super.execute(operation, {
        signal: controller.signal,
      });
      return result;
    } finally {
      this.abortControllers.delete(controller);
    }
  }

  private cleanup(): void {
    // Clear expired cache entries
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiry < now) {
        this.cache.delete(key);
      }
    }

    // Log memory usage
    const used = process.memoryUsage();
    console.log(
      `Memory usage - RSS: ${Math.round(used.rss / 1024 / 1024)}MB, Heap: ${Math.round(used.heapUsed / 1024 / 1024)}MB`,
    );
  }

  async shutdown(): Promise<void> {
    // Cancel all pending requests
    for (const controller of this.abortControllers) {
      controller.abort();
    }
    this.abortControllers.clear();

    // Clear cache
    this.cache.clear();

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
```

## Configuration Issues

### Issue: "Configuration validation failed"

#### Symptoms

```
Error: Invalid provider configuration
Missing required field: blockchain
Invalid rate limit configuration
```

#### Solution: Configuration Validation

```typescript
import Joi from 'joi';

const providerConfigSchema = Joi.object({
  name: Joi.string().required(),
  priority: Joi.number().integer().min(1).required(),
  enabled: Joi.boolean().default(true),
  apiKey: Joi.string().optional(),
  baseUrl: Joi.string().uri().optional(),
  rateLimit: Joi.object({
    requestsPerSecond: Joi.number().positive().required(),
    burstLimit: Joi.number().integer().positive().optional(),
    backoffMs: Joi.number().integer().positive().optional(),
  }).required(),
  timeout: Joi.number().integer().positive().optional(),
  retries: Joi.number().integer().min(0).optional(),
});

const blockchainConfigSchema = Joi.object({
  enabled: Joi.boolean().required(),
  adapterType: Joi.string().valid('blockchain').required(),
  options: Joi.object({
    blockchain: Joi.string().required(),
    providers: Joi.array().items(providerConfigSchema).min(1).required(),
  }).required(),
});

function validateConfiguration(config: any): void {
  for (const [blockchain, blockchainConfig] of Object.entries(config)) {
    const { error } = blockchainConfigSchema.validate(blockchainConfig);
    if (error) {
      throw new Error(
        `Configuration error for ${blockchain}: ${error.message}`,
      );
    }
  }
}
```

### Issue: "Environment variables not loading"

#### Symptoms

```
Error: Missing required environment variable: ETHERSCAN_API_KEY
Environment variable is set but not accessible
```

#### Solutions

**Solution 1: Debug Environment Loading**

```typescript
// Add to your startup script
console.log('Environment debugging:');
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`ETHERSCAN_API_KEY exists: ${!!process.env.ETHERSCAN_API_KEY}`);
console.log(
  `ETHERSCAN_API_KEY length: ${process.env.ETHERSCAN_API_KEY?.length || 0}`,
);

// Check for common issues
if (process.env.ETHERSCAN_API_KEY?.includes('\n')) {
  console.warn('WARNING: API key contains newline characters');
}

if (
  process.env.ETHERSCAN_API_KEY?.startsWith(' ') ||
  process.env.ETHERSCAN_API_KEY?.endsWith(' ')
) {
  console.warn('WARNING: API key has leading/trailing spaces');
}
```

**Solution 2: Environment File Loading**

```typescript
// Load environment files in correct order
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific file first
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

// Load general .env file as fallback
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Validate required variables
const required = ['ETHERSCAN_API_KEY', 'ALCHEMY_API_KEY'];

for (const envVar of required) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}
```

## Emergency Procedures

### Complete System Reset

```bash
#!/bin/bash
# emergency-reset.sh

echo "🚨 Emergency Provider System Reset"

# 1. Stop all running processes
pkill -f "node.*import"

# 2. Reset circuit breakers
node -e "
const fs = require('fs');
const circuitBreakerState = '/tmp/circuit-breakers.json';
if (fs.existsSync(circuitBreakerState)) {
  fs.unlinkSync(circuitBreakerState);
  console.log('✅ Circuit breaker state cleared');
}
"

# 3. Clear cache
rm -rf /tmp/provider-cache-*
echo "✅ Provider cache cleared"

# 4. Test minimal configuration
cat > config/minimal-config.json << EOF
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
          "rateLimit": { "requestsPerSecond": 0.1 }
        }
      ]
    }
  }
}
EOF

# 5. Test with minimal config
echo "🔍 Testing minimal configuration..."
pnpm run test:providers --config config/minimal-config.json

echo "✅ Emergency reset complete"
```

### Provider Health Dashboard

```typescript
// health-dashboard.ts
class ProviderHealthDashboard {
  async generateReport(): Promise<void> {
    const report = {
      timestamp: new Date().toISOString(),
      providers: new Map<string, any>(),
    };

    const blockchains = ['bitcoin', 'ethereum', 'injective'];

    for (const blockchain of blockchains) {
      const providers = this.providerManager.getProviders(blockchain);

      for (const provider of providers) {
        const health = await this.getProviderHealth(provider);
        report.providers.set(`${blockchain}/${provider.name}`, health);
      }
    }

    console.log('\n📊 PROVIDER HEALTH DASHBOARD');
    console.log('='.repeat(50));

    for (const [key, health] of report.providers) {
      const status = health.isHealthy ? '✅' : '❌';
      const circuit = health.circuitState.toUpperCase();
      console.log(
        `${status} ${key}: ${circuit} (${health.responseTime}ms, ${(health.errorRate * 100).toFixed(1)}% errors)`,
      );
    }

    console.log('='.repeat(50));
  }

  private async getProviderHealth(provider: any): Promise<any> {
    try {
      const startTime = Date.now();
      const isHealthy = await provider.isHealthy();
      const responseTime = Date.now() - startTime;

      return {
        isHealthy,
        responseTime,
        circuitState: 'closed', // Would get from circuit breaker
        errorRate: 0.05, // Would calculate from recent requests
      };
    } catch (error) {
      return {
        isHealthy: false,
        responseTime: 0,
        circuitState: 'open',
        errorRate: 1.0,
      };
    }
  }
}

// Usage
const dashboard = new ProviderHealthDashboard();
setInterval(() => dashboard.generateReport(), 60000); // Every minute
```

This troubleshooting guide provides comprehensive solutions for the most common
issues you'll encounter with the Universal Blockchain Provider Architecture.
Keep this guide handy during deployment and operations for quick problem
resolution.
