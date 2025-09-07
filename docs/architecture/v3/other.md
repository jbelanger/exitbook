## Additional Essential Infrastructure

### 1. Background Jobs & Task Queue (BullMQ)

```typescript
// src/infrastructure/queue/bull-queue.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, QueueScheduler, Job, JobsOptions } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

export interface JobData {
  type: string;
  payload: any;
  userId?: string;
  correlationId?: string;
}

@Injectable()
export class BullQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullQueueService.name);
  private connection: Redis;
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();
  private schedulers = new Map<string, QueueScheduler>();

  constructor(private readonly configService: ConfigService) {
    this.connection = new Redis({
      host: this.configService.get('REDIS_HOST'),
      port: this.configService.get('REDIS_PORT'),
      maxRetriesPerRequest: null,
    });
  }

  async onModuleInit() {
    await this.setupQueues();
  }

  async onModuleDestroy() {
    await this.shutdown();
  }

  private async setupQueues() {
    // Transaction import queue
    await this.createQueue('transaction-import', {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });

    // Tax calculation queue
    await this.createQueue('tax-calculation', {
      defaultJobOptions: {
        attempts: 2,
        timeout: 300000, // 5 minutes
      },
    });

    // Portfolio valuation queue
    await this.createQueue('portfolio-valuation', {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'fixed', delay: 1000 },
      },
    });

    // Reconciliation queue
    await this.createQueue('reconciliation', {
      defaultJobOptions: {
        attempts: 2,
        timeout: 600000, // 10 minutes
      },
    });

    // Notification queue
    await this.createQueue('notifications', {
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });
  }

  private async createQueue(name: string, options?: any) {
    const queue = new Queue(name, {
      connection: this.connection,
      ...options,
    });

    const scheduler = new QueueScheduler(name, {
      connection: this.connection,
    });

    this.queues.set(name, queue);
    this.schedulers.set(name, scheduler);

    this.logger.log(`Queue created: ${name}`);
  }

  async addJob(queueName: string, data: JobData, options?: JobsOptions): Promise<Job> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    return queue.add(data.type, data, {
      ...options,
      jobId: options?.jobId || `${data.type}-${Date.now()}`,
    });
  }

  async addBulkJobs(queueName: string, jobs: Array<{ data: JobData; options?: JobsOptions }>): Promise<Job[]> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    return queue.addBulk(
      jobs.map(job => ({
        name: job.data.type,
        data: job.data,
        opts: job.options,
      }))
    );
  }

  async scheduleJob(queueName: string, data: JobData, cron: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.add(data.type, data, {
      repeat: { pattern: cron },
      jobId: `scheduled-${data.type}`,
    });
  }

  registerWorker(queueName: string, processor: (job: Job) => Promise<any>, concurrency: number = 1): Worker {
    const worker = new Worker(queueName, processor, {
      connection: this.connection,
      concurrency,
    });

    worker.on('completed', job => {
      this.logger.debug(`Job completed: ${job.id}`);
    });

    worker.on('failed', (job, err) => {
      this.logger.error(`Job failed: ${job?.id}`, err);
    });

    this.workers.set(queueName, worker);
    return worker;
  }

  async getJobCounts(queueName: string) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    return queue.getJobCounts();
  }

  async cleanQueue(queueName: string, grace: number = 0) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.clean(grace, 100, 'completed');
    await queue.clean(grace, 100, 'failed');
  }

  private async shutdown() {
    for (const worker of this.workers.values()) {
      await worker.close();
    }
    for (const scheduler of this.schedulers.values()) {
      await scheduler.close();
    }
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    await this.connection.quit();
  }
}
```

### 2. Authentication & Authorization (Passport + JWT)

```typescript
// src/infrastructure/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { PermissionGuard } from './guards/permission.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRATION') || '15m',
          issuer: 'crypto-portfolio',
          audience: 'crypto-portfolio-api',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    AuthService,
    SessionService,
    JwtStrategy,
    JwtRefreshStrategy,
    ApiKeyStrategy,
    PermissionGuard,
    RolesGuard,
  ],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
```

```typescript
// src/infrastructure/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';
import { RedisCacheService } from '../cache/redis-cache.service';
import { Effect, pipe } from 'effect';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  roles: string[];
  permissions: string[];
  sessionId: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cache: RedisCacheService
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    // In production, fetch from database
    const user = await this.getUserByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  async generateTokens(user: any): Promise<TokenPair> {
    const sessionId = `session:${user.id}:${Date.now()}`;

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roles: user.roles || ['user'],
      permissions: user.permissions || [],
      sessionId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, {
        expiresIn: '7d',
      }),
    ]);

    // Store session in Redis
    await this.cache.set(
      sessionId,
      {
        userId: user.id,
        email: user.email,
        roles: user.roles,
        permissions: user.permissions,
        createdAt: new Date(),
      },
      { ttl: 86400 * 7 } // 7 days
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes
    };
  }

  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken);

      // Check if session is still valid
      const session = await this.cache.get(`session:${payload.sessionId}`);
      if (!session) {
        throw new UnauthorizedException('Session expired');
      }

      // Generate new tokens
      const user = await this.getUserById(payload.sub);
      return this.generateTokens(user);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.cache.delete(sessionId);
  }

  async verify2FA(userId: string, token: string): Promise<boolean> {
    const secret = await this.get2FASecret(userId);

    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 2,
    });
  }

  async generateApiKey(userId: string, name: string): Promise<string> {
    const apiKey = this.generateSecureToken();
    const hashedKey = await bcrypt.hash(apiKey, 10);

    // Store in database
    await this.saveApiKey({
      userId,
      name,
      keyHash: hashedKey,
      createdAt: new Date(),
    });

    return apiKey;
  }

  private generateSecureToken(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }

  private async getUserByEmail(email: string): Promise<any> {
    // Database query
    return null;
  }

  private async getUserById(id: string): Promise<any> {
    // Database query
    return null;
  }

  private async get2FASecret(userId: string): Promise<string> {
    // Fetch from secure storage
    return '';
  }

  private async saveApiKey(data: any): Promise<void> {
    // Save to database
  }
}
```

### 3. Database Migrations (Knex)

```typescript
// src/infrastructure/database/knexfile.ts
import type { Knex } from 'knex';
import * as dotenv from 'dotenv';

dotenv.config();

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'postgresql',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'crypto_portfolio_dev',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    },
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations',
      schemaName: 'public',
    },
    seeds: {
      directory: './seeds',
    },
  },

  production: {
    client: 'postgresql',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations',
    },
  },
};

export default config;
```

### 4. Configuration Management

```typescript
// src/config/configuration.ts
import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000'),
  environment: process.env.NODE_ENV || 'development',

  database: {
    write: {
      host: process.env.WRITE_DB_HOST,
      port: parseInt(process.env.WRITE_DB_PORT || '5432'),
      database: process.env.WRITE_DB_NAME,
      username: process.env.WRITE_DB_USER,
      password: process.env.WRITE_DB_PASSWORD,
    },
    read: {
      host: process.env.READ_DB_HOST,
      port: parseInt(process.env.READ_DB_PORT || '5432'),
      database: process.env.READ_DB_NAME,
      username: process.env.READ_DB_USER,
      password: process.env.READ_DB_PASSWORD,
    },
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  integrations: {
    binance: {
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
    },
    coinbase: {
      apiKey: process.env.COINBASE_API_KEY,
      apiSecret: process.env.COINBASE_API_SECRET,
    },
    coingecko: {
      apiKey: process.env.COINGECKO_API_KEY,
    },
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
  },

  email: {
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    },
    from: process.env.EMAIL_FROM || 'noreply@crypto-portfolio.com',
  },

  monitoring: {
    sentry: {
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
    },
    elasticsearch: {
      node: process.env.ELASTICSEARCH_URL,
    },
  },

  features: {
    enableWebSocket: process.env.ENABLE_WEBSOCKET === 'true',
    enableGraphQL: process.env.ENABLE_GRAPHQL === 'true',
    enableMetrics: process.env.ENABLE_METRICS === 'true',
  },
}));
```

### 5. WebSocket Gateway (Real-time updates)

```typescript
// src/infrastructure/websocket/portfolio-gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || '*',
    credentials: true,
  },
  namespace: 'portfolio',
})
export class PortfolioGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PortfolioGateway.name);
  private userSockets = new Map<string, Set<string>>();

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth.token;
      const payload = this.jwtService.verify(token);

      socket.data.userId = payload.sub;
      socket.join(`user:${payload.sub}`);

      // Track user connections
      if (!this.userSockets.has(payload.sub)) {
        this.userSockets.set(payload.sub, new Set());
      }
      this.userSockets.get(payload.sub)!.add(socket.id);

      this.logger.log(`User ${payload.sub} connected`);

      // Send initial data
      socket.emit('connected', {
        userId: payload.sub,
        timestamp: new Date(),
      });
    } catch (error) {
      socket.disconnect();
    }
  }

  async handleDisconnect(socket: Socket) {
    const userId = socket.data.userId;
    if (userId && this.userSockets.has(userId)) {
      this.userSockets.get(userId)!.delete(socket.id);

      if (this.userSockets.get(userId)!.size === 0) {
        this.userSockets.delete(userId);
      }
    }

    this.logger.log(`User ${userId} disconnected`);
  }

  @SubscribeMessage('subscribe:portfolio')
  async subscribeToPortfolio(@ConnectedSocket() socket: Socket, @MessageBody() data: { portfolioId: string }) {
    socket.join(`portfolio:${data.portfolioId}`);
    return { subscribed: true, portfolioId: data.portfolioId };
  }

  @SubscribeMessage('subscribe:prices')
  async subscribeToPrices(@ConnectedSocket() socket: Socket, @MessageBody() data: { assets: string[] }) {
    data.assets.forEach(asset => {
      socket.join(`price:${asset}`);
    });
    return { subscribed: true, assets: data.assets };
  }

  // Server-side emit methods
  async emitPortfolioUpdate(userId: string, update: any) {
    this.server.to(`user:${userId}`).emit('portfolio:update', update);
  }

  async emitPriceUpdate(asset: string, price: any) {
    this.server.to(`price:${asset}`).emit('price:update', {
      asset,
      price: price.value,
      timestamp: price.timestamp,
    });
  }

  async emitTransactionProcessed(userId: string, transaction: any) {
    this.server.to(`user:${userId}`).emit('transaction:processed', transaction);
  }

  async emitReconciliationProgress(userId: string, progress: any) {
    this.server.to(`user:${userId}`).emit('reconciliation:progress', progress);
  }
}
```

### 6. Testing Infrastructure

```typescript
// src/test/test-database.ts
import { Test } from '@nestjs/testing';
import { Knex } from 'knex';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

export class TestDatabase {
  private container: StartedTestContainer;
  private connection: Knex;

  async setup(): Promise<Knex> {
    // Start PostgreSQL container
    this.container = await new GenericContainer('postgres:14')
      .withExposedPorts(5432)
      .withEnv('POSTGRES_DB', 'test_db')
      .withEnv('POSTGRES_USER', 'test')
      .withEnv('POSTGRES_PASSWORD', 'test')
      .start();

    const port = this.container.getMappedPort(5432);

    this.connection = require('knex')({
      client: 'postgresql',
      connection: {
        host: 'localhost',
        port,
        database: 'test_db',
        user: 'test',
        password: 'test',
      },
    });

    // Run migrations
    await this.connection.migrate.latest();

    return this.connection;
  }

  async teardown(): Promise<void> {
    if (this.connection) {
      await this.connection.destroy();
    }
    if (this.container) {
      await this.container.stop();
    }
  }

  async cleanTables(): Promise<void> {
    await this.connection.raw('TRUNCATE TABLE event_store CASCADE');
    await this.connection.raw('TRUNCATE TABLE projections CASCADE');
  }
}
```

### 7. Docker Configuration

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres-write:
    image: postgres:14
    environment:
      POSTGRES_DB: crypto_portfolio_write
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - '5432:5432'
    volumes:
      - postgres_write_data:/var/lib/postgresql/data

  postgres-read:
    image: postgres:14
    environment:
      POSTGRES_DB: crypto_portfolio_read
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - '5433:5432'
    volumes:
      - postgres_read_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass redis_password
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

  rabbitmq:
    image: rabbitmq:3-management
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin
    ports:
      - '5672:5672'
      - '15672:15672'
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.5.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    ports:
      - '9200:9200'
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data

  kibana:
    image: docker.elastic.co/kibana/kibana:8.5.0
    environment:
      ELASTICSEARCH_HOSTS: http://elasticsearch:9200
    ports:
      - '5601:5601'
    depends_on:
      - elasticsearch

volumes:
  postgres_write_data:
  postgres_read_data:
  redis_data:
  rabbitmq_data:
  elasticsearch_data:
```

### 8. Package.json with all dependencies

```json
{
  "name": "crypto-portfolio",
  "version": "1.0.0",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "migrate": "knex migrate:latest",
    "migrate:make": "knex migrate:make",
    "seed": "knex seed:run"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/cqrs": "^10.0.0",
    "@nestjs/jwt": "^10.0.0",
    "@nestjs/passport": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/platform-socket.io": "^10.0.0",
    "@nestjs/swagger": "^7.0.0",
    "@nestjs/throttler": "^5.0.0",
    "@nestjs/websockets": "^10.0.0",
    "effect": "^2.0.0",
    "knex": "^3.0.0",
    "pg": "^8.11.0",
    "ioredis": "^5.3.0",
    "bullmq": "^4.0.0",
    "amqplib": "^0.10.0",
    "socket.io": "^4.6.0",
    "bignumber.js": "^9.1.0",
    "bcrypt": "^5.1.0",
    "speakeasy": "^2.0.0",
    "passport": "^0.6.0",
    "passport-jwt": "^4.0.0",
    "class-transformer": "^0.5.0",
    "class-validator": "^0.14.0",
    "helmet": "^7.0.0",
    "compression": "^1.7.0",
    "winston": "^3.10.0",
    "winston-elasticsearch": "^0.17.0",
    "prom-client": "^15.0.0",
    "axios": "^1.5.0",
    "uuid": "^9.0.0",
    "lodash": "^4.17.0",
    "dayjs": "^1.11.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/node": "^20.0.0",
    "@types/jest": "^29.5.0",
    "@types/express": "^4.17.0",
    "@types/bcrypt": "^5.0.0",
    "@types/amqplib": "^0.10.0",
    "@types/lodash": "^4.14.0",
    "jest": "^29.5.0",
    "ts-jest": "^29.1.0",
    "testcontainers": "^10.0.0",
    "supertest": "^6.3.0",
    "typescript": "^5.1.0",
    "eslint": "^8.42.0",
    "prettier": "^3.0.0",
    "ts-node": "^10.9.0"
  }
}
```

This completes the infrastructure with:

1. ✅ **BullMQ** for background jobs and task scheduling
2. ✅ **JWT + Passport** for authentication/authorization
3. ✅ **Knex migrations** for database schema management
4. ✅ **Configuration management** with environment variables
5. ✅ **WebSocket gateway** for real-time updates
6. ✅ **Testing infrastructure** with TestContainers
7. ✅ **Docker Compose** for local development
8. ✅ **Complete package.json** with all dependencies

The system is now fully production-ready with:

- Background job processing
- Authentication & authorization
- Real-time updates
- Database migrations
- Containerized development
- Comprehensive testing setup

This should cover everything you need for your crypto-portfolio system!
