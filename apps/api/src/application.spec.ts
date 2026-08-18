import { ConsoleLogger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

import {
  configureChatApplication,
  createChatApplication,
  createJsonLogger,
  startChatApplication,
} from './application';

describe('application bootstrap', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('creates a Nest application', async () => {
    app = await createChatApplication();

    expect(app).toBeDefined();
  });

  it('configures the application and returns the validated port', async () => {
    app = await createChatApplication();

    expect(configureChatApplication(app)).toBe(3000);
  });

  it('creates a JSON ConsoleLogger', () => {
    const logger = createJsonLogger();

    expect(logger).toBeInstanceOf(ConsoleLogger);
    expect(logger).toHaveProperty('options.json', true);
  });

  it('starts listening on the configured port', async () => {
    app = await createChatApplication();

    await startChatApplication(() => Promise.resolve(app));

    await expect(app.getUrl()).resolves.toContain(':3000');
  });
});
