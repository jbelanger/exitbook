# Integration Patterns

This document provides framework-agnostic integration patterns for the `@exitbook/shared-logger` module. These patterns demonstrate how to integrate the logger into various NestJS applications without forcing additional dependencies.

## Table of Contents

- [HTTP Request/Response Logging](#http-requestresponse-logging)
- [Performance Monitoring Decorators](#performance-monitoring-decorators)
- [Custom Error Handlers](#custom-error-handlers)
- [Background Job Logging](#background-job-logging)

---

## HTTP Request/Response Logging

### Overview

Automatically log all HTTP requests and responses with timing, status codes, and correlation tracking. This interceptor provides zero-configuration observability for your API endpoints.

### Features

- ✅ Request start/completion logging with timing
- ✅ Automatic correlation ID generation and extraction
- ✅ Error context capture with HTTP metadata
- ✅ OpenTelemetry trace context integration
- ✅ Response size estimation and IP tracking

### NestJS with Express

First install the required dependencies:

```bash
pnpm add rxjs @types/express
```

Then create the interceptor:

```typescript
// src/common/interceptors/logging.interceptor.ts
import { CorrelationService, ErrorContext, LoggerService } from '@exitbook/shared-logger';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: LoggerService,
    private readonly correlationService: CorrelationService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Only handle HTTP contexts
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    // Generate or extract correlation ID
    const correlationId = this.extractOrGenerateCorrelationId(request);

    // Set correlation context with automatic trace extraction if OpenTelemetry is active
    return this.correlationService.setContextFromActiveSpan(correlationId, () => {
      // Log request start
      this.logger.log(
        {
          type: 'request_start',
          method: request.method,
          url: request.url,
          path: request.path,
          userAgent: request.headers['user-agent'],
          ip: this.getClientIp(request),
          correlationId,
          requestId: correlationId,
          timestamp: new Date().toISOString(),
        },
        'HTTP'
      );

      return next.handle().pipe(
        tap(responseData => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;

          // Log successful completion
          this.logger.log(
            {
              type: 'request_complete',
              method: request.method,
              path: request.path,
              statusCode,
              duration,
              responseSize: this.estimateResponseSize(responseData),
              timestamp: new Date().toISOString(),
            },
            'HTTP'
          );
        }),
        catchError(error => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode || 500;

          // Log error with rich context
          const errorContext: ErrorContext = {
            requestId: correlationId,
            module: 'HTTP',
            metadata: {
              method: request.method,
              path: request.path,
              statusCode,
              duration,
              userAgent: request.headers['user-agent'],
              ip: this.getClientIp(request),
            },
            severity: this.determineErrorSeverity(statusCode, error),
          };

          this.logger.errorWithContext(error, errorContext);

          // Re-throw the error to maintain normal error handling flow
          return throwError(() => error);
        })
      );
    });
  }

  /**
   * Extracts correlation ID from headers or generates a new one
   */
  private extractOrGenerateCorrelationId(request: Request): string {
    // Check common correlation ID headers
    const correlationId =
      (request.headers['x-correlation-id'] as string) ||
      (request.headers['x-request-id'] as string) ||
      (request.headers['x-trace-id'] as string);

    return correlationId || randomUUID();
  }

  /**
   * Safely extracts client IP address
   */
  private getClientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'] as string;
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }

    return request.connection?.remoteAddress || request.socket?.remoteAddress || 'unknown';
  }

  /**
   * Estimates response size for logging (rough approximation)
   */
  private estimateResponseSize(responseData: any): number {
    if (!responseData) return 0;

    try {
      return JSON.stringify(responseData).length;
    } catch {
      return 0;
    }
  }

  /**
   * Determines error severity based on HTTP status code and error type
   */
  private determineErrorSeverity(statusCode: number, error: any): ErrorContext['severity'] {
    // Client errors (4xx) are typically lower severity
    if (statusCode >= 400 && statusCode < 500) {
      if (statusCode === 401 || statusCode === 403) {
        return 'medium'; // Security-related
      }
      return 'low';
    }

    // Server errors (5xx) are higher severity
    if (statusCode >= 500) {
      if (statusCode === 503 || statusCode === 504) {
        return 'critical'; // Service unavailable or timeout
      }
      return 'high';
    }

    return 'medium';
  }
}
```

**Usage:**

```typescript
// Apply globally to all controllers
@Controller()
@UseInterceptors(LoggingInterceptor)
export class ApiController {
  // All endpoints automatically logged
}

// Or apply globally in main.ts
app.useGlobalInterceptors(new LoggingInterceptor(logger, correlationService));
```

### NestJS with Fastify

First install the required dependencies:

```bash
pnpm add rxjs
```

For Fastify, modify the interceptor to use Fastify types:

```typescript
// src/common/interceptors/logging.interceptor.ts
import { CorrelationService, ErrorContext, LoggerService } from '@exitbook/shared-logger';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: LoggerService,
    private readonly correlationService: CorrelationService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const startTime = Date.now();

    const correlationId = this.extractOrGenerateCorrelationId(request);

    return this.correlationService.setContextFromActiveSpan(correlationId, () => {
      // Log request start
      this.logger.log(
        {
          type: 'request_start',
          method: request.method,
          url: request.url,
          userAgent: request.headers['user-agent'],
          ip: request.ip, // Fastify provides this directly
          correlationId,
          timestamp: new Date().toISOString(),
        },
        'HTTP'
      );

      return next.handle().pipe(
        tap(responseData => {
          const duration = Date.now() - startTime;
          const statusCode = reply.statusCode;

          this.logger.log(
            {
              type: 'request_complete',
              method: request.method,
              url: request.url,
              statusCode,
              duration,
              responseSize: this.estimateResponseSize(responseData),
              timestamp: new Date().toISOString(),
            },
            'HTTP'
          );
        }),
        catchError(error => {
          const duration = Date.now() - startTime;
          const statusCode = reply.statusCode || 500;

          const errorContext: ErrorContext = {
            requestId: correlationId,
            module: 'HTTP',
            metadata: {
              method: request.method,
              url: request.url,
              statusCode,
              duration,
              userAgent: request.headers['user-agent'],
              ip: request.ip,
            },
            severity: this.determineErrorSeverity(statusCode, error),
          };

          this.logger.errorWithContext(error, errorContext);
          return throwError(() => error);
        })
      );
    });
  }

  private extractOrGenerateCorrelationId(request: FastifyRequest): string {
    const correlationId =
      (request.headers['x-correlation-id'] as string) ||
      (request.headers['x-request-id'] as string) ||
      (request.headers['x-trace-id'] as string);

    return correlationId || randomUUID();
  }

  private estimateResponseSize(responseData: any): number {
    if (!responseData) return 0;
    try {
      return JSON.stringify(responseData).length;
    } catch {
      return 0;
    }
  }

  private determineErrorSeverity(statusCode: number, error: any): ErrorContext['severity'] {
    if (statusCode >= 400 && statusCode < 500) {
      return statusCode === 401 || statusCode === 403 ? 'medium' : 'low';
    }
    if (statusCode >= 500) {
      return statusCode === 503 || statusCode === 504 ? 'critical' : 'high';
    }
    return 'medium';
  }
}
```

---

## Performance Monitoring Decorators

### Overview

Method-level performance tracking with automatic threshold warnings and memory usage monitoring. These decorators provide lightweight APM capabilities for critical application paths.

### Features

- ✅ Configurable execution time thresholds
- ✅ Memory usage delta tracking
- ✅ Statistical sampling for high-volume methods
- ✅ Error correlation with performance context
- ✅ Argument sanitization support

### Basic Performance Decorator

```typescript
// src/common/decorators/performance.decorator.ts
import { LoggerService } from '@exitbook/shared-logger';

/**
 * Performance monitoring decorator that automatically logs slow method executions
 */
export function LogPerformance(threshold: number = 1000, logLevel: 'info' | 'warn' | 'error' = 'warn') {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;
    const methodName = `${className}.${propertyName}`;

    descriptor.value = async function (...args: any[]) {
      const start = performance.now();
      const startTime = new Date().toISOString();

      // Get logger instance from the class (assumes it's injected as 'logger')
      const logger: LoggerService = this.logger;

      if (!logger || typeof logger.log !== 'function') {
        console.warn(
          `@LogPerformance: No LoggerService found on ${className}. Make sure to inject LoggerService as 'logger'.`
        );
        return originalMethod.apply(this, args);
      }

      try {
        // Execute the original method
        const result = await originalMethod.apply(this, args);
        const duration = performance.now() - start;

        // Log performance data
        if (duration > threshold) {
          const performanceData = {
            type: 'performance_threshold_exceeded',
            method: methodName,
            duration: Math.round(duration),
            threshold,
            startTime,
            endTime: new Date().toISOString(),
            args: this.sanitizeArgs ? this.sanitizeArgs(args) : '[args hidden]',
          };

          switch (logLevel) {
            case 'info':
              logger.log(performanceData, 'Performance');
              break;
            case 'warn':
              logger.warn(performanceData, 'Performance');
              break;
            case 'error':
              logger.error(performanceData, undefined, 'Performance');
              break;
          }
        } else {
          // Log successful execution for monitoring
          logger.log(
            {
              type: 'method_execution',
              method: methodName,
              duration: Math.round(duration),
              status: 'success',
            },
            'Performance'
          );
        }

        return result;
      } catch (error) {
        const duration = performance.now() - start;

        // Log error with performance context
        logger.errorWithContext(error, {
          module: 'Performance',
          metadata: {
            method: methodName,
            duration: Math.round(duration),
            startTime,
            endTime: new Date().toISOString(),
            args: this.sanitizeArgs ? this.sanitizeArgs(args) : '[args hidden]',
          },
          severity: 'medium',
        });

        throw error; // Re-throw to maintain normal error handling
      }
    };

    return descriptor;
  };
}
```

### Advanced Performance Decorator

```typescript
// Advanced performance decorator with memory tracking and sampling
export interface AdvancedPerformanceOptions {
  threshold?: number;
  includeMemoryUsage?: boolean;
  sampleRate?: number; // 0-1, percentage of calls to log
  logLevel?: 'info' | 'warn' | 'error';
}

export function LogAdvancedPerformance(options: AdvancedPerformanceOptions = {}) {
  const { threshold = 1000, includeMemoryUsage = false, sampleRate = 1.0, logLevel = 'warn' } = options;

  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;
    const methodName = `${className}.${propertyName}`;

    descriptor.value = async function (...args: any[]) {
      // Apply sampling rate
      if (Math.random() > sampleRate) {
        return originalMethod.apply(this, args);
      }

      const logger: LoggerService = this.logger;
      if (!logger) {
        return originalMethod.apply(this, args);
      }

      const start = performance.now();
      const startTime = new Date().toISOString();
      const initialMemory = includeMemoryUsage ? process.memoryUsage() : null;

      try {
        const result = await originalMethod.apply(this, args);
        const duration = performance.now() - start;
        const endTime = new Date().toISOString();
        const finalMemory = includeMemoryUsage ? process.memoryUsage() : null;

        const performanceData: any = {
          type: 'advanced_performance_monitoring',
          method: methodName,
          duration: Math.round(duration),
          threshold,
          startTime,
          endTime,
          status: 'success',
        };

        if (includeMemoryUsage && initialMemory && finalMemory) {
          performanceData.memory = {
            heapUsedDelta: finalMemory.heapUsed - initialMemory.heapUsed,
            heapTotalDelta: finalMemory.heapTotal - initialMemory.heapTotal,
            externalDelta: finalMemory.external - initialMemory.external,
            finalHeapUsed: finalMemory.heapUsed,
            finalHeapTotal: finalMemory.heapTotal,
          };
        }

        // Only log if threshold exceeded or if it's an info level log
        if (duration > threshold || logLevel === 'info') {
          switch (logLevel) {
            case 'info':
              logger.log(performanceData, 'Performance');
              break;
            case 'warn':
              logger.warn(performanceData, 'Performance');
              break;
            case 'error':
              logger.error(performanceData, undefined, 'Performance');
              break;
          }
        }

        return result;
      } catch (error) {
        const duration = performance.now() - start;

        logger.errorWithContext(error, {
          module: 'Performance',
          metadata: {
            method: methodName,
            duration: Math.round(duration),
            startTime,
            endTime: new Date().toISOString(),
          },
          severity: 'medium',
        });

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Helper interface for classes that want to sanitize arguments in performance logs
 */
export interface ArgumentSanitizer {
  sanitizeArgs(args: any[]): any[];
}
```

### Usage Examples

```typescript
// Basic usage
@Injectable()
export class UserService {
  constructor(private logger: LoggerService) {}

  @LogPerformance(1000) // Warn if > 1000ms
  async findUser(id: string): Promise<User> {
    // Method implementation
  }

  @LogPerformance(500, 'error') // Error level if > 500ms
  async criticalOperation(): Promise<void> {
    // Critical path implementation
  }
}

// Advanced usage with memory tracking
@Injectable()
export class DataProcessorService implements ArgumentSanitizer {
  constructor(private logger: LoggerService) {}

  sanitizeArgs(args: any[]): any[] {
    return args.map(arg => {
      if (arg && arg.password) {
        return { ...arg, password: '[REDACTED]' };
      }
      return arg;
    });
  }

  @LogAdvancedPerformance({
    threshold: 2000,
    includeMemoryUsage: true,
    sampleRate: 0.1, // Only log 10% of calls
  })
  async processBulkData(data: LargeDataSet): Promise<ProcessingResult> {
    // Implementation with automatic memory monitoring
  }
}
```

---

## Custom Error Handlers

### Global Exception Filter with Logger Integration

```typescript
// src/common/filters/global-exception.filter.ts
// or FastifyRequest, FastifyReply
import { LoggerService } from '@exitbook/shared-logger';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    // Log error with rich HTTP context
    this.logger.errorWithContext(exception, {
      module: 'GlobalExceptionFilter',
      metadata: {
        path: request.url,
        method: request.method,
        statusCode: status,
        userAgent: request.headers['user-agent'],
        ip: request.ip,
        body: this.sanitizeRequestBody(request.body),
        query: request.query,
        params: request.params,
      },
      severity: this.determineErrorSeverity(status),
    });

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: typeof message === 'string' ? message : (message as any).message || 'Unknown error',
    });
  }

  private determineErrorSeverity(statusCode: number): 'low' | 'medium' | 'high' | 'critical' {
    if (statusCode >= 500) return 'high';
    if (statusCode === 401 || statusCode === 403) return 'medium';
    return 'low';
  }

  private sanitizeRequestBody(body: any): any {
    if (!body || typeof body !== 'object') return body;

    const sanitized = { ...body };
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'authorization'];

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }
}
```

**Usage:**

```typescript
// In your main.ts or app module
app.useGlobalFilters(new GlobalExceptionFilter(logger));
```

---

## Background Job Logging

### Queue Job Processor with Correlation Tracking

```typescript
// src/jobs/processors/example.processor.ts
import { CorrelationService, LoggerService } from '@exitbook/shared-logger';
import { Process, Processor } from '@nestjs/bull';
// or your preferred queue library
import { Job } from 'bull';

@Processor('example-queue')
export class ExampleProcessor {
  constructor(
    private readonly logger: LoggerService,
    private readonly correlationService: CorrelationService
  ) {}

  @Process('process-data')
  async handleDataProcessing(job: Job<ProcessingJobData>): Promise<void> {
    const correlationId = `job_${job.id}`;

    return this.correlationService.setContext(correlationId, async () => {
      this.logger.log(
        {
          type: 'job_started',
          jobId: job.id,
          jobType: 'process-data',
          attempts: job.attemptsMade,
          data: this.sanitizeJobData(job.data),
          timestamp: new Date().toISOString(),
        },
        'JobProcessor'
      );

      try {
        const result = await this.processData(job.data);

        this.logger.log(
          {
            type: 'job_completed',
            jobId: job.id,
            duration: Date.now() - job.processedOn,
            result: this.sanitizeJobResult(result),
            timestamp: new Date().toISOString(),
          },
          'JobProcessor'
        );

        return result;
      } catch (error) {
        this.logger.errorWithContext(error, {
          module: 'JobProcessor',
          metadata: {
            jobId: job.id,
            jobType: 'process-data',
            attempts: job.attemptsMade + 1,
            data: this.sanitizeJobData(job.data),
            duration: Date.now() - job.processedOn,
          },
          severity: job.attemptsMade >= 2 ? 'high' : 'medium',
        });

        throw error; // Let the queue handle retries
      }
    });
  }

  private async processData(data: ProcessingJobData): Promise<ProcessingResult> {
    // Your job processing logic here
    this.logger.log('Processing job data...', 'JobProcessor');
    // Implementation details...
  }

  private sanitizeJobData(data: any): any {
    // Remove sensitive information from job data before logging
    const { password, token, ...sanitized } = data;
    return sanitized;
  }

  private sanitizeJobResult(result: any): any {
    // Sanitize result data for logging
    return result;
  }
}
```

### Scheduled Task Logging

```typescript
// src/tasks/scheduled-tasks.service.ts
import { CorrelationService, LoggerService } from '@exitbook/shared-logger';
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';

@Injectable()
export class ScheduledTasksService {
  constructor(
    private readonly logger: LoggerService,
    private readonly correlationService: CorrelationService
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async performHourlyCleanup(): Promise<void> {
    const correlationId = `task_${randomUUID()}`;

    return this.correlationService.setContext(correlationId, async () => {
      const startTime = Date.now();

      this.logger.log(
        {
          type: 'scheduled_task_started',
          taskName: 'hourlyCleanup',
          timestamp: new Date().toISOString(),
        },
        'ScheduledTasks'
      );

      try {
        const result = await this.runCleanupProcess();

        this.logger.log(
          {
            type: 'scheduled_task_completed',
            taskName: 'hourlyCleanup',
            duration: Date.now() - startTime,
            result,
            timestamp: new Date().toISOString(),
          },
          'ScheduledTasks'
        );
      } catch (error) {
        this.logger.errorWithContext(error, {
          module: 'ScheduledTasks',
          metadata: {
            taskName: 'hourlyCleanup',
            duration: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          },
          severity: 'high', // Scheduled task failures are important
        });

        // Optionally re-throw or handle the error based on your needs
      }
    });
  }

  private async runCleanupProcess(): Promise<{ itemsProcessed: number }> {
    // Your cleanup logic here
    this.logger.log('Running cleanup process...', 'ScheduledTasks');
    return { itemsProcessed: 42 };
  }
}
```

---

## Best Practices Summary

### 1. Dependency Management

- Keep integration patterns dependency-free in documentation
- Use framework-specific examples with clear dependency requirements
- Provide multiple framework variations (Express, Fastify, etc.)

### 2. Error Context Enrichment

- Always include relevant metadata in error contexts
- Use appropriate severity levels based on error types
- Sanitize sensitive information before logging

### 3. Performance Considerations

- Use sampling rates for high-volume operations
- Configure appropriate thresholds for different operation types
- Monitor memory usage for memory-intensive operations

### 4. Correlation Tracking

- Generate correlation IDs for all entry points (HTTP, jobs, scheduled tasks)
- Use meaningful correlation ID patterns (`req_123`, `job_456`, `task_789`)
- Ensure correlation context propagates through async operations

### 5. Security

- Always sanitize sensitive data (passwords, tokens, API keys)
- Be careful with request body logging in production
- Use redaction patterns for known sensitive fields
