import { randomUUID } from 'node:crypto';

import { CorrelationService, LoggerService } from '@exitbook/shared-logger';
import { NestFactory } from '@nestjs/core';
import { CommandFactory } from 'nest-commander';

import { CliModule } from './cli.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: false, // Disable Nest's default logger
  });

  const logger = app.get(LoggerService);
  const correlationService = app.get(CorrelationService);

  // Each CLI run gets its own correlation ID
  const correlationId = `cli-run_${randomUUID()}`;

  // Wrap the entire execution in a correlation context
  await correlationService.setContext(correlationId, async () => {
    try {
      logger.log(`Starting CLI execution with correlation ID: ${correlationId}`, 'Bootstrap');
      await CommandFactory.run(CliModule, logger);
      logger.log('CLI execution completed successfully.', 'Bootstrap');
      process.exit(0);
    } catch (error) {
      // Catch any unhandled exception from the commands
      logger.errorWithContext(error, {
        metadata: {
          arguments: process.argv.slice(2),
        },
        module: 'CLI',
        severity: 'high', // CLI failures are generally high severity
      });
      process.exit(1);
    }
  });
}

bootstrap();
