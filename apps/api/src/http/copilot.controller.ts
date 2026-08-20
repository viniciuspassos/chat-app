import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Res,
  Sse,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { z } from 'zod';
import { COPILOT_API, type CopilotApiPort } from './copilot-api.port';

const startTurnSchema = z.object({
  turnId: z.string().uuid(),
  message: z.string().min(1).max(100_000),
});
@Controller('sessions')
export class CopilotController {
  public constructor(@Inject(COPILOT_API) private readonly api: CopilotApiPort) {}
  @Post() create(): Promise<{ readonly id: string }> {
    return this.api.createSession();
  }
  @Delete(':id') async remove(@Param('id') sessionId: string): Promise<void> {
    await this.api.deleteSession(sessionId);
  }
  @Get(':id/history') history(@Param('id') sessionId: string): Promise<unknown> {
    return this.api.history(sessionId);
  }
  @Post(':id/turns') async turn(
    @Param('id') sessionId: string,
    @Body() body: unknown,
  ): Promise<{ readonly accepted: true }> {
    const parsed = startTurnSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('turnId must be a UUID and message must be a non-empty string');
    await this.api.startTurn(sessionId, parsed.data.turnId, parsed.data.message);
    return { accepted: true };
  }
  @Sse(':id/turns/:turnId/stream') stream(
    @Param('id') sessionId: string,
    @Param('turnId') turnId: string,
    @Headers('last-event-id') afterId?: string,
  ): Observable<{ readonly id: string; readonly type: string; readonly data: unknown }> {
    return new Observable((subscriber) => {
      void this.forwardEvents(sessionId, turnId, afterId, subscriber);
    });
  }
  @Get(':id/files/:fileId') async download(
    @Param('id') sessionId: string,
    @Param('fileId') fileId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.api.file(sessionId, fileId);
    response.setHeader('Content-Type', file.mediaType);
    response.setHeader('Content-Disposition', `attachment; filename="${sanitizeName(file.name)}"`);
    response.send(Buffer.from(file.body));
  }
  private async forwardEvents(
    sessionId: string,
    turnId: string,
    afterId: string | undefined,
    subscriber: {
      next(value: { readonly id: string; readonly type: string; readonly data: unknown }): void;
      complete(): void;
      error(error: unknown): void;
    },
  ): Promise<void> {
    try {
      for await (const event of this.api.events(sessionId, turnId, afterId))
        subscriber.next({ id: event.id, type: event.type, data: event.payload });
      subscriber.complete();
    } catch (error) {
      subscriber.error(error);
    }
  }
}
function sanitizeName(name: string): string {
  return name.replaceAll(/[\\/\r\n"]/g, '_');
}
