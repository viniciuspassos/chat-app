import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';

import { COPILOT_API, type CopilotApiPort } from './http/copilot-api.port';
import { CopilotController } from './http/copilot.controller';

@Module({})
export class AppModule {
  static register(api: CopilotApiPort): DynamicModule {
    return {
      module: AppModule,
      controllers: [CopilotController],
      providers: [{ provide: COPILOT_API, useValue: api }],
    };
  }
}
