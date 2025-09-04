# Logger Module Testing TODO

This document outlines the comprehensive testing strategy needed to validate the enhanced logger module functionality from start to finish.

## Testing Architecture Overview

### Test Categories

- **Unit Tests**: Individual service/method behavior
- **Integration Tests**: Module interaction and configuration
- **E2E Tests**: Real-world usage scenarios
- **Performance Tests**: Overhead and throughput validation

### Test Framework

- **Vitest**: Primary testing framework (already configured)
- **@nestjs/testing**: NestJS testing utilities
- **Test Doubles**: Manual mocks for external dependencies

---

## 1. Core Service Unit Tests

### 1.1 CorrelationService Tests (`correlation.service.spec.ts`)

#### Basic Functionality

- [ ] `getId()` returns undefined when no context is set
- [ ] `getId()` returns correct correlation ID when context is set
- [ ] `getTraceContext()` returns undefined when no trace context
- [ ] `getTraceContext()` returns correct trace context when set
- [ ] `getContext()` returns complete correlation context

#### Context Management

- [ ] `setContext()` properly isolates correlation ID in async context
- [ ] `withId()` preserves existing context if correlation ID matches
- [ ] `withId()` creates new context if correlation ID differs
- [ ] `withContext()` handles full correlation context with trace data
- [ ] Context properly propagates through nested async operations

#### OpenTelemetry Integration

- [ ] `setContextFromActiveSpan()` extracts trace context from active span
- [ ] `setContextFromActiveSpan()` handles missing active span gracefully
- [ ] `extractTraceContext()` correctly maps SpanContext to TraceContext
- [ ] Trace context includes traceId and spanId correctly

#### Edge Cases

- [ ] Multiple concurrent contexts don't interfere with each other
- [ ] Context cleanup happens properly after execution
- [ ] Nested context calls preserve parent context correctly
- [ ] Exception handling doesn't leak context

### 1.2 LoggerService Tests (`logger.service.spec.ts`)

#### NestJS Logger Interface Compliance

- [ ] `log()` method formats message correctly and calls appropriate pino method
- [ ] `error()` method handles string messages with trace information
- [ ] `error()` method handles object messages with trace information
- [ ] `warn()` method formats and logs warning messages
- [ ] `debug()` method maps to pino debug level
- [ ] `verbose()` method maps to pino trace level

#### Enhanced Error Logging

- [ ] `errorWithContext()` logs Error objects with full stack trace
- [ ] `errorWithContext()` logs non-Error values as string messages
- [ ] `errorWithContext()` includes correlation ID from context
- [ ] `errorWithContext()` includes trace context when available
- [ ] `errorWithContext()` applies provided ErrorContext metadata
- [ ] `errorWithContext()` generates stable error fingerprints
- [ ] `errorWithContext()` calculates severity correctly

#### Logger Cache Management

- [ ] `getLogger()` caches logger instances by category
- [ ] `getLogger()` returns same instance for identical categories
- [ ] Logger instances have correct category and categoryLabel
- [ ] Child loggers inherit root logger configuration

#### Mixin Functionality

- [ ] Logger mixin includes correlation ID when present
- [ ] Logger mixin includes trace context (traceId, spanId) when available
- [ ] Logger mixin returns empty object when no context
- [ ] Logger mixin handles parentSpanId correctly

#### Error Severity Classification

- [ ] `calculateSeverity()` returns 'critical' for memory/system errors
- [ ] `calculateSeverity()` returns 'high' for network/database errors
- [ ] `calculateSeverity()` returns 'low' for validation/not found errors
- [ ] `calculateSeverity()` returns 'medium' for unknown error types
- [ ] `calculateSeverity()` handles non-Error objects correctly

#### Error Fingerprinting

- [ ] `generateErrorFingerprint()` creates stable hashes for same errors
- [ ] `generateErrorFingerprint()` creates different hashes for different errors
- [ ] `generateErrorFingerprint()` handles Error objects with stack traces
- [ ] `generateErrorFingerprint()` handles non-Error objects

#### Error Escalation

- [ ] `escalateError()` is called for critical severity errors
- [ ] `escalateError()` logs escalation information correctly
- [ ] Error escalation doesn't interfere with normal error logging

### 1.3 LoggerModule Tests (`logger.module.spec.ts`)

#### Static Module Configuration

- [ ] `forRoot()` with empty config uses environment defaults
- [ ] `forRoot()` with partial config merges with environment defaults
- [ ] `forRoot()` validates final configuration
- [ ] `forRoot()` provides LoggerService and CorrelationService
- [ ] `forRoot()` creates LOGGER_CONFIG injection token

#### Async Module Configuration

- [ ] `forRootAsync()` with useFactory resolves configuration correctly
- [ ] `forRootAsync()` validates configuration from factory
- [ ] `forRootAsync()` handles factory dependencies injection
- [ ] `forRootAsync()` provides all required services

#### Module Provider Structure

- [ ] LoggerService gets injected with LOGGER_CONFIG
- [ ] CorrelationService is available as global provider
- [ ] Module exports all necessary services
- [ ] Global module registration works correctly

---

## 2. Configuration and Environment Tests

### 2.1 Environment Schema Tests (`environment.schema.spec.ts`)

#### Schema Validation

- [ ] `validateLoggerEnvironment()` accepts valid environment values
- [ ] `validateLoggerEnvironment()` rejects invalid log levels
- [ ] `validateLoggerEnvironment()` rejects invalid boolean values
- [ ] `validateLoggerEnvironment()` rejects invalid number values
- [ ] `validateLoggerEnvironment()` provides helpful error messages

#### Default Value Handling

- [ ] Missing environment variables use schema defaults
- [ ] Empty string values are handled correctly
- [ ] Invalid values trigger validation errors

### 2.2 Logger Configuration Tests (`logger.config.spec.ts`)

#### Configuration Validation

- [ ] `validateLoggerConfig()` accepts complete valid configuration
- [ ] `validateLoggerConfig()` accepts partial configuration with defaults
- [ ] `validateLoggerConfig()` rejects invalid service names
- [ ] `validateLoggerConfig()` rejects invalid file paths
- [ ] `validateLoggerConfig()` validates retention day values

#### Environment Integration

- [ ] Configuration merges environment variables correctly
- [ ] Configuration overrides work as expected
- [ ] Configuration validation catches environment/override conflicts

---

## 3. Integration Tests

### 3.1 Logger Service Integration (`logger.integration.spec.ts`)

#### Real Pino Integration

- [ ] Logger actually creates pino instances with correct configuration
- [ ] Log messages are properly formatted and output
- [ ] Different log levels produce appropriate pino output
- [ ] Audit logging writes to files when enabled
- [ ] Transport configuration works in development vs production

#### Correlation Context Integration

- [ ] Logs automatically include correlation IDs from CorrelationService
- [ ] Trace context properly appears in log output
- [ ] Multiple concurrent requests maintain separate contexts
- [ ] Async operations preserve correlation context

#### File System Integration

- [ ] Audit log directory creation works correctly
- [ ] Log files are created with correct naming patterns
- [ ] File rotation and retention policies work
- [ ] Insufficient permissions are handled gracefully

### 3.2 Module Integration (`module.integration.spec.ts`)

#### NestJS Module System

- [ ] Module registers correctly in NestJS application
- [ ] Services can be injected into other modules
- [ ] Global module export makes services available everywhere
- [ ] Module configuration is isolated per application instance

#### Dependency Injection

- [ ] LoggerService receives correct LOGGER_CONFIG
- [ ] CorrelationService is properly injected into LoggerService
- [ ] Custom configuration factories work with ConfigService
- [ ] Module works with other NestJS testing utilities

---

## 4. Recipe Integration Tests

### 4.1 LoggingInterceptor Tests (`recipes/logging.interceptor.spec.ts`)

#### HTTP Context Handling

- [ ] Interceptor only processes HTTP execution contexts
- [ ] Non-HTTP contexts are passed through unchanged
- [ ] Request and response objects are extracted correctly

#### Correlation ID Management

- [ ] Extracts correlation ID from x-correlation-id header
- [ ] Extracts correlation ID from x-request-id header
- [ ] Generates new correlation ID when none provided
- [ ] Correlation ID is properly set in correlation service context

#### Request Logging

- [ ] Logs request start with correct metadata (method, URL, IP, user-agent)
- [ ] Logs successful request completion with timing and status code
- [ ] Estimates response size correctly for different data types
- [ ] Handles missing request headers gracefully

#### Error Handling

- [ ] Catches and logs errors with rich HTTP context
- [ ] Determines error severity based on HTTP status codes
- [ ] Re-throws errors to maintain normal error handling flow
- [ ] Error context includes request metadata

#### OpenTelemetry Integration

- [ ] Uses `setContextFromActiveSpan()` for automatic trace extraction
- [ ] Trace context propagates through request processing
- [ ] Works correctly when OpenTelemetry is not configured

### 4.2 Performance Decorator Tests (`recipes/performance.decorator.spec.ts`)

#### Basic LogPerformance Decorator

- [ ] Measures execution time for synchronous methods
- [ ] Measures execution time for asynchronous methods
- [ ] Logs warnings when execution exceeds threshold
- [ ] Logs successful executions for monitoring
- [ ] Handles method exceptions correctly while preserving performance data

#### Advanced Performance Decorator

- [ ] Respects sampling rate configuration (tests with 0.0 and 1.0)
- [ ] Includes memory usage delta when configured
- [ ] Uses different log levels based on configuration
- [ ] Works with custom threshold values

#### Argument Sanitization

- [ ] Calls sanitizeArgs method when available on target object
- [ ] Handles missing sanitizeArgs method gracefully
- [ ] Sanitized arguments appear in performance logs

#### Error Cases

- [ ] Handles missing LoggerService gracefully
- [ ] Warns when LoggerService is not properly injected
- [ ] Decorator works when applied to methods without logger

---

## 5. End-to-End Tests

### 5.1 Complete Request Lifecycle (`e2e/request-lifecycle.spec.ts`)

#### Full Integration Scenario

- [ ] HTTP request with LoggingInterceptor generates correlation ID
- [ ] Service methods with performance decorators log timing
- [ ] Error scenarios trigger errorWithContext logging
- [ ] All logs contain consistent correlation ID throughout request
- [ ] Trace context propagates when OpenTelemetry is active

#### Multi-Request Scenarios

- [ ] Concurrent requests maintain separate correlation contexts
- [ ] Requests with different correlation headers are handled correctly
- [ ] Background tasks can establish their own correlation contexts

### 5.2 Module Lifecycle (`e2e/module-lifecycle.spec.ts`)

#### Application Bootstrap

- [ ] Logger module initializes correctly in full NestJS application
- [ ] Configuration is loaded from environment variables
- [ ] Services are available for injection across all modules
- [ ] Audit logging starts working immediately if enabled

#### Configuration Changes

- [ ] Dynamic configuration changes work with forRootAsync
- [ ] Configuration validation prevents invalid setups
- [ ] Module handles configuration errors gracefully

---

## 6. Performance Tests

### 6.1 Logging Performance (`perf/logging.perf.spec.ts`)

#### Throughput Tests

- [ ] Basic logging throughput under high volume (target: >10,000 logs/sec)
- [ ] Correlation context overhead is minimal (<10% performance impact)
- [ ] Logger cache provides performance benefit vs creating new instances
- [ ] Memory usage remains stable under sustained logging

#### AsyncLocalStorage Performance

- [ ] Correlation context operations are fast (<0.1ms overhead)
- [ ] Nested context operations don't degrade exponentially
- [ ] Context cleanup doesn't cause memory leaks
- [ ] Concurrent context operations scale linearly

### 6.2 Error Logging Performance (`perf/error-logging.perf.spec.ts`)

#### Error Processing Overhead

- [ ] Error fingerprinting is fast enough for high error volumes
- [ ] Severity calculation doesn't significantly impact logging speed
- [ ] Large error objects don't cause performance degradation
- [ ] Stack trace processing overhead is acceptable

---

## 7. Mock and Test Utilities

### 7.1 Test Utilities (`test/test-utils.ts`)

#### Mock Implementations

- [ ] Create MockCorrelationService for isolated LoggerService testing
- [ ] Create MockLoggerService for testing consumers
- [ ] Create OpenTelemetry span/trace mocks for tracing tests
- [ ] Create Express request/response mocks for interceptor tests

#### Test Helpers

- [ ] Helper to capture pino log output for assertions
- [ ] Helper to set up correlation context for tests
- [ ] Helper to create test NestJS modules with logger configuration
- [ ] Helper to validate log message structure and content

### 7.2 Test Data (`test/fixtures.ts`)

#### Test Fixtures

- [ ] Sample error objects with different types and severities
- [ ] Sample HTTP requests with various headers and metadata
- [ ] Sample correlation contexts with and without trace information
- [ ] Configuration objects for different testing scenarios

---

## 8. Testing Infrastructure Setup

### 8.1 Vitest Configuration (`vitest.config.ts`)

#### Test Environment Setup

- [ ] Configure Node.js environment for AsyncLocalStorage
- [ ] Set up TypeScript compilation for test files
- [ ] Configure test file patterns and exclusions
- [ ] Enable code coverage reporting

### 8.2 Test Scripts and CI Integration

#### Package.json Scripts

- [ ] `test` - Run all unit and integration tests
- [ ] `test:unit` - Run only unit tests
- [ ] `test:integration` - Run only integration tests
- [ ] `test:e2e` - Run end-to-end tests
- [ ] `test:perf` - Run performance tests
- [ ] `test:coverage` - Generate coverage reports
- [ ] `test:watch` - Run tests in watch mode

---

## Testing Implementation Priority

### Phase 1: Core Foundation (Essential)

1. **CorrelationService unit tests** - Core functionality validation
2. **LoggerService unit tests** - Main service behavior
3. **Configuration tests** - Ensure proper setup and validation

### Phase 2: Integration Validation (High Priority)

4. **Logger service integration** - Real pino interaction
5. **Module integration** - NestJS dependency injection
6. **Basic recipe tests** - Interceptor and decorator functionality

### Phase 3: Advanced Scenarios (Medium Priority)

7. **End-to-end tests** - Complete request lifecycle
8. **Performance tests** - Overhead validation
9. **Edge case handling** - Error scenarios and recovery

### Phase 4: Production Readiness (Nice to Have)

10. **Test utilities and helpers** - Developer experience
11. **CI integration** - Automated testing pipeline
12. **Coverage reporting** - Quality metrics

---

## Success Criteria

- **Unit Test Coverage**: >90% for core services
- **Integration Test Coverage**: All major interaction paths tested
- **Performance Requirements**: <1ms logging overhead, <0.1ms correlation overhead
- **Error Handling**: All error scenarios covered with appropriate recovery
- **Documentation**: All test files include clear descriptions of what they validate

This testing strategy ensures comprehensive validation of the enhanced logger module functionality while providing confidence for production deployment.
