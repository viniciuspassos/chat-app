import { environmentValidationSchema } from './environment';

describe('environmentValidationSchema', () => {
  it('converts a valid port and accepts an HTTP origin', () => {
    const validation = environmentValidationSchema.validate({
      CORS_ALLOWED_ORIGIN: 'http://localhost:5173',
      PORT: '3000',
    });

    expect(validation.error).toBeUndefined();
    expect(validation.value).toMatchObject({
      CORS_ALLOWED_ORIGIN: 'http://localhost:5173',
      PORT: 3000,
    });
  });

  it.each([
    [{ CORS_ALLOWED_ORIGIN: 'http://localhost:5173' }, 'PORT'],
    [{ PORT: 3000 }, 'CORS_ALLOWED_ORIGIN'],
    [
      { CORS_ALLOWED_ORIGIN: 'not-an-origin', PORT: 3000 },
      'CORS_ALLOWED_ORIGIN',
    ],
    [
      { CORS_ALLOWED_ORIGIN: 'http://localhost:5173', PORT: 70_000 },
      'PORT',
    ],
  ])('rejects invalid configuration %j', (environment, invalidKey) => {
    const validation = environmentValidationSchema.validate(environment);

    expect(validation.error?.message).toContain(invalidKey);
  });
});
