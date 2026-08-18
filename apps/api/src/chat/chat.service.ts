import { Injectable } from '@nestjs/common';

import type { ChatResponse } from '@chat-app/contracts';

@Injectable()
export class ChatService {
  createReply(message: string): ChatResponse {
    const reply = `Bot: ${message}`;
    return { reply };
  }
}
