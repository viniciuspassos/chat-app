import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { ChatModule } from './chat/chat.module';
import { environmentValidationSchema } from './config/environment';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['../../.env', '.env'],
      isGlobal: true,
      validationSchema: environmentValidationSchema,
    }),
    ThrottlerModule.forRoot([{ limit: 5, ttl: 60_000 }]),
    ChatModule,
  ],
})
export class AppModule {}
