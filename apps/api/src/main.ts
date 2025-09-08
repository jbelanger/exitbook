import { NestFactory } from '@nestjs/core';

import { AppModule } from './modules/app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env['PORT'] ?? 3000);
  console.log(`API listening on :${process.env['PORT'] ?? 3000}`);
}
bootstrap().catch(console.error);
