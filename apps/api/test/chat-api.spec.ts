import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureChatApplication } from '../src/application';

async function createTestingApplication(): Promise<INestApplication> {
  const moduleReference = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleReference.createNestApplication<NestExpressApplication>();
  configureChatApplication(app);
  await app.init();
  return app;
}

describe('POST /chat', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestingApplication();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the normalized bot reply with status 200', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/chat')
      .send({ message: '  Hello  ' })
      .expect(200);

    expect(response.body).toEqual({ reply: 'Bot: Hello' });
  });

  it.each([
    {},
    { message: '' },
    { message: '   ' },
    { message: null },
    { message: 42 },
    { message: 'Hello', unexpected: true },
  ])('rejects invalid request %j', async (invalidRequest) => {
    const response = await request(app.getHttpServer() as Server)
      .post('/chat')
      .send(invalidRequest)
      .expect(400);

    expect(response.body).toMatchObject({ statusCode: 400 });
  });

  it('allows only the configured browser origin', async () => {
    const allowedResponse = await request(app.getHttpServer() as Server)
      .options('/chat')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    const disallowedResponse = await request(app.getHttpServer() as Server)
      .options('/chat')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);

    expect(allowedResponse.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(disallowedResponse.headers['access-control-allow-origin']).not.toBe(
      'https://untrusted.example',
    );
  });
});

describe('POST /chat rate limit', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestingApplication();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 on the sixth request from the same IP', async () => {
    for (let requestNumber = 1; requestNumber <= 5; requestNumber += 1) {
      await request(app.getHttpServer() as Server)
        .post('/chat')
        .send({ message: `Message ${requestNumber}` })
        .expect(200);
    }

    const response = await request(app.getHttpServer() as Server)
      .post('/chat')
      .send({ message: 'Message 6' })
      .expect(429);

    expect(response.body).toMatchObject({ statusCode: 429 });
    await request(app.getHttpServer() as Server).get('/not-found').expect(404);
  });
});
