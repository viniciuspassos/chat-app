import type { TransformFnParams } from 'class-transformer';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

import type { ChatRequest } from '@chat-app/contracts';

export function trimChatMessage({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return value.trim();
}

export class ChatMessageDto implements ChatRequest {
  @Transform(trimChatMessage)
  @IsString()
  @IsNotEmpty()
  message!: string;
}
