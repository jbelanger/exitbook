# @exitbook/shared-logger

A production-grade, observability-focused logging module built for NestJS applications. Features distributed tracing integration, structured error contexts, and comprehensive request lifecycle monitoring.

## Architecture Overview

This logger follows a **two-tier architecture** that separates core functionality from application integration patterns:

### Tier 1: Core Library

- **Framework-agnostic logging service** with Pino backend
- **OpenTelemetry integration** for distributed tracing
- **Structured error context capture** with automatic severity classification
- **Correlation ID tracking** with async context management

### Tier 2: Integration Recipes

- **HTTP request/response interceptor** for automatic API observability
- **Performance monitoring decorators** for method execution tracking
- **Log aggregation workflow** recommendations for development

---

## Features

### Core Observability

- ✅ **Multiple log levels**: `audit`, `error`, `warn`, `info`, `debug`, `trace`
- ✅ **Distributed tracing**: Automatic OpenTelemetry trace/span ID injection
- ✅ **Correlation tracking**: Request-scoped context with AsyncLocalStorage
- ✅ **Structured error logging**: Rich context capture with fingerprinting and severity classification
- ✅ **Audit logging**: Configurable file rotation and retention

### Production Ready

- ✅ **High performance**: Pino-based with minimal overhead
- ✅ **Environment-aware**: Human-readable dev logs, JSON production logs
- ✅ **Memory efficient**: Cached logger instances and optimized transports
- ✅ **Type-safe**: Full TypeScript support with comprehensive interfaces

---

## Installation

```bash
pnpm add @exitbook/shared-logger @opentelemetry/api
```

### Dependencies

- `@nestjs/common` - NestJS framework integration
- `@opentelemetry/api` - Distributed tracing support
- `pino` - High-performance logging backend
- `zod` - Configuration validation

---

## Quick Start

### 1. Module Registration

```typescript
// app.module.ts
import { LoggerModule } from '@exitbook/shared-logger';

@Module({
  imports: [
    LoggerModule.forRoot({
      serviceName: 'my-service',
      logLevel: 'info',
    }),
  ],
})
export class AppModule {}
```

### 2. Basic Logging

```typescript
// my.service.ts
import { LoggerService } from '@exitbook/shared-logger';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MyService {
  constructor(private readonly logger: LoggerService) {}

  async processData(data: any) {
    this.logger.log('Processing started', 'MyService');

    try {
      const result = await this.complexOperation(data);
      this.logger.log('Processing completed successfully', 'MyService');
      return result;
    } catch (error) {
      // Enhanced error logging with context
      this.logger.errorWithContext(error, {
        userId: data.userId,
        module: 'MyService',
        metadata: { operation: 'processData', dataId: data.id },
        severity: 'high',
      });
      throw error;
    }
  }
}
```

---

## Configuration

### Environment Variables

| Variable                          | Description               | Default   | Values                                                                   |
| --------------------------------- | ------------------------- | --------- | ------------------------------------------------------------------------ |
| `LOGGER_LOG_LEVEL`                | Minimum log level         | `'info'`  | `'audit'` \| `'error'` \| `'warn'` \| `'info'` \| `'debug'` \| `'trace'` |
| `LOGGER_AUDIT_LOG_ENABLED`        | Enable audit file logging | `'true'`  | `'true'` \| `'false'`                                                    |
| `LOGGER_AUDIT_LOG_DIRNAME`        | Audit log directory       | `'logs'`  | Any valid path                                                           |
| `LOGGER_AUDIT_LOG_FILENAME`       | Audit log file prefix     | `'audit'` | Any valid filename                                                       |
| `LOGGER_AUDIT_LOG_RETENTION_DAYS` | Log retention period      | `'30'`    | Positive integer                                                         |

### Programmatic Configuration

```typescript
// Advanced configuration with async factory
LoggerModule.forRootAsync({
  useFactory: async (configService: ConfigService) => ({
    serviceName: configService.get('SERVICE_NAME'),
    logLevel: configService.get('LOG_LEVEL', 'info'),
    auditLogEnabled: configService.get('AUDIT_ENABLED', true),
    nodeEnv: configService.get('NODE_ENV', 'development'),
  }),
  inject: [ConfigService],
});
```

---

## Core API Reference

### LoggerService

#### Standard Logging Methods

```typescript
logger.log(message: unknown, context?: string)        // Info level
logger.error(message: unknown, trace?: string, context?: string)  // Error level
logger.warn(message: unknown, context?: string)       // Warning level
logger.debug(message: unknown, context?: string)      // Debug level
logger.verbose(message: unknown, context?: string)    // Trace level
```

#### Enhanced Error Logging

```typescript
interface ErrorContext {
  userId?: string;
  requestId?: string;
  module?: string;
  metadata?: Record<string, unknown>;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

logger.errorWithContext(error: Error | unknown, context?: ErrorContext): void
```

**Features:**

- ✅ Automatic severity classification based on error patterns
- ✅ Stable error fingerprinting for deduplication
- ✅ Critical error auto-escalation (extensible)
- ✅ Rich metadata capture with trace correlation

### CorrelationService

#### Correlation Context Management

```typescript
interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

interface CorrelationContext {
  correlationId: string;
  traceContext?: TraceContext;
}
```

#### Core Methods

```typescript
correlationService.getId(): string | undefined
correlationService.getTraceContext(): TraceContext | undefined
correlationService.setContext<T>(correlationId: string, fn: () => T): T
correlationService.setContextFromActiveSpan<T>(correlationId: string, fn: () => T): T
```

---

## Integration Patterns

The logger provides framework-agnostic integration patterns documented in [`docs/integration-patterns.md`](./docs/integration-patterns.md). These patterns demonstrate how to integrate the logger without forcing additional dependencies.

### Available Patterns

#### 1. HTTP Request/Response Logging 🔥

**Automatic API observability with zero manual instrumentation.**

- Request start/completion timing with status codes
- Automatic correlation ID generation and extraction
- Error context capture with IP, User-Agent, HTTP metadata
- OpenTelemetry trace context integration
- Framework examples: Express, Fastify

#### 2. Performance Monitoring Decorators ⚡

**Method-level performance tracking with automatic thresholds.**

- Configurable execution time thresholds and memory monitoring
- Statistical sampling for high-volume methods
- Error correlation with performance context
- Argument sanitization support for sensitive data

#### 3. Custom Error Handlers 🛡️

**Global exception filtering with structured error contexts.**

- Automatic error severity classification
- Request context capture and sanitization
- Integration with NestJS exception filters

#### 4. Background Job Logging 📋

**Queue processing and scheduled task observability.**

- Job lifecycle tracking with correlation IDs
- Error handling with retry context
- Scheduled task monitoring patterns

### Quick Integration

```typescript
// 1. HTTP Logging (copy from docs/integration-patterns.md)
@UseInterceptors(LoggingInterceptor)
export class ApiController {
  // Automatic request/response logging
}

// 2. Performance Monitoring
@LogPerformance(1000)
async slowOperation(): Promise<Result> {
  // Automatic timing and threshold alerts
}

// 3. Enhanced Error Logging
try {
  await riskyOperation();
} catch (error) {
  this.logger.errorWithContext(error, {
    userId: user.id,
    module: 'UserService',
    severity: 'high'
  });
}
```

### Development Workflow 🛠️

**Enhanced development debugging without building custom UIs.**

```bash
# Option 1: Enhanced console output
pnpm start:dev | pino-colada

# Option 2: Structured search and filtering
pnpm start:dev | pino-pretty --search "correlationId=abc123"

# Option 3: Export to external log viewers
pnpm start:dev | tee >(jq '.traceId' | sort | uniq -c)
```

**Recommended toolchain:**

- `pino-colada` - Beautiful console formatting
- `pino-pretty` - Structured log filtering
- `jq` - JSON log analysis and aggregation
- Docker + Loki - Production log aggregation

> 📖 **See [`docs/integration-patterns.md`](./docs/integration-patterns.md) for complete implementation examples and framework-specific variations.**

---

## OpenTelemetry Integration

### Automatic Trace Context Injection

The logger automatically extracts and injects OpenTelemetry trace context:

```typescript
// All logs automatically include:
{
  "correlationId": "req_123",
  "traceId": "1234567890abcdef",
  "spanId": "fedcba0987654321",
  "msg": "Processing user request"
}
```

### Manual Trace Context Management

```typescript
// In HTTP interceptor or middleware
correlationService.setContextFromActiveSpan(correlationId, () => {
  // All logs in this scope include trace IDs
  processRequest();
});
```

---

## Log Output Formats

### Development (Human-Readable)

```
2024-03-06T19:45:38.123Z INFO  --- [      MyService]: Request processed
2024-03-06T19:45:39.456Z ERROR --- [      MyService]: Database timeout
  correlationId: "req_123"
  traceId: "1234567890abcdef"
  error: DatabaseTimeoutError: Connection timeout after 5000ms
```

### Production (Structured JSON)

```json
{
  "level": 30,
  "time": "2024-03-06T19:45:38.123Z",
  "pid": 12345,
  "hostname": "api-server-1",
  "service": "user-service",
  "category": "MyService",
  "correlationId": "req_123",
  "traceId": "1234567890abcdef",
  "spanId": "fedcba0987654321",
  "msg": "Request processed"
}
```

---

## Best Practices

### 1. Error Context Enrichment

```typescript
// ❌ Basic error logging
this.logger.error('Database failed');

// ✅ Rich error context
this.logger.errorWithContext(error, {
  userId: user.id,
  module: 'UserService',
  metadata: {
    operation: 'updateProfile',
    attemptCount: retryCount,
    dbConnection: connection.id,
  },
  severity: 'high',
});
```

### 2. Correlation Propagation

```typescript
// ✅ Automatic correlation with interceptor
@UseInterceptors(LoggingInterceptor)
export class UserController {
  // Correlation ID automatically managed
}

// ✅ Manual correlation for background jobs
async processJob(job: Job) {
  const correlationId = `job_${job.id}`;
  return this.correlationService.setContext(correlationId, () => {
    return this.executeJob(job);
  });
}
```

### 3. Performance Monitoring Strategy

```typescript
// ✅ Tiered performance thresholds
@LogPerformance(500)      // DB queries: 500ms threshold
async findUser(id: string) { /* ... */ }

@LogPerformance(2000)     // API calls: 2s threshold
async syncExternalData() { /* ... */ }

@LogAdvancedPerformance({ // Critical paths: full monitoring
  threshold: 100,
  includeMemoryUsage: true,
  sampleRate: 1.0
})
async processPayment() { /* ... */ }
```

---

## Migration Guide

### From Built-in NestJS Logger

```typescript
// Before
constructor(private logger: Logger) {}
this.logger.log('Message', 'Context');

// After
constructor(private logger: LoggerService) {}
this.logger.log('Message', 'Context'); // Same API!
```

### Adding Error Context

```typescript
// Before
try {
  await operation();
} catch (error) {
  this.logger.error(error.message, error.stack, 'MyService');
}

// After
try {
  await operation();
} catch (error) {
  this.logger.errorWithContext(error, {
    module: 'MyService',
    metadata: { operationId: 'op_123' },
    severity: 'medium',
  });
}
```

---

## Performance Characteristics

- **Logging overhead**: < 1ms per log call (Pino backend)
- **Memory usage**: ~50KB base + ~1KB per cached logger category
- **AsyncLocalStorage overhead**: < 0.1ms per context switch
- **Correlation tracking**: Zero allocation for active context reads

## TypeScript Support

Full type safety with comprehensive interfaces:

```typescript
import type { CorrelationContext, ErrorContext, Logger, LoggerConfig, TraceContext } from '@exitbook/shared-logger';
```

---

## License

Private - Part of the ExitBook platform.
