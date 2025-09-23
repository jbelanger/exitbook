# The Circuit Breaker Pattern in the Provider Architecture

## 1. What is a Circuit Breaker?

A **Circuit Breaker** is a design pattern that prevents our application from repeatedly attempting to call an external service that is known to be failing. Just like an electrical circuit breaker protects appliances from power surges, a software circuit breaker protects our system from the cascading failures and wasted resources that result from hammering an unresponsive API.

### The Problem Without a Circuit Breaker

When an external API like Blockstream.info goes down, a naive system will continue to send requests, each one waiting for a long timeout before failing.

```
App → Blockstream API (DOWN) → Wait 30s → TIMEOUT
App → Blockstream API (DOWN) → Wait 30s → TIMEOUT
App → Blockstream API (DOWN) → Wait 30s → TIMEOUT
```

This leads to:
*   **Wasted Resources:** The application's threads and memory are tied up waiting for doomed requests.
*   **Poor User Experience:** The system feels slow or unresponsive because every operation is delayed by the timeout.
*   **Delayed Failover:** The system only tries the next provider after the full timeout period has elapsed.
*   **Inhibited Service Recovery:** Continuous requests can overwhelm a struggling service, preventing it from recovering.

### The Solution: The Circuit Breaker

The circuit breaker acts as a stateful proxy. After a few consecutive failures, it "trips" or "opens," causing subsequent requests to fail instantly without ever being sent.

```
App → ProviderManager → Blockstream API (DOWN) → Fail (Failure 1/3)
App → ProviderManager → Blockstream API (DOWN) → Fail (Failure 2/3)
App → ProviderManager → Blockstream API (DOWN) → Fail (Failure 3/3) -> Circuit Opens!
App → ProviderManager → Circuit is OPEN for Blockstream -> Fail Instantly ⚡, Try next provider (Alchemy)
App → ProviderManager → Circuit is OPEN for Blockstream -> Fail Instantly ⚡, Try next provider (Alchemy)
```

**Benefits:**
*   **Fast Failure:** The system fails instantly for a known-bad provider, allowing immediate failover to a healthy alternative.
*   **Resource Protection:** No resources are wasted on requests that are destined to fail.
*   **Automatic Recovery:** The circuit breaker periodically allows a test request to see if the service has recovered, automatically restoring functionality.

## 2. The Three States of the Circuit Breaker

Our `CircuitBreaker` class is a simple but powerful state machine with three states.

### State 1: `CLOSED` (Normal Operation)
*   **Behavior:** Requests are allowed to pass through to the provider. The `BlockchainProviderManager` monitors for failures.
*   **Transition to `OPEN`:** Occurs after the failure count reaches a threshold (default: **3**).

### State 2: `OPEN` (Service Failing)
*   **Behavior:** The `BlockchainProviderManager` sees the circuit is open and will **not** send requests to this provider. It fails instantly and moves to the next provider in its priority list.
*   **Transition to `HALF-OPEN`:** Occurs after a timeout period has elapsed (default: **5 minutes**).

### State 3: `HALF-OPEN` (Testing for Recovery)
*   **Behavior:** The `BlockchainProviderManager` will allow a single "test" request to pass through to the provider.
*   **Transition to `CLOSED`:** If the test request succeeds, the circuit is considered healthy, the failure count is reset, and the state becomes `CLOSED`.
*   **Transition to `OPEN`:** If the test request fails, the circuit immediately returns to the `OPEN` state, and the recovery timer is reset.

### State Transition Diagram

```
                    3 failures
    ┌─────────┐ ────────────────► ┌────────┐
    │ CLOSED  │                   │  OPEN  │
    │ (Normal)│ ◄──────────────── │(Failed)│
    └─────────┘     On Success    └────────┘
         ▲                             │
         │                             │ 5-minute timeout
         │                             ▼
         │                       ┌───────────┐
         │     On Test Success   │ HALF-OPEN │
         └─────────────────────  │ (Testing) │
                                 └───────────┘
                                       │
                                       │ On Test Failure
                                       ▼
                                 ┌────────┐
                                 │  OPEN  │
                                 └────────┘
```

## 3. Implementation in the Provider System

The `CircuitBreaker` is not an executor; it is a state machine managed by the `BlockchainProviderManager`.

### The `CircuitBreaker` Class (`packages/import/src/shared/utils/circuit-breaker.ts`)

The class itself is simple, tracking only the state.

```typescript
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTimestamp = 0;
  private readonly maxFailures: number;
  private readonly recoveryTimeoutMs: number;

  constructor(providerName: string, maxFailures: number = 3, recoveryTimeoutMs: number = 300000) { /*...*/ }

  // State checking methods
  isOpen(): boolean { /*...*/ }
  isHalfOpen(): boolean { /*...*/ }
  isClosed(): boolean { /*...*/ }
  getCurrentState(): 'closed' | 'open' | 'half-open' { /*...*/ }

  // State update methods
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTimestamp = Date.now();
  }

  recordSuccess(): void {
    this.failureCount = 0;
  }

  reset(): void {
    this.failureCount = 0;
  }
}
```

### Integration with `BlockchainProviderManager`

The `BlockchainProviderManager` creates and manages a `CircuitBreaker` instance for every registered provider.

```typescript
// packages/import/src/blockchains/shared/blockchain-provider-manager.ts

export class BlockchainProviderManager {
  private circuitBreakers = new Map<string, CircuitBreaker>();

  // ...

  private async executeWithCircuitBreaker<T>(
    blockchain: string,
    operation: ProviderOperation<T>
  ): Promise<FailoverExecutionResult<T>> {
    const providers = this.getProvidersInOrder(blockchain, operation);

    for (const provider of providers) {
      const circuitBreaker = this.getOrCreateCircuitBreaker(provider.name);

      // 1. CHECK THE STATE before making a call
      if (circuitBreaker.isOpen()) {
        logger.debug(`Skipping ${provider.name} - circuit breaker is OPEN`);
        continue;
      }
      if (circuitBreaker.isHalfOpen()) {
        logger.debug(`Testing provider ${provider.name} in HALF-OPEN state`);
      }

      try {
        const result = await provider.execute(operation, {});

        // 2. UPDATE THE STATE on success
        circuitBreaker.recordSuccess();
        this.updateHealthMetrics(provider.name, true, /*...*/);
        return { data: result, providerName: provider.name };

      } catch (error) {
        // 3. UPDATE THE STATE on failure
        circuitBreaker.recordFailure();
        this.updateHealthMetrics(provider.name, false, /*...*/);
        // Continue to the next provider...
      }
    }
    throw new Error('All providers failed');
  }
}
```

## 4. Practical Example: A Provider Outage

**Scenario:** The Alchemy API for Ethereum is experiencing an outage.

1.  **Request 1 (12:00:00 PM):** `BlockchainProviderManager` selects Alchemy (highest priority). The request times out.
    *   `circuitBreaker.recordFailure()` is called for Alchemy. **Failure Count: 1/3**.
    *   The manager fails over to Moralis, which succeeds. The user gets a successful response.

2.  **Request 2 (12:00:30 PM):** Another request comes in. Alchemy is still the highest priority. The request fails again.
    *   `circuitBreaker.recordFailure()` is called. **Failure Count: 2/3**.
    *   Failover to Moralis succeeds.

3.  **Request 3 (12:01:00 PM):** A third request fails against Alchemy.
    *   `circuitBreaker.recordFailure()` is called. **Failure Count: 3/3**.
    *   The `CircuitBreaker` state for Alchemy now transitions to **`OPEN`**.
    *   Failover to Moralis succeeds.

4.  **Request 4 (12:01:30 PM):** A new request comes in.
    *   `BlockchainProviderManager` checks Alchemy's circuit breaker. `circuitBreaker.isOpen()` returns `true`.
    *   The manager **skips Alchemy instantly** without making an API call.
    *   It immediately tries Moralis, which succeeds. The user experiences no delay.

5.  **Recovery Test (12:06:00 PM):** Five minutes have passed since the last failure.
    *   The `CircuitBreaker` state for Alchemy transitions to **`HALF-OPEN`**.
    *   The next request comes in. The manager sees the `HALF-OPEN` state and allows this one request to go through to Alchemy.
    *   **If the request succeeds:** `circuitBreaker.recordSuccess()` is called. The failure count resets to 0. The state becomes **`CLOSED`**. Alchemy is back in the normal rotation.
    *   **If the request fails:** `circuitBreaker.recordFailure()` is called. The state immediately reverts to **`OPEN`**, and the 5-minute timer restarts.

## 5. Monitoring and Troubleshooting

The state of each circuit breaker is exposed via the `BlockchainProviderManager`'s health monitoring.

### Checking Real-time Status

```typescript
// Get current status of all circuit breakers for a blockchain
const health = providerManager.getProviderHealth('ethereum');

for (const [providerName, status] of health) {
  console.log(`${providerName}: ${status.circuitState}`);
}
// Output might be:
// alchemy: open
// moralis: closed
```

### Troubleshooting Common Issues

*   **Symptom: A provider is being skipped even though it's back online.**
    *   **Cause:** The 5-minute `recoveryTimeoutMs` for the `OPEN` state has not yet elapsed.
    *   **Solution:** Wait for the timeout to expire, or for critical situations, manually restart the application to clear the in-memory state of the circuit breakers.

*   **Symptom: A circuit breaker trips too easily on minor network glitches.**
    *   **Cause:** The `maxFailures` threshold (default 3) might be too low.
    *   **Solution:** While not currently configurable via the JSON file, this value could be exposed as a provider override in `blockchain-explorers.json` for fine-tuning in the future.

*   **Symptom: A circuit breaker never opens during a clear outage.**
    *   **Cause:** The errors being thrown by the `ApiClient` are being caught before they reach the `BlockchainProviderManager`, or they are not being re-thrown correctly.
    *   **Solution:** Ensure that `ApiClient` implementations allow exceptions to propagate up to the manager so that `recordFailure()` can be called.

## 6. Conclusion

The `CircuitBreaker` is a simple but critical component of our resilient architecture. It is not an active executor but a passive state machine that provides the `BlockchainProviderManager` with the intelligence to:

✅ **Prevent Cascading Failures** by stopping requests to failing services.
✅ **Enable Fast Failures** and rapid failover.
✅ **Support Automatic Recovery** by periodically testing a service's health.
✅ **Improve System Stability** and provide a better user experience during partial service outages.