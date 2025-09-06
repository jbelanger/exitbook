import { Configuration } from '@exitbook/shared-config';
import { CorrelationService, LoggerService } from '@exitbook/shared-logger';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: false,
  });

  const typedConfig = app.get<Configuration>('TYPED_CONFIG');
  const logger = app.get(LoggerService);
  const correlationService = app.get(CorrelationService);

  app.useLogger(logger); // Use our custom logger for bootstrap messages
  app.useGlobalInterceptors(new LoggingInterceptor(logger, correlationService));
  app.useGlobalFilters(new GlobalExceptionFilter(logger));

  // Enable validation globally
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      whitelist: true,
    })
  );

  // Setup Swagger/OpenAPI documentation
  const config = new DocumentBuilder()
    .setTitle('ExitBook API')
    .setDescription('Cryptocurrency transaction import and double-entry ledger system')
    .setVersion('1.0')
    .addApiKey({ in: 'header', name: 'x-api-key', type: 'apiKey' }, 'api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Enable CORS for development
  app.enableCors();

  const port = typedConfig.PORT;
  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}`, 'Bootstrap');
  logger.log(`API Documentation: http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap();
