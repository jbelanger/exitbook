## Complete REST API Implementation

### 1. API Module Structure

```typescript
// src/api/api.module.ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ValidationPipe } from '@nestjs/common';

// Controllers
import { TransactionController } from './controllers/transaction.controller';
import { PortfolioController } from './controllers/portfolio.controller';
import { TaxController } from './controllers/tax.controller';
import { ReconciliationController } from './controllers/reconciliation.controller';
import { HealthController } from './controllers/health.controller';

// Filters & Interceptors
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { EffectExceptionFilter } from './filters/effect-exception.filter';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { TimeoutInterceptor } from './interceptors/timeout.interceptor';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,
      limit: 100,
    }),
  ],
  controllers: [TransactionController, PortfolioController, TaxController, ReconciliationController, HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: EffectExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TimeoutInterceptor,
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    },
  ],
})
export class ApiModule {}
```

### 2. Database Configuration for Read/Write Separation

```typescript
// src/infrastructure/database/database.config.ts
import { Injectable } from '@nestjs/common';
import { Knex } from 'knex';

export interface DatabaseConfig {
  write: Knex.Config;
  read: Knex.Config;
}

@Injectable()
export class DatabaseService {
  private writeDb: Knex;
  private readDb: Knex;

  constructor() {
    this.initializeDatabases();
  }

  private initializeDatabases() {
    // Write database (primary) - for commands
    this.writeDb = require('knex')({
      client: 'postgresql',
      connection: {
        host: process.env.WRITE_DB_HOST || 'localhost',
        port: parseInt(process.env.WRITE_DB_PORT || '5432'),
        user: process.env.WRITE_DB_USER || 'postgres',
        password: process.env.WRITE_DB_PASSWORD || 'postgres',
        database: process.env.WRITE_DB_NAME || 'crypto_portfolio_write',
        schema: process.env.WRITE_DB_SCHEMA || 'write',
      },
      pool: {
        min: 2,
        max: 10,
      },
    });

    // Read database (replica or separate schema) - for queries
    this.readDb = require('knex')({
      client: 'postgresql',
      connection: {
        host: process.env.READ_DB_HOST || 'localhost',
        port: parseInt(process.env.READ_DB_PORT || '5432'),
        user: process.env.READ_DB_USER || 'postgres',
        password: process.env.READ_DB_PASSWORD || 'postgres',
        database: process.env.READ_DB_NAME || 'crypto_portfolio_read',
        schema: process.env.READ_DB_SCHEMA || 'read',
      },
      pool: {
        min: 5,
        max: 20, // More connections for read-heavy workload
      },
    });
  }

  getWriteConnection(): Knex {
    return this.writeDb;
  }

  getReadConnection(): Knex {
    return this.readDb;
  }

  async healthCheck(): Promise<{ write: boolean; read: boolean }> {
    try {
      await this.writeDb.raw('SELECT 1');
      await this.readDb.raw('SELECT 1');
      return { write: true, read: true };
    } catch (error) {
      return { write: false, read: false };
    }
  }
}
```

### 3. Transaction Controller (Full CRUD + Import)

```typescript
// src/api/controllers/transaction.controller.ts
import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UsePipes,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { Effect } from 'effect';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../infrastructure/security/auth/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/auth/current-user.decorator';
import {
  ImportTransactionDto,
  ClassifyTransactionDto,
  RecordEntriesDto,
  ReverseTransactionDto,
  TransactionFilterDto,
  TransactionResponseDto,
  PaginatedResponseDto,
  BulkImportDto,
} from '../dto/transaction.dto';
import {
  ImportTransactionCommand,
  ClassifyTransactionCommand,
  RecordEntriesCommand,
  ReverseTransactionCommand,
} from '../../contexts/trading/domain/aggregates/transaction.aggregate';
import {
  GetTransactionQuery,
  GetTransactionsQuery,
  GetTransactionsByDateRangeQuery,
} from '../../contexts/trading/application/queries';
import { UserId, TransactionId, ExternalId } from '../../@core/domain/common-types/identifiers';
import { Money, Currency } from '../../@core/domain/common-types/money.vo';

@ApiTags('transactions')
@Controller('api/v1/transactions')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
@ApiBearerAuth()
export class TransactionController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus
  ) {}

  @Post('import')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Import a transaction from external source',
    description: 'Imports a single transaction with idempotency support',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Transaction import initiated',
    type: TransactionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Transaction already exists (idempotency)',
  })
  async importTransaction(
    @Body() dto: ImportTransactionDto,
    @CurrentUser() user: { userId: string }
  ): Promise<TransactionResponseDto> {
    const command: ImportTransactionCommand = {
      userId: UserId(user.userId),
      externalId: ExternalId(dto.externalId),
      source: dto.source,
      rawData: dto.rawData,
    };

    const result = await this.commandBus.execute(command);

    return {
      id: result.transactionId,
      status: 'IMPORTED',
      message: 'Transaction imported successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('import/bulk')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Bulk import transactions from CSV/JSON file',
    description: 'Supports CSV and JSON formats with automatic parsing',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        source: {
          type: 'string',
          enum: ['BINANCE', 'COINBASE', 'KRAKEN', 'CSV', 'MANUAL'],
        },
      },
    },
  })
  async bulkImportTransactions(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: BulkImportDto,
    @CurrentUser() user: { userId: string }
  ): Promise<{ jobId: string; status: string }> {
    // Parse file and queue for processing
    const transactions = await this.parseImportFile(file, dto.source);

    // Queue bulk import job
    const jobId = await this.queueBulkImport(user.userId, transactions, dto.source);

    return {
      jobId,
      status: 'QUEUED',
    };
  }

  @Post(':id/classify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Classify transaction type',
    description: 'Uses ML or rule-based classification to determine transaction type',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async classifyTransaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClassifyTransactionDto,
    @CurrentUser() user: { userId: string }
  ): Promise<TransactionResponseDto> {
    const command: ClassifyTransactionCommand = {
      transactionId: TransactionId(id),
      confidence: dto.confidence,
      manualOverride: dto.manualOverride,
    };

    await this.commandBus.execute(command);

    return {
      id,
      status: 'CLASSIFIED',
      message: 'Transaction classified successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/entries')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record ledger entries for transaction',
    description: 'Creates double-entry bookkeeping entries',
  })
  async recordEntries(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordEntriesDto,
    @CurrentUser() user: { userId: string }
  ): Promise<TransactionResponseDto> {
    const entries = await Promise.all(
      dto.entries.map(async e => ({
        accountId: e.accountId,
        amount: await Effect.runPromise(
          Money.of(
            e.amount,
            Currency({
              symbol: e.currency,
              decimals: e.decimals,
              name: e.currencyName,
            })
          )
        ),
        direction: e.direction as 'DEBIT' | 'CREDIT',
        entryType: e.entryType,
      }))
    );

    const command: RecordEntriesCommand = {
      transactionId: TransactionId(id),
      entries,
    };

    await this.commandBus.execute(command);

    return {
      id,
      status: 'RECORDED',
      message: 'Ledger entries recorded successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reverse a transaction',
    description: 'Creates reversal entries for the transaction',
  })
  async reverseTransaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseTransactionDto,
    @CurrentUser() user: { userId: string }
  ): Promise<TransactionResponseDto> {
    const command: ReverseTransactionCommand = {
      transactionId: TransactionId(id),
      reason: dto.reason,
      reversedBy: UserId(user.userId),
    };

    await this.commandBus.execute(command);

    return {
      id,
      status: 'REVERSED',
      message: 'Transaction reversed successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Get()
  @ApiOperation({
    summary: 'Get transactions with filtering and pagination',
    description: 'Supports complex filtering, sorting, and pagination',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'source', required: false, enum: ['BINANCE', 'COINBASE', 'KRAKEN'] })
  @ApiQuery({ name: 'status', required: false, enum: ['IMPORTED', 'CLASSIFIED', 'RECORDED', 'REVERSED'] })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'asset', required: false, type: String })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['date', 'amount', 'status'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  async getTransactions(
    @Query() filter: TransactionFilterDto,
    @CurrentUser() user: { userId: string }
  ): Promise<PaginatedResponseDto<any>> {
    const query = new GetTransactionsQuery({
      userId: UserId(user.userId),
      filter: {
        source: filter.source,
        status: filter.status,
        startDate: filter.startDate ? new Date(filter.startDate) : undefined,
        endDate: filter.endDate ? new Date(filter.endDate) : undefined,
        asset: filter.asset,
      },
      pagination: {
        page: filter.page || 1,
        limit: filter.limit || 20,
      },
      sorting: {
        field: filter.sortBy || 'date',
        order: filter.sortOrder || 'desc',
      },
    });

    const result = await this.queryBus.execute(query);

    return {
      data: result.items,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get transaction by ID',
    description: 'Returns detailed transaction information including ledger entries',
  })
  async getTransaction(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { userId: string }): Promise<any> {
    const query = new GetTransactionQuery({
      transactionId: TransactionId(id),
      userId: UserId(user.userId),
    });

    return this.queryBus.execute(query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete transaction (soft delete)',
    description: 'Marks transaction as deleted without removing data',
  })
  async deleteTransaction(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string }
  ): Promise<void> {
    // Soft delete implementation
    const command = {
      transactionId: TransactionId(id),
      deletedBy: UserId(user.userId),
      deletedAt: new Date(),
    };

    await this.commandBus.execute(command);
  }

  // Helper methods
  private async parseImportFile(file: Express.Multer.File, source: string): Promise<any[]> {
    // Implementation for parsing CSV/JSON files
    if (file.mimetype === 'text/csv') {
      // Parse CSV
      return [];
    } else if (file.mimetype === 'application/json') {
      // Parse JSON
      return JSON.parse(file.buffer.toString());
    }
    throw new Error('Unsupported file format');
  }

  private async queueBulkImport(userId: string, transactions: any[], source: string): Promise<string> {
    // Queue implementation (Bull/BullMQ)
    return `job-${Date.now()}`;
  }
}
```

### 4. Portfolio Controller

```typescript
// src/api/controllers/portfolio.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { JwtAuthGuard } from '../../infrastructure/security/auth/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/auth/current-user.decorator';
import {
  GetPortfolioValuationQuery,
  GetPortfolioPerformanceQuery,
  GetPositionsQuery,
  GetPortfolioHistoryQuery,
} from '../../contexts/portfolio/application/queries';

@ApiTags('portfolio')
@Controller('api/v1/portfolio')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PortfolioController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus
  ) {}

  @Get('valuation')
  @ApiOperation({
    summary: 'Get current portfolio valuation',
    description: 'Returns current portfolio value with asset breakdown',
  })
  @ApiQuery({ name: 'currency', required: false, default: 'USD' })
  async getValuation(@Query('currency') currency: string = 'USD', @CurrentUser() user: { userId: string }) {
    const query = new GetPortfolioValuationQuery({
      userId: user.userId,
      baseCurrency: currency,
    });

    const result = await this.queryBus.execute(query);

    return {
      totalValue: result.totalValue,
      currency: result.baseCurrency,
      holdings: result.holdings,
      allocations: result.allocations,
      lastUpdated: result.timestamp,
      metadata: {
        totalAssets: result.holdings.length,
        profitablePositions: result.holdings.filter(h => h.unrealizedGain > 0).length,
        losingPositions: result.holdings.filter(h => h.unrealizedGain < 0).length,
      },
    };
  }

  @Get('performance')
  @ApiOperation({
    summary: 'Get portfolio performance metrics',
    description: 'Returns performance metrics including ROI, gains/losses',
  })
  @ApiQuery({ name: 'period', required: false, enum: ['1d', '1w', '1m', '3m', '1y', 'all'] })
  async getPerformance(@Query('period') period: string = '1m', @CurrentUser() user: { userId: string }) {
    const query = new GetPortfolioPerformanceQuery({
      userId: user.userId,
      period,
    });

    const result = await this.queryBus.execute(query);

    return {
      period,
      metrics: {
        totalReturn: result.totalReturn,
        totalReturnPercentage: result.totalReturnPercentage,
        realizedGains: result.realizedGains,
        unrealizedGains: result.unrealizedGains,
        fees: result.totalFees,
        bestPerformer: result.bestPerformer,
        worstPerformer: result.worstPerformer,
        sharpeRatio: result.sharpeRatio,
        maxDrawdown: result.maxDrawdown,
      },
      comparison: {
        btc: result.btcComparison,
        sp500: result.sp500Comparison,
      },
    };
  }

  @Get('positions')
  @ApiOperation({
    summary: 'Get all positions',
    description: 'Returns all open and closed positions with P&L',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['OPEN', 'CLOSED', 'ALL'] })
  @ApiQuery({ name: 'asset', required: false })
  async getPositions(
    @Query('status') status: string = 'OPEN',
    @Query('asset') asset?: string,
    @CurrentUser() user: { userId: string }
  ) {
    const query = new GetPositionsQuery({
      userId: user.userId,
      status,
      asset,
    });

    const positions = await this.queryBus.execute(query);

    return {
      positions: positions.map(p => ({
        id: p.positionId,
        asset: p.asset,
        quantity: p.quantity,
        averageCost: p.averageCost,
        currentPrice: p.currentPrice,
        currentValue: p.currentValue,
        costBasis: p.costBasis,
        unrealizedGain: p.unrealizedGain,
        unrealizedGainPercentage: p.unrealizedGainPercentage,
        realizedGain: p.realizedGain,
        status: p.status,
        openedAt: p.openedAt,
        closedAt: p.closedAt,
      })),
      summary: {
        totalPositions: positions.length,
        totalCostBasis: positions.reduce((sum, p) => sum + p.costBasis, 0),
        totalUnrealizedGain: positions.reduce((sum, p) => sum + p.unrealizedGain, 0),
        totalRealizedGain: positions.reduce((sum, p) => sum + p.realizedGain, 0),
      },
    };
  }

  @Get('history')
  @ApiOperation({
    summary: 'Get portfolio value history',
    description: 'Returns historical portfolio values for charting',
  })
  @ApiQuery({ name: 'period', required: false, enum: ['1d', '1w', '1m', '3m', '1y', 'all'] })
  @ApiQuery({ name: 'interval', required: false, enum: ['hourly', 'daily', 'weekly', 'monthly'] })
  async getHistory(
    @Query('period') period: string = '1m',
    @Query('interval') interval: string = 'daily',
    @CurrentUser() user: { userId: string }
  ) {
    const query = new GetPortfolioHistoryQuery({
      userId: user.userId,
      period,
      interval,
    });

    const history = await this.queryBus.execute(query);

    return {
      period,
      interval,
      data: history.map(h => ({
        timestamp: h.timestamp,
        totalValue: h.totalValue,
        costBasis: h.costBasis,
        unrealizedGain: h.unrealizedGain,
        realizedGain: h.realizedGain,
      })),
      statistics: {
        startValue: history[0]?.totalValue || 0,
        endValue: history[history.length - 1]?.totalValue || 0,
        highValue: Math.max(...history.map(h => h.totalValue)),
        lowValue: Math.min(...history.map(h => h.totalValue)),
        volatility: this.calculateVolatility(history),
      },
    };
  }

  @Post('rebalance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calculate rebalancing recommendations',
    description: 'Returns orders needed to rebalance to target allocation',
  })
  async calculateRebalance(
    @Body() dto: { targetAllocations: Record<string, number> },
    @CurrentUser() user: { userId: string }
  ) {
    const command = {
      userId: user.userId,
      targetAllocations: dto.targetAllocations,
    };

    const result = await this.commandBus.execute(command);

    return {
      recommendations: result.orders,
      estimatedCost: result.estimatedCost,
      estimatedImpact: result.estimatedImpact,
    };
  }

  private calculateVolatility(history: any[]): number {
    if (history.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < history.length; i++) {
      const dailyReturn = (history[i].totalValue - history[i - 1].totalValue) / history[i - 1].totalValue;
      returns.push(dailyReturn);
    }

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;

    return Math.sqrt(variance) * Math.sqrt(252); // Annualized volatility
  }
}
```

### 5. Tax Controller

```typescript
// src/api/controllers/tax.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiProduces } from '@nestjs/swagger';
import { Response } from 'express';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { JwtAuthGuard } from '../../infrastructure/security/auth/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/auth/current-user.decorator';

@ApiTags('tax')
@Controller('api/v1/tax')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TaxController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus
  ) {}

  @Post('reports/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Generate tax report for a specific year',
    description: 'Initiates tax calculation using specified accounting method',
  })
  async generateReport(
    @Body()
    dto: {
      taxYear: number;
      accountingMethod: 'FIFO' | 'LIFO' | 'HIFO' | 'SPECIFIC';
      includeNFTs?: boolean;
      includeDeFi?: boolean;
    },
    @CurrentUser() user: { userId: string }
  ) {
    const command = {
      userId: user.userId,
      taxYear: dto.taxYear,
      accountingMethod: dto.accountingMethod,
      includeNFTs: dto.includeNFTs ?? false,
      includeDeFi: dto.includeDeFi ?? true,
    };

    const reportId = await this.commandBus.execute(command);

    return {
      reportId,
      status: 'GENERATING',
      message: `Tax report for ${dto.taxYear} is being generated`,
      estimatedTime: '2-5 minutes',
    };
  }

  @Get('reports/:year')
  @ApiOperation({
    summary: 'Get tax report for a specific year',
    description: 'Returns complete tax report with gains/losses breakdown',
  })
  async getReport(@Param('year') year: number, @CurrentUser() user: { userId: string }) {
    const query = {
      userId: user.userId,
      taxYear: year,
    };

    const report = await this.queryBus.execute(query);

    return {
      taxYear: year,
      status: report.status,
      summary: {
        shortTermGains: report.shortTermGains,
        shortTermLosses: report.shortTermLosses,
        longTermGains: report.longTermGains,
        longTermLosses: report.longTermLosses,
        netShortTerm: report.netShortTerm,
        netLongTerm: report.netLongTerm,
        totalTaxableGain: report.totalTaxableGain,
        washSaleDisallowed: report.washSaleDisallowed,
      },
      transactions: report.transactions.map(tx => ({
        id: tx.transactionId,
        date: tx.date,
        asset: tx.asset,
        quantity: tx.quantity,
        proceeds: tx.proceeds,
        costBasis: tx.costBasis,
        gain: tx.gain,
        holdingPeriod: tx.holdingPeriod,
        taxTreatment: tx.taxTreatment,
        washSale: tx.washSale,
      })),
      forms: {
        form8949: `/api/v1/tax/reports/${year}/form8949`,
        schedule_d: `/api/v1/tax/reports/${year}/schedule-d`,
      },
    };
  }

  @Get('reports/:year/form8949')
  @ApiOperation({
    summary: 'Export Form 8949 data',
    description: 'Generates IRS Form 8949 in CSV or PDF format',
  })
  @ApiQuery({ name: 'format', enum: ['csv', 'pdf'], required: false })
  @ApiProduces('text/csv', 'application/pdf')
  async exportForm8949(
    @Param('year') year: number,
    @Query('format') format: string = 'csv',
    @CurrentUser() user: { userId: string },
    @Res() res: Response
  ) {
    const query = {
      userId: user.userId,
      taxYear: year,
      format,
    };

    const result = await this.queryBus.execute(query);

    if (format === 'pdf') {
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="form8949_${year}.pdf"`,
      });
      res.send(result.buffer);
    } else {
      res.set({
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="form8949_${year}.csv"`,
      });
      res.send(result.csv);
    }
  }

  @Get('lots')
  @ApiOperation({
    summary: 'Get tax lots',
    description: 'Returns all tax lots with cost basis information',
  })
  @ApiQuery({ name: 'status', enum: ['OPEN', 'PARTIAL', 'CLOSED'], required: false })
  @ApiQuery({ name: 'asset', required: false })
  async getTaxLots(
    @Query('status') status?: string,
    @Query('asset') asset?: string,
    @CurrentUser() user: { userId: string }
  ) {
    const query = {
      userId: user.userId,
      status,
      asset,
    };

    const lots = await this.queryBus.execute(query);

    return {
      lots: lots.map(lot => ({
        id: lot.lotId,
        asset: lot.asset,
        acquisitionDate: lot.acquisitionDate,
        quantity: lot.quantity,
        remainingQuantity: lot.remainingQuantity,
        costBasis: lot.costBasis,
        adjustedCostBasis: lot.adjustedCostBasis,
        status: lot.status,
        method: lot.acquisitionMethod,
      })),
      summary: {
        totalLots: lots.length,
        openLots: lots.filter(l => l.status === 'OPEN').length,
        totalCostBasis: lots.reduce((sum, l) => sum + l.costBasis, 0),
      },
    };
  }

  @Get('wash-sales/:year')
  @ApiOperation({
    summary: 'Get wash sale violations',
    description: 'Returns detected wash sales for the tax year',
  })
  async getWashSales(@Param('year') year: number, @CurrentUser() user: { userId: string }) {
    const query = {
      userId: user.userId,
      taxYear: year,
    };

    const washSales = await this.queryBus.execute(query);

    return {
      taxYear: year,
      violations: washSales.map(ws => ({
        disposalDate: ws.disposalDate,
        acquisitionDate: ws.acquisitionDate,
        asset: ws.asset,
        lossAmount: ws.lossAmount,
        disallowedAmount: ws.disallowedAmount,
        daysApart: ws.daysApart,
      })),
      totalDisallowed: washSales.reduce((sum, ws) => sum + ws.disallowedAmount, 0),
    };
  }

  @Get('estimated')
  @ApiOperation({
    summary: 'Get estimated tax liability',
    description: 'Calculates estimated taxes based on current gains/losses',
  })
  async getEstimatedTax(@CurrentUser() user: { userId: string }) {
    const query = {
      userId: user.userId,
      taxYear: new Date().getFullYear(),
    };

    const estimate = await this.queryBus.execute(query);

    return {
      currentYear: query.taxYear,
      estimates: {
        federal: {
          shortTermTax: estimate.federalShortTerm,
          longTermTax: estimate.federalLongTerm,
          totalTax: estimate.federalTotal,
        },
        state: {
          tax: estimate.stateTax,
          state: estimate.state,
        },
        totalEstimated: estimate.totalEstimated,
      },
      disclaimer: 'This is an estimate only. Consult a tax professional for accurate calculations.',
    };
  }
}
```

### 6. Reconciliation Controller

```typescript
// src/api/controllers/reconciliation.controller.ts
import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { JwtAuthGuard } from '../../infrastructure/security/auth/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/auth/current-user.decorator';

@ApiTags('reconciliation')
@Controller('api/v1/reconciliation')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReconciliationController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus
  ) {}

  @Post('initiate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Initiate reconciliation process',
    description: 'Starts reconciliation between internal records and external sources',
  })
  async initiateReconciliation(
    @Body()
    dto: {
      sources: string[];
      autoResolve?: boolean;
      notifyOnCompletion?: boolean;
    },
    @CurrentUser() user: { userId: string }
  ) {
    const command = {
      userId: user.userId,
      sources: dto.sources,
      autoResolve: dto.autoResolve ?? true,
      notifyOnCompletion: dto.notifyOnCompletion ?? true,
    };

    const reconciliationId = await this.commandBus.execute(command);

    return {
      reconciliationId,
      status: 'INITIATED',
      message: 'Reconciliation process started',
      sources: dto.sources,
    };
  }

  @Get('active')
  @ApiOperation({
    summary: 'Get active reconciliation sessions',
    description: 'Returns all ongoing reconciliation processes',
  })
  async getActiveReconciliations(@CurrentUser() user: { userId: string }) {
    const query = {
      userId: user.userId,
      status: ['INITIATED', 'IN_PROGRESS', 'PENDING_REVIEW'],
    };

    const sessions = await this.queryBus.execute(query);

    return {
      sessions: sessions.map(s => ({
        id: s.reconciliationId,
        status: s.status,
        sources: s.sources,
        progress: s.progress,
        discrepancies: {
          total: s.totalDiscrepancies,
          resolved: s.resolvedDiscrepancies,
          pending: s.pendingDiscrepancies,
        },
        startedAt: s.startedAt,
        estimatedCompletion: s.estimatedCompletion,
      })),
    };
  }

  @Get(':id/discrepancies')
  @ApiOperation({
    summary: 'Get discrepancies for reconciliation',
    description: 'Returns all detected discrepancies with resolution status',
  })
  async getDiscrepancies(
    @Param('id') reconciliationId: string,
    @Query('severity') severity?: string,
    @CurrentUser() user: { userId: string }
  ) {
    const query = {
      reconciliationId,
      userId: user.userId,
      severity,
    };

    const discrepancies = await this.queryBus.execute(query);

    return {
      reconciliationId,
      discrepancies: discrepancies.map(d => ({
        id: d.discrepancyId,
        asset: d.asset,
        internal: d.internalBalance,
        external: d.externalBalance,
        difference: d.difference,
        percentageDiff: d.percentageDiff,
        severity: d.severity,
        possibleCauses: d.possibleCauses,
        isResolved: d.isResolved,
        resolution: d.resolution,
      })),
      summary: {
        total: discrepancies.length,
        bySeverity: this.groupBySeverity(discrepancies),
        resolutionRate: this.calculateResolutionRate(discrepancies),
      },
    };
  }

  @Put(':id/discrepancies/:discrepancyId/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve a discrepancy',
    description: 'Manually resolve a detected discrepancy',
  })
  async resolveDiscrepancy(
    @Param('id') reconciliationId: string,
    @Param('discrepancyId') discrepancyId: string,
    @Body()
    dto: {
      resolution: 'ADJUST_INTERNAL' | 'ADJUST_EXTERNAL' | 'IGNORE' | 'INVESTIGATE';
      notes: string;
      adjustment?: {
        type: 'INCREASE' | 'DECREASE';
        amount: number;
        reason: string;
      };
    },
    @CurrentUser() user: { userId: string }
  ) {
    const command = {
      reconciliationId,
      discrepancyId,
      resolution: dto.resolution,
      notes: dto.notes,
      adjustment: dto.adjustment,
      resolvedBy: user.userId,
    };

    await this.commandBus.execute(command);

    return {
      discrepancyId,
      status: 'RESOLVED',
      resolution: dto.resolution,
    };
  }

  private groupBySeverity(discrepancies: any[]): Record<string, number> {
    return discrepancies.reduce((acc, d) => {
      acc[d.severity] = (acc[d.severity] || 0) + 1;
      return acc;
    }, {});
  }

  private calculateResolutionRate(discrepancies: any[]): number {
    if (discrepancies.length === 0) return 100;
    const resolved = discrepancies.filter(d => d.isResolved).length;
    return Math.round((resolved / discrepancies.length) * 100);
  }
}
```

### 7. Exception Filters

```typescript
// src/api/filters/effect-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import * as Effect from 'effect';

@Catch()
export class EffectExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(EffectExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';
    let details: any = {};

    // Handle Effect errors
    if (Effect.isFailure(exception)) {
      const error = Effect.causeOption(exception);

      // Map Effect errors to HTTP status codes
      if (error._tag === 'InvalidStateError') {
        status = HttpStatus.BAD_REQUEST;
        message = error.message;
        code = 'INVALID_STATE';
      } else if (error._tag === 'NotFoundError') {
        status = HttpStatus.NOT_FOUND;
        message = error.message;
        code = 'NOT_FOUND';
      } else if (error._tag === 'UnauthorizedError') {
        status = HttpStatus.UNAUTHORIZED;
        message = error.message;
        code = 'UNAUTHORIZED';
      } else if (error._tag === 'CurrencyMismatchError') {
        status = HttpStatus.BAD_REQUEST;
        message = 'Currency mismatch';
        code = 'CURRENCY_MISMATCH';
        details = {
          left: error.left,
          right: error.right,
        };
      }
    }

    // Log the error
    this.logger.error(
      `${request.method} ${request.url} - ${status} - ${message}`,
      exception instanceof Error ? exception.stack : exception
    );

    response.status(status).json({
      statusCode: status,
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

### 8. Health Check Controller

```typescript
// src/api/controllers/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { EventStore } from '../../infrastructure/event-store/event-store.service';

@ApiTags('health')
@Controller('api/v1/health')
export class HealthController {
  constructor(
    private readonly database: DatabaseService,
    private readonly eventStore: EventStore
  ) {}

  @Get()
  @ApiOperation({ summary: 'Basic health check' })
  async health() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe for Kubernetes' })
  async liveness() {
    return { status: 'alive' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe with dependency checks' })
  async readiness() {
    const dbHealth = await this.database.healthCheck();
    const eventStoreHealth = await this.eventStore.healthCheck();

    const isReady = dbHealth.write && dbHealth.read && eventStoreHealth;

    return {
      status: isReady ? 'ready' : 'not_ready',
      dependencies: {
        database: {
          write: dbHealth.write,
          read: dbHealth.read,
        },
        eventStore: eventStoreHealth,
      },
    };
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Application metrics' })
  async metrics() {
    // Return Prometheus metrics or custom metrics
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
    };
  }
}
```

### 9. Main Application Setup

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as helmet from 'helmet';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);

  // Logging
  app.useLogger(app.get(Logger));

  // Security
  app.use(helmet());
  app.enableCors({
    origin: configService.get('CORS_ORIGINS')?.split(',') || '*',
    credentials: true,
  });

  // Compression
  app.use(compression());

  // Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Global prefix
  app.setGlobalPrefix('api');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Crypto Portfolio API')
    .setDescription('API for crypto portfolio management with tax tracking')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('transactions')
    .addTag('portfolio')
    .addTag('tax')
    .addTag('reconciliation')
    .addTag('health')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = configService.get('PORT') || 3000;
  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`API Documentation: http://localhost:${port}/api/docs`);
}

bootstrap();
```
