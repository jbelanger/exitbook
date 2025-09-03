# Circuit Breaker Pattern Explanation

> **📋 Open Source Notice**  
> This guide explains the Circuit Breaker pattern implementation in the Universal Blockchain Provider Architecture. The pattern is open source and follows industry-standard practices for building resilient distributed systems.

## What is a Circuit Breaker?

A **Circuit Breaker** is a design pattern that prevents your application from repeatedly calling a failing service. Just like an electrical circuit breaker in your home protects against power surges, a software circuit breaker protects against cascading failures.

### The Problem Without Circuit Breakers

Imagine your application trying to fetch Bitcoin transactions from mempool.space:

```
App → mempool.space API (DOWN) → Wait 30 seconds → TIMEOUT
App → mempool.space API (DOWN) → Wait 30 seconds → TIMEOUT
App → mempool.space API (DOWN) → Wait 30 seconds → TIMEOUT
...continues hammering the failed service...
```

**Problems:**

- **Wasted Resources**: Your application spends time and memory on doomed requests
- **Slow Failure**: Users wait 30+ seconds to discover the service is down
- **Service Overload**: Your requests may prevent the failing service from recovering
- **Cascading Failures**: Other parts of your system may timeout waiting for responses

### The Solution: Circuit Breaker Pattern

```
App → Circuit Breaker → mempool.space API (DOWN)
                    ↓
              [TRIP BREAKER]
                    ↓
App → Circuit Breaker → "OPEN - Skip Request" (Instant response)
App → Circuit Breaker → "OPEN - Skip Request" (Instant response)
App → Circuit Breaker → "OPEN - Skip Request" (Instant response)
```

**Benefits:**

- **Fast Failure**: Instant response when service is known to be down
- **Resource Protection**: No wasted time/memory on doomed requests
- **Service Recovery**: Reduces load on failing service, helping it recover
- **Automatic Testing**: Periodically tests if service has recovered

## Circuit Breaker States

The circuit breaker operates in three distinct states:

### 1. CLOSED State (Normal Operation)

```
┌─────────────┐
│   CLOSED    │  ← All requests pass through
│  (Normal)   │  ← Service is healthy
└─────────────┘
```

**Behavior:**

- All requests pass through to the provider
- Failures are counted but don't block requests
- State changes to OPEN after reaching failure threshold

**Example:**

```typescript
const breaker = new CircuitBreaker('mempool.space', 3, 300000); // 3 failures, 5 min timeout

// Service is healthy - all requests succeed
await breaker.execute(() => fetchTransactions()); // ✅ Success
await breaker.execute(() => fetchTransactions()); // ✅ Success
await breaker.execute(() => fetchTransactions()); // ✅ Success

console.log(breaker.getState()); // "closed"
```

### 2. OPEN State (Service Failed)

```
┌─────────────┐
│    OPEN     │  ← All requests are blocked
│  (Failed)   │  ← Service is considered down
└─────────────┘
```

**Behavior:**

- All requests are immediately rejected (no API calls made)
- Provides instant failure response
- After timeout period, state changes to HALF-OPEN for testing

**Example:**

```typescript
// Service starts failing
await breaker.execute(() => fetchTransactions()); // ❌ Failure 1
await breaker.execute(() => fetchTransactions()); // ❌ Failure 2
await breaker.execute(() => fetchTransactions()); // ❌ Failure 3

console.log(breaker.getState()); // "open"

// Now all requests are blocked instantly
await breaker.execute(() => fetchTransactions()); // ⚡ Instant rejection (no API call)
await breaker.execute(() => fetchTransactions()); // ⚡ Instant rejection (no API call)
```

### 3. HALF-OPEN State (Testing Recovery)

```
┌─────────────┐
│ HALF-OPEN   │  ← Limited requests allowed
│ (Testing)   │  ← Testing if service recovered
└─────────────┘
```

**Behavior:**

- Single test request is allowed through
- If successful: Circuit breaker resets to CLOSED
- If fails: Circuit breaker returns to OPEN state

**Example:**

```typescript
// Wait 5 minutes (timeout period)
setTimeout(() => {
  console.log(breaker.getState()); // "half-open"

  // Next request is a test request
  await breaker.execute(() => fetchTransactions()); // Test if service recovered

  if (/* request succeeded */) {
    console.log(breaker.getState()); // "closed" - service recovered!
  } else {
    console.log(breaker.getState()); // "open" - still failing
  }
}, 300000); // 5 minutes
```

## State Transition Diagram

```
                    3 failures
    ┌─────────┐ ────────────────► ┌────────┐
    │ CLOSED  │                   │  OPEN  │
    │         │ ◄──────────────── │        │
    └─────────┘     success       └────────┘
         ▲                             │
         │                             │ timeout
         │                             ▼
         │                       ┌───────────┐
         │          success      │ HALF-OPEN │
         └─────────────────────  │           │
                                 └───────────┘
                                       │
                                       │ failure
                                       ▼
                                 ┌────────┐
                                 │  OPEN  │
                                 │        │
                                 └────────┘
```

## Real-World Analogy: Electrical Fuse Box

Think of your home's electrical system:

### Normal Operation (CLOSED)

- Electricity flows normally to all outlets
- Occasional small power fluctuations are handled fine
- Everything works as expected

### Overload Detected (OPEN)

- Electrical fuse "trips" when it detects dangerous overload
- Power is immediately cut to protect your appliances
- No electricity flows until the problem is resolved

### Testing Recovery (HALF-OPEN)

- After fixing the electrical problem, you flip the breaker back on
- Small test load is applied to see if the system is stable
- If stable: normal operation resumes
- If unstable: breaker trips again immediately

**The software circuit breaker works the same way but for API calls instead of electricity.**

## Implementation in the Provider System

### Configuration

```typescript
interface CircuitBreakerConfig {
  maxFailures: number; // Default: 3 failures
  timeoutMs: number; // Default: 5 minutes (300,000ms)
  enabled: boolean; // Default: true
}
```

### Automatic Integration

Every provider automatically gets circuit breaker protection:

```typescript
// Circuit breaker is created automatically for each provider
const providerManager = new BlockchainProviderManager();

providerManager.registerProviders('bitcoin', [
  new MempoolSpaceProvider(), // Gets circuit breaker: "mempool.space"
  new BlockstreamProvider(), // Gets circuit breaker: "blockstream.info"
  new BlockcypherProvider(), // Gets circuit breaker: "blockcypher"
]);
```

### Execution Flow with Circuit Breaker

```typescript
async executeWithFailover(blockchain: string, operation: ProviderOperation): Promise<any> {
  const providers = this.getProvidersInOrder(blockchain, operation);

  for (const provider of providers) {
    const circuitBreaker = this.getCircuitBreaker(provider.name);

    // Skip providers with open circuit breakers
    if (circuitBreaker.isOpen()) {
      console.log(`Skipping ${provider.name} - circuit breaker OPEN`);
      continue;
    }

    try {
      const result = await provider.execute(operation);
      circuitBreaker.recordSuccess(); // Reset failure count
      return result;
    } catch (error) {
      circuitBreaker.recordFailure(); // Increment failure count
      console.log(`Provider ${provider.name} failed, trying next...`);
      continue;
    }
  }

  throw new Error('All providers failed');
}
```

## Circuit Breaker Benefits in Practice

### Scenario: mempool.space Outage

**Without Circuit Breaker:**

```
12:00:00 - Request to mempool.space → 30s timeout → Fail
12:00:30 - Request to mempool.space → 30s timeout → Fail
12:01:00 - Request to mempool.space → 30s timeout → Fail
12:01:30 - Request to mempool.space → 30s timeout → Fail
...continues for hours...
```

**With Circuit Breaker:**

```
12:00:00 - Request to mempool.space → 30s timeout → Fail (1/3)
12:00:30 - Request to mempool.space → 30s timeout → Fail (2/3)
12:01:00 - Request to mempool.space → 30s timeout → Fail (3/3) → CIRCUIT OPENS
12:01:30 - Request blocked, try blockstream.info → 2s → Success ✅
12:02:00 - Request blocked, try blockstream.info → 2s → Success ✅
12:02:30 - Request blocked, try blockstream.info → 2s → Success ✅
...instant failover for next 5 minutes...
12:06:00 - Circuit HALF-OPEN, test mempool.space → Success → CIRCUIT CLOSED ✅
```

### Performance Impact

| Metric               | Without Circuit Breaker      | With Circuit Breaker   |
| -------------------- | ---------------------------- | ---------------------- |
| **Response Time**    | 30+ seconds during outages   | 2-3 seconds (failover) |
| **Resource Usage**   | High (waiting on timeouts)   | Low (instant failures) |
| **User Experience**  | Very poor during outages     | Minimal impact         |
| **Service Recovery** | Slower (continued hammering) | Faster (reduced load)  |

## Advanced Circuit Breaker Features

### Exponential Backoff

For flaky services, you can configure exponential backoff:

```typescript
const breaker = new CircuitBreaker('flaky-service', 3, 60000); // 1 minute initial timeout

// First failure: 1 minute timeout
// Second failure: 2 minute timeout
// Third failure: 4 minute timeout
// Etc.
```

### Custom Failure Detection

```typescript
class SmartCircuitBreaker extends CircuitBreaker {
  isFailure(error: Error): boolean {
    // Don't count rate limit errors as circuit breaker failures
    if (error instanceof RateLimitError) {
      return false;
    }

    // Don't count authentication errors (configuration issue)
    if (error instanceof AuthenticationError) {
      return false;
    }

    // Only count actual service failures
    return error instanceof ServiceUnavailableError;
  }
}
```

### Health Check Integration

```typescript
// Circuit breaker can integrate with health checks
if (circuitBreaker.isHalfOpen()) {
  // Use lighter health check instead of full operation
  const isHealthy = await provider.isHealthy();

  if (isHealthy) {
    circuitBreaker.recordSuccess();
  } else {
    circuitBreaker.recordFailure();
  }
}
```

## Monitoring Circuit Breaker Status

### Real-time Status

```typescript
// Get current status of all circuit breakers
const health = providerManager.getProviderHealth('bitcoin');

for (const [providerName, status] of health) {
  console.log(`${providerName}: ${status.circuitState}`);
  // Output:
  // mempool.space: closed
  // blockstream.info: closed
  // blockcypher: open
}
```

### Circuit Breaker Events

```typescript
// Listen for circuit breaker events
circuitBreaker.on('open', provider => {
  console.log(`⚠️  Circuit breaker OPENED for ${provider}`);
  // Alert operations team
});

circuitBreaker.on('halfOpen', provider => {
  console.log(`🔍 Circuit breaker testing recovery for ${provider}`);
});

circuitBreaker.on('close', provider => {
  console.log(`✅ Circuit breaker CLOSED - ${provider} recovered`);
});
```

### Metrics and Alerts

```typescript
// Collect circuit breaker metrics
const stats = circuitBreaker.getStats();
// {
//   name: 'mempool.space',
//   state: 'open',
//   failures: 3,
//   lastFailureTime: 1640995200000,
//   timeUntilRecovery: 180000 // 3 minutes remaining
// }

// Set up alerts
if (stats.state === 'open' && stats.timeUntilRecovery > 240000) {
  // Alert: Service has been down for more than 4 minutes
  sendAlert(`Bitcoin provider ${stats.name} down for ${stats.timeUntilRecovery / 1000}s`);
}
```

## Best Practices

### 1. Appropriate Failure Thresholds

```typescript
// ✅ Good: Conservative thresholds
const breaker = new CircuitBreaker('provider', 3, 300000); // 3 failures, 5 minutes

// ❌ Too sensitive: Single failure trips breaker
const breaker = new CircuitBreaker('provider', 1, 60000);

// ❌ Too tolerant: Many failures before tripping
const breaker = new CircuitBreaker('provider', 10, 300000);
```

### 2. Reasonable Timeout Periods

```typescript
// ✅ Good: Enough time for genuine service recovery
const breaker = new CircuitBreaker('provider', 3, 300000); // 5 minutes

// ❌ Too short: May not allow enough recovery time
const breaker = new CircuitBreaker('provider', 3, 30000); // 30 seconds

// ❌ Too long: Users suffer during extended outages
const breaker = new CircuitBreaker('provider', 3, 1800000); // 30 minutes
```

### 3. Differentiate Error Types

```typescript
// ✅ Good: Only count actual service failures
if (error instanceof ServiceUnavailableError || error instanceof TimeoutError) {
  circuitBreaker.recordFailure();
} else {
  // Don't trip circuit breaker for auth/config errors
  throw error;
}
```

### 4. Graceful Degradation

```typescript
// ✅ Good: Fallback to other providers when circuit opens
if (circuitBreaker.isOpen()) {
  return await fallbackProvider.execute(operation);
}

// ❌ Bad: Complete failure when circuit opens
if (circuitBreaker.isOpen()) {
  throw new Error('Service unavailable');
}
```

## Troubleshooting Circuit Breakers

### Common Issues

#### Circuit Breaker Stuck Open

```
Symptom: Circuit breaker remains open even though service recovered
Cause: Timeout period too long or service still actually failing
Solution: Check service health manually, reduce timeout, or reset circuit breaker
```

#### Circuit Breaker Too Sensitive

```
Symptom: Circuit breaker opens after single network hiccup
Cause: Failure threshold too low
Solution: Increase maxFailures to 3-5 for better tolerance
```

#### Circuit Breaker Never Opens

```
Symptom: Circuit breaker never opens even during clear outages
Cause: Errors not being properly recorded as failures
Solution: Check error handling logic and failure detection
```

### Manual Circuit Breaker Control

```typescript
// Emergency: Force circuit breaker open (maintenance mode)
circuitBreaker.forceOpen();

// Emergency: Force circuit breaker closed (override protection)
circuitBreaker.forceClosed();

// Reset circuit breaker to normal operation
circuitBreaker.reset();
```

## Circuit Breaker vs Other Patterns

### Circuit Breaker vs Retry Pattern

| Pattern             | Purpose                    | When to Use                        |
| ------------------- | -------------------------- | ---------------------------------- |
| **Circuit Breaker** | Prevent cascading failures | Service is down/degraded           |
| **Retry Pattern**   | Handle transient failures  | Network glitches, temporary errors |

**Best Practice**: Use both together:

```typescript
// First: Try with retries for transient failures
const result = await retryWithBackoff(() => provider.execute(operation));

// Second: Circuit breaker prevents hammering if service is truly down
if (circuitBreaker.isOpen()) {
  throw new Error('Service unavailable');
}
```

### Circuit Breaker vs Timeout Pattern

| Pattern             | Purpose                          | Scope                    |
| ------------------- | -------------------------------- | ------------------------ |
| **Circuit Breaker** | Protect against failing services | Across multiple requests |
| **Timeout Pattern** | Prevent hanging requests         | Individual request       |

**Best Practice**: Use both together:

```typescript
// Individual request timeout: 10 seconds
const result = await Promise.race([provider.execute(operation), timeout(10000)]);

// Circuit breaker: Overall service health across requests
circuitBreaker.execute(() => result);
```

## Conclusion

The Circuit Breaker pattern is essential for building resilient distributed systems. In the Universal Blockchain Provider Architecture, circuit breakers:

**✅ Prevent Cascading Failures**: Stop your application from hammering failed services
**✅ Enable Fast Failures**: Provide instant feedback when services are down  
**✅ Support Automatic Recovery**: Test and restore service connections automatically
**✅ Improve User Experience**: Reduce response times during outages through intelligent failover
**✅ Protect Service Recovery**: Reduce load on failing services to help them recover faster

By understanding and properly configuring circuit breakers, you ensure your cryptocurrency transaction import system remains responsive and reliable even when individual blockchain APIs experience outages or degradation.
