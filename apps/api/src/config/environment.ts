import Joi from 'joi';

export interface ApplicationEnvironment {
  CORS_ALLOWED_ORIGIN: string;
  PORT: number;
}

export const environmentValidationSchema = Joi.object<ApplicationEnvironment>({
  CORS_ALLOWED_ORIGIN: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  PORT: Joi.number().port().required(),
}).unknown(true);
