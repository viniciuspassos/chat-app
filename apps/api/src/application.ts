import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import type { ApplicationEnvironment } from './config/environment';

export type ChatApplicationFactory = () => Promise<NestExpressApplication>;

export function createJsonLogger(): ConsoleLogger {
  const logger = new ConsoleLogger({ json: true });
  return logger;
}

export async function createChatApplication(): Promise<NestExpressApplication> {
  const logger = createJsonLogger();
  return NestFactory.create<NestExpressApplication>(AppModule, { logger });
}

export function configureChatApplication(app: NestExpressApplication): number {
  const config = app.get(ConfigService<ApplicationEnvironment, true>);
  const allowedOrigin = config.get('CORS_ALLOWED_ORIGIN', { infer: true });
  const port = config.get('PORT', { infer: true });
  app.enableCors({ origin: allowedOrigin });
  app.useGlobalPipes(
    new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }),
  );
  return port;
}

export async function startChatApplication(
  applicationFactory: ChatApplicationFactory = createChatApplication,
): Promise<void> {
  const app = await applicationFactory();
  const port = configureChatApplication(app);
  await app.listen(port);
}
