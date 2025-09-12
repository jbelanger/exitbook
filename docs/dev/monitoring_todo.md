# Monitoring Implementation TODO

This document outlines the remaining tasks to complete the monitoring and
observability implementation.

## ✅ Completed

- [x] Core monitoring package with OpenTelemetry setup
- [x] Event store monitoring wrapper (moved to event-store package)
- [x] Messaging trace propagation (producer/consumer)
- [x] Outbox worker metrics implementation
- [x] Basic health monitor implementation
- [x] Docker monitoring stack (Grafana, Prometheus, Tempo, Loki)
- [x] Monitoring compose layers and exports

## 🔄 Database Monitoring

### Health Checks

- [ ] Wire up `DatabasePoolTag` dependency in health checks
- [ ] Uncomment and implement PostgreSQL health check in `health-checks.ts`
- [ ] Create `DatabaseHealthChecks` layer that provides database dependency
- [ ] Test database health check with actual connection failures

### Query Metrics

- [ ] Add database query monitoring wrapper to database layer
- [ ] Implement query duration tracking with `recordDatabaseQuery` helper
- [ ] Add database operation tracing with proper span attributes
- [ ] Include table names and operation types in metrics tags

**Implementation Location**: `packages/platform/database/src/monitoring.ts`

**Required Dependencies**:

```typescript
import { DatabasePoolTag } from '@exitbook/platform-database';
import { recordDatabaseQuery, traced } from '@exitbook/platform-monitoring';
```

## 🔄 HTTP Monitoring

### Middleware Implementation

- [ ] Create HTTP monitoring middleware for Express/Fastify
- [ ] Implement request duration tracking
- [ ] Add route extraction logic for proper metric tags
- [ ] Handle error cases and status code tracking
- [ ] Add tracing context propagation for HTTP requests

### Health Endpoints

- [ ] Implement `/health/live` endpoint in API application
- [ ] Implement `/health/ready` endpoint in API application
- [ ] Wire up health monitor dependency in API layer
- [ ] Add proper error handling and response formatting
- [ ] Document health endpoint behavior and responses

**Implementation Location**:

- `apps/api/src/middleware/monitoring.ts`
- `apps/api/src/routes/health.ts`

**Required Dependencies**:

```typescript
import {
  HealthMonitorTag,
  recordHttpRequest,
} from '@exitbook/platform-monitoring';
```

## 🔄 Message Broker Health Checks

### RabbitMQ Health Check

- [ ] Wire up `MessageTransportTag` dependency in health checks
- [ ] Implement message broker connectivity health check
- [ ] Add timeout and retry logic for broker health checks
- [ ] Test with actual RabbitMQ connection failures

**Implementation Location**: `packages/platform/monitoring/src/health-checks.ts`

## 🔄 Integration & Composition

### Layer Composition

- [ ] Create `CompleteHealthChecks` layer that includes all dependencies
- [ ] Update application composition to include health checks
- [ ] Ensure proper dependency injection for all health check components
- [ ] Test complete monitoring stack integration

### Application Integration

- [ ] Update `apps/api/src/main.ts` with complete monitoring setup
- [ ] Add monitoring middleware to HTTP server setup
- [ ] Configure health endpoints in application routing
- [ ] Add environment variable configuration for monitoring

**Example Integration**:

```typescript
const AppLive = Layer.mergeAll(
  NodeRuntime.layer,
  MonitoringDefault,
  CompleteHealthChecks, // <- New complete health checks
  UnifiedEventBusDefault,
  DatabaseDefault,
  MessageBusDefault,
);
```

## 🔄 Configuration & Documentation

### Environment Variables

- [ ] Document required environment variables for monitoring
- [ ] Add monitoring configuration to `.env.example`
- [ ] Create development vs production configuration examples
- [ ] Add service name and version configuration

### Docker Integration

- [ ] Update `infra/docker/compose.dev.yml` to include monitoring stack
- [ ] Add monitoring stack to development setup documentation
- [ ] Create production deployment configuration
- [ ] Add monitoring stack startup/shutdown scripts

### Testing

- [ ] Add unit tests for monitoring utilities
- [ ] Create integration tests for health checks
- [ ] Test monitoring with actual failures (database down, etc.)
- [ ] Verify metrics are properly exported to Prometheus

## 🔄 Advanced Features

### Custom Business Metrics

- [ ] Implement transaction amount tracking
- [ ] Add portfolio value monitoring
- [ ] Create custom dashboards for business KPIs
- [ ] Add alerting rules for business metrics

### Performance Optimization

- [ ] Review and optimize metric collection overhead
- [ ] Implement metric sampling for high-volume operations
- [ ] Add performance benchmarks for monitoring code
- [ ] Optimize trace sampling rates for production

### Security & Privacy

- [ ] Ensure sensitive data is not logged in traces
- [ ] Review metric labels for PII exposure
- [ ] Add authentication to monitoring endpoints
- [ ] Implement monitoring data retention policies

## Priority Order

1. **High Priority**: Database and HTTP health checks (needed for production
   readiness)
2. **Medium Priority**: Complete integration and application wiring
3. **Low Priority**: Advanced features and optimizations

## Notes

- Event store monitoring is already implemented and located in the event-store
  package (better architecture)
- Current implementation uses explicit OTEL exporters rather than NodeSdk
  abstractions (better control)
- Monitoring compose layers are already properly structured
- Docker monitoring stack is complete and ready for use
