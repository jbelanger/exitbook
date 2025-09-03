# @gc-fwcs/logger

A flexible logging module that provides structured logging capabilities with support for audit logs. Uses Pino for better performance and to avoid event listener limits when using many loggers.

## Features

- Multiple log levels (audit, error, warn, info, debug, trace)
- Category-based loggers for better organization
- Automatic exception handling
- Configurable audit logs with daily rotation
- Rich formatting with timestamps and category labels
- Support for additional metadata in log messages
- Correlation ID tracking for request tracing
- Async context management for distributed tracing

## Environment Variables

| Variable                          | Description                   | Default   | Valid Values                                                   |
| --------------------------------- | ----------------------------- | --------- | -------------------------------------------------------------- |
| `LOGGER_LOG_LEVEL`                | Logging level to use          | `'info'`  | `'audit'`, `'error'`, `'warn'`, `'info'`, `'debug'`, `'trace'` |
| `LOGGER_AUDIT_LOG_ENABLED`        | Enable/disable audit logging  | `'true'`  | `'true'`, `'false'`                                            |
| `LOGGER_AUDIT_LOG_DIRNAME`        | Directory for audit log files | `'logs'`  | Any valid directory path                                       |
| `LOGGER_AUDIT_LOG_FILENAME`       | Base name for audit log files | `'audit'` | Any valid filename                                             |
| `LOGGER_AUDIT_LOG_RETENTION_DAYS` | Days to retain audit logs     | `'30'`    | Any positive integer                                           |

## API Reference

### Logging

```typescript
import { getLogger } from '@gc-fwcs/logger';

// Create a logger for a specific category (configuration via env vars)
const logger = getLogger('MyService');

// Basic logging
logger.info('Application started');
logger.warn('Something might be wrong');
logger.error('An error occurred', { error: new Error('Failed') });

// Audit logging (if enabled)
logger.audit('User performed sensitive action', {
  userId: '123',
  action: 'delete'
});

// Debug and trace for detailed information
logger.debug('Processing request', { requestId: '456' });
logger.trace('Detailed operation info', { step: 1, data: {...} });
```

### Correlation ID Tracking

The module provides utilities for tracking correlation IDs across asynchronous operations:

```typescript
import { getCurrentCorrelationId, getLogger, setCorrelationContext, withCorrelationId } from '@gc-fwcs/logger';

const logger = getLogger('MyService');

// Get the current correlation ID from async context
const correlationId = getCurrentCorrelationId();

// Run code with a specific correlation ID
withCorrelationId('correlation-123', () => {
  // All logs within this function will include the correlation ID
  logger.info('This log has correlation ID attached');

  // Async operations will maintain the correlation context
  asyncOperation().then(() => {
    // The correlation ID is preserved in the promise chain
    logger.info('Still has the same correlation ID');
  });
});

// For request handlers and entry points, set the correlation context
function handleRequest(req, res) {
  const correlationId = req.headers['x-correlation-id'] || generateNewId();

  setCorrelationContext(correlationId, () => {
    // All code in this request flow will have access to the correlation ID
    processRequest(req, res);
  });
}
```

## Express Integration

You can easily integrate correlation ID tracking with Express applications by creating a simple middleware:

```typescript
import { setCorrelationContext } from '@gc-fwcs/logger';
import type { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Express middleware that adds correlation ID tracking to all requests
 */
function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  // Get correlation ID from header or generate new one
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();

  // Add correlation ID to response headers
  res.setHeader('x-correlation-id', correlationId);

  // Run the rest of the request in a correlation ID context
  setCorrelationContext(correlationId, () => {
    // Make correlation ID available on request object for convenience
    req.correlationId = correlationId;

    try {
      next();
    } catch (err) {
      // Ensure correlation ID is set even if there's an error
      res.setHeader('x-correlation-id', correlationId);
      next(err);
    }
  });
}

// Add to Express app
const app = express();
app.use(correlationMiddleware);

// Now all loggers will automatically include correlation IDs
```

This middleware ensures that all requests have a correlation ID, either from the incoming headers or newly generated. The correlation ID is then available to all loggers used during request processing.

## Log Format

The logger formats output differently depending on the environment:

### Development Format

In development, logs are formatted in a human-readable format:

```
TIMESTAMP LEVEL --- [CATEGORY]: MESSAGE --- METADATA
```

Example:

```
2024-03-06T19:45:38.123Z INFO  --- [        MyService]: Application started
2024-03-06T19:45:39.456Z ERROR --- [        MyService]: An error occurred --- { error: Error: Failed ... }
```

### Production Format

In production, logs are emitted as JSON objects for better performance and easier integration with log aggregation services:

```json
{"level":30,"time":"2024-03-06T19:45:38.123Z","pid":12345,"hostname":"server-name","category":"MyService","msg":"Application started"}
{"level":50,"time":"2024-03-06T19:45:39.456Z","pid":12345,"hostname":"server-name","category":"MyService","msg":"An error occurred","error":{"type":"Error","message":"Failed","stack":"Error: Failed\n    at..."}}
```

### Correlation Tracking

When correlation tracking is enabled, logs will automatically include a `correlationId` field in either format:

```
2024-03-06T19:45:38.123Z INFO  --- [        MyService]: Request processed --- { correlationId: "550e8400-e29b-41d4-a716-446655440000" }
```

```json
{
  "level": 30,
  "time": "2024-03-06T19:45:38.123Z",
  "pid": 12345,
  "hostname": "server-name",
  "category": "MyService",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "msg": "Request processed"
}
```
